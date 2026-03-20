# Spec

## 1. Scope

### In scope

- Slack DM only
- Slack root thread based session handling
- Codex app-server based execution
- approval handling on Slack
- one-shot / recurring schedules
- Docker-friendly deployment
- SQLite based minimal persistence

### Out of scope

- public channel support
- mention based bot invocation
- dedicated admin web UI
- true headless batch execution
- complex calendar rules such as holidays / business days / RRULE

---

## 2. Functional Requirements

### FR-1 Slack DM handling

システムは Slack DM のトップレベル投稿を受け取り、新規 Session を作成できなければならない。

#### Acceptance criteria

- DM のトップレベル投稿で新規 Session が作成される
- 新規 Slack root thread が作られる
- 新規 Codex thread が紐づく

---

### FR-2 Slack thread continuation

システムは既存 Slack thread への返信を受け取り、既存 Session を継続できなければならない。

#### Acceptance criteria

- `channel_id + root_thread_ts` で Session が解決できる
- 既存 Codex thread を継続利用する
- 同一 thread 内で文脈が継続される

---

### FR-3 Running session steering

Session が `running` のとき、追加投稿は queue ではなく steer として扱わなければならない。

#### Acceptance criteria

- 実行中の追加投稿は reject されない
- 追加投稿は最新のユーザー意図として Codex に渡される
- ユーザーは thread 上で方針修正できる

---

### FR-4 Waiting approval behavior

Session が `waiting_approval` のとき、追加投稿は approval reject + new message として扱わなければならない。

#### Acceptance criteria

- 現在の approval が reject 扱いになる
- 追加投稿が新しいユーザー入力として処理される
- Slack 上の体験としてボタン押下なしで方針変更できる

---

### FR-5 Approval UI

システムは approval 要求を Slack 上に表示し、ユーザーが応答できなければならない。

#### UI actions

- `Approve`
- `Reject`

#### Acceptance criteria

- approval 要求が Slack thread に表示される
- ボタン押下結果が Codex に返送される
- timeout 時に declined 相当のメッセージが表示される

---

### FR-6 Schedule support

システムは one-shot と recurring の両方の schedule を扱えなければならない。

#### Supported schedule types

- one-shot
- recurring (cron based)

#### Acceptance criteria

- one-shot は絶対時刻 `next_fire_at` で発火する
- recurring は `cron_expr + timezone` から次回 `next_fire_at` を計算する
- 両者とも同一の発火機構を利用する

---

### FR-7 Scheduled session creation

Scheduler は発火時に batch ではなく新規 Session を起動しなければならない。

#### Acceptance criteria

- 発火ごとに新規 Slack トップレベル投稿を作成する
- 発火ごとに新規 Session を作成する
- 発火ごとに新規 Codex thread を作成する

---

### FR-8 Schedule overlap policy

同一 schedule が前回実行中のまま次回発火時刻に達した場合は skip しなければならない。

#### Acceptance criteria

- overlap は並列実行しない
- overlap 発生時は skip 記録を残せる
- Session は新たに作成しない

---

### FR-9 Session resumability after failure

失敗後も同じ Slack thread から Session を再開できなければならない。

#### Acceptance criteria

- 失敗時、可能なら Slack にエラーメッセージを出す
- Session 対応は失わない
- thread に再投稿すれば継続可能

---

## 3. Non-functional Requirements

### NFR-1 Thin implementation

独自エージェントロジックは極力持たず、Codex app-server の native capability を活用すること。

### NFR-2 Minimal persistence

会話履歴本体は保持せず、Slack/Codex 対応表と schedule 定義のみを SQLite に保持すること。

### NFR-3 Docker operability

Docker Compose で簡単に起動できること。

### NFR-4 Recoverability

gateway / orchestrator / scheduler の再起動後も SQLite に保存された対応表と schedule を利用して復元可能であること。

---

## 4. Session Specification

### Session identity

Session は以下で一意。

- `slack_team_id`
- `slack_channel_id`
- `slack_root_thread_ts`

### Session fields

- `session_id`
- `slack_team_id`
- `slack_channel_id`
- `slack_root_thread_ts`
- `codex_thread_id`
- `state`
- `created_at`
- `updated_at`

### Session state values

- `idle`
- `running`
- `waiting_approval`
- `failed`
- `cancelled`（optional）

### Rules

- 1 Slack root thread は 1 Session にのみ対応する
- 1 Session は 1 Codex thread に対応する
- Session は archive しない
- Session は削除せず再利用可能とする

---

## 5. Schedule Specification

### Schedule fields

- `schedule_id`
- `name`
- `slack_user_id`
- `slack_channel_id`（optional）
- `prompt_template`
- `timezone`
- `status`
- `next_fire_at`
- `last_fired_at`
- `recurrence_type`
- `cron_expr`
- `created_at`
- `updated_at`

### recurrence_type

- `none`
- `cron`

### status

- `scheduled`
- `firing`
- `fired`
- `failed`
- `cancelled`

### Rules

- `recurrence_type = none` のとき `cron_expr` は NULL
- `recurrence_type = cron` のとき `cron_expr` は必須
- one-shot は発火後 `fired`
- recurring は発火後 `next_fire_at` を再計算する
- 最小間隔未満の schedule は作成不可

---

## 6. Approval Specification

### Approval buttons

- `Approve`
- `Reject`

### Timeout

- configurable
- default は 3h〜6h の範囲で設定すること

### Timeout behavior

- approval を失効させる
- Slack thread に declined 相当のメッセージを送る
- run を終了扱いにする

### Extra messages during waiting_approval

- 現在 approval を reject 扱いにする
- そのメッセージを新規入力として処理する

---

## 7. Input Behavior Specification

### 7.1 Top-level DM

- 新規 Session
- 新規 Slack root thread
- 新規 Codex thread

### 7.2 Reply to existing thread

- 既存 Session を特定
- 同じ Codex thread に継続入力

### 7.3 Additional message while running

- steer として扱う
- queue しない

### 7.4 Additional message while waiting approval

- reject + new message

---

## 8. Scheduler Execution Specification

### Common execution algorithm

Scheduler は以下条件で発火対象を探す。

- `status = scheduled`
- `next_fire_at <= now`

### Claim procedure

多重発火防止のため、発火前に対象 schedule を `firing` に更新して claim する。

### One-shot after fire

- `status = fired`
- `last_fired_at = now`

### Recurring after fire

- `last_fired_at = now`
- 次回 `next_fire_at` を再計算
- `status = scheduled`

---

## 9. Error Handling Specification

### Codex execution error

- 可能なら Slack thread にエラー投稿
- Session は保持
- 再投稿で再開可能

### Slack post error

- エラー記録のみ
- Session / Schedule の整合性を壊さない

### Scheduler restart

- overdue な schedule を再取得可能であること
- claim 機構により多重発火を防ぐこと

---

## 10. Persistence Specification

### SQLite ownership

SQLite の owner は orchestrator とする。

### Minimum tables

- `sessions`
- `schedules`

### Optional tables

必要に応じて以下を追加可能。

- approval Slack message mapping
- event / audit log
- skip / failure history

---

## 11. Suggested Config

- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN`
- `OPENAI_API_KEY`
- `CODEX_MODEL`
- `SQLITE_PATH`
- `APPROVAL_TIMEOUT_SEC`
- `MIN_SCHEDULE_INTERVAL_SEC`
- `TIMEZONE_DEFAULT`
- `LOG_LEVEL`

---

## 12. Acceptance Criteria Summary

### Session

- Slack DM トップレベル投稿で新規 Session 作成
- Slack thread reply で Session 継続
- Session は archive せず再利用可能

### Steering

- `running` 中の追加投稿は steer
- `waiting_approval` 中の追加投稿は reject + new message

### Scheduling

- one-shot / recurring を扱える
- すべて `next_fire_at` ベースで発火
- overlap は skip

### Approval

- Approve / Reject のみ
- timeout で declined 相当終了

### Error recovery

- 失敗後も同じ thread から再開可能
