# Architecture

## 1. Overview

Slack DM 上で動作する常駐型 AI エージェントを構築する。  
ただし独自エージェント実装は極力薄くし、実行本体は Codex app-server に委譲する。

本システムの中心的な考え方は以下。

- 1 Slack root thread = 1 Session
- 1 Session = 1 Codex thread
- Slack は DM のみ対応
- Scheduler は batch job を起動するのではなく、新規 Session を起動する
- Session の会話本体・run・approval の source of truth は Codex 側
- Slack / Codex の対応表や schedule 定義のみを SQLite に保存する

---

## 2. Components

### 2.1 Gateway

Slack との入出力を担う薄い adapter。

#### Responsibilities

- Slack Socket Mode 接続維持
- Slack DM / thread reply の受信
- Slack interactive action の受信
- Slack event を内部コマンドへ変換
- 内部イベントを Slack message / Block Kit に変換
- session 特定のために orchestrator を呼ぶ

#### Non-responsibilities

- session 実行制御
- schedule 計算
- Codex 実行本体
- SQLite の直接更新

---

### 2.2 Orchestrator

実行制御の中心。  
本システムの owner に最も近いコンポーネント。

#### Responsibilities

- Session の作成
- 既存 Session の継続
- Slack thread ↔ Codex thread の対応管理
- Session 状態管理
- Codex app-server の呼び出し
- 実行中の追加投稿を steer として扱う
- 承認待ち中の追加投稿を reject + new message として扱う
- approval イベントの Slack 反映要求
- SQLite の読み書き
- scheduler 起点 / slack 起点の入口統一

#### Non-responsibilities

- Slack API 呼び出し
- cron 発火計算そのもの
- Codex の会話履歴本体の永続化

---

### 2.3 Scheduler

定期実行定義の管理と発火を担う。

#### Responsibilities

- schedule 定義の管理
- `next_fire_at` に基づく発火判定
- 発火時に orchestrator へ新規 Session 起動要求を送る
- recurring schedule の次回 `next_fire_at` 再計算

#### Non-responsibilities

- Slack 送信
- Session 継続処理
- Codex 実行本体

---

### 2.4 SQLite

アプリ独自データの最小永続化先。

#### Stored data

- Slack thread ↔ Codex thread の対応
- Session の最小状態
- Schedule 定義
- 必要に応じた補助メタデータ

#### Non-stored data

- 会話履歴全文
- Codex run / approval の source of truth
- Slack メッセージ本文の完全コピー

---

### 2.5 External Systems

#### Slack

- UI / イベント基盤
- DM / thread / interactive action を提供

#### Codex app-server

- 会話 thread 実行本体
- run の進行
- approval の待ち / 再開
- 実行イベント通知

---

## 3. Context Diagram

```text
Slack -> gateway -> orchestrator -> Codex app-server
scheduler -> orchestrator -> Codex app-server
                     |
                   SQLite
```

---

## 4. Session Model

### 4.1 Session identity

Session は以下で一意に決まる。

- `slack_team_id`
- `slack_channel_id`
- `slack_root_thread_ts`

### 4.2 Session mapping

- 1 Slack root thread = 1 Session
- 1 Session = 1 Codex thread

### 4.3 Session lifecycle

Session は archive しない。  
Codex session/thread が残る限り再開可能とする。

#### Session state

- `idle`
- `running`
- `waiting_approval`
- `failed`
- `cancelled`（任意）

`completed` は必須ではない。  
会話の器としての Session は残し続ける。

---

## 5. Input Handling Policy

### 5.1 New top-level DM message

- 新規 Session を作成する
- 新規 Slack thread を開始する
- 新規 Codex thread を作成する

### 5.2 Reply to existing Slack thread

- 既存 Session を特定する
- 既存 Codex thread を継続する

### 5.3 Additional message while session is running

- queue しない
- steer として扱う
- 最新のユーザー意図として Codex に渡す

### 5.4 Additional message while session is waiting approval

- 現在の approval を reject 扱いにする
- その追加メッセージを新しいユーザー入力として扱う

---

## 6. Approval Policy

### 6.1 Slack UX

ボタンは以下のみ。

- `Approve`
- `Reject`

`Always approve in this session` は Codex 側に自然なサポートがある場合のみ採用する。  
MVP では必須ではない。

### 6.2 Approval timeout

- 長めの timeout を設定する
- 目安は 3h〜6h
- timeout 後は approval を declined 相当で終了する
- Slack スレッドに単発メッセージで結果を通知する

### 6.3 Approval source of truth

approval 状態の source of truth は Codex app-server 側。  
アプリ側は Slack への投影と紐付けのみを扱う。

---

## 7. Scheduling Model

Scheduler は batch を起動しない。  
Scheduler は新規 Session を起動する。

### 7.1 Common scheduling mechanism

すべての schedule は `next_fire_at` で発火判定する。

- `next_fire_at <= now`
- `status = scheduled`

であれば発火対象。

### 7.2 One-shot schedule

- 例: 「30分後に起こして」
- 保存時に絶対時刻 `next_fire_at` に正規化する
- 発火後は `status = fired`

### 7.3 Recurring schedule

- 例: 「毎週月曜 9:00」
- `cron_expr` と `timezone` を持つ
- 発火後に次の `next_fire_at` を計算する

### 7.4 Overlap policy

同一 schedule 由来の前回実行がまだ完了していない場合は `skip` する。

### 7.5 Minimum interval

短すぎる schedule は作成時に拒否する。  
最小間隔は config で指定可能とする。

---

## 8. Error Handling

### 8.1 Codex execution failure

- 可能なら Slack thread にエラーメッセージを投稿する
- 投稿できない場合はそれ以上は行わない
- Session は残す
- 同じ Slack thread への再投稿で再開可能にする

### 8.2 Slack post failure

- エラー記録のみ
- Session / Schedule の整合性は維持する

### 8.3 Scheduler failure / restart

- `next_fire_at <= now AND status = scheduled` を再取得して再処理できること
- 発火 claim は DB 状態更新で行い、多重発火を防ぐ

---

## 9. Ownership

### SQLite owner

SQLite の論理 owner は orchestrator とする。

- gateway は SQLite を直接読まない
- scheduler も原則 orchestrator 経由で Session を起動する

### Source of truth

- Slack message / thread: Slack
- Codex conversation / run / approval: Codex
- Slack thread ↔ Codex thread mapping: SQLite
- schedule definition: SQLite

---

## 10. Runtime / Deployment

### Deployment model

Docker Compose による単一ホスト起動を前提とする。

### Main processes

- gateway
- orchestrator
- scheduler

### Persistence

- SQLite は Docker volume に配置する
- Codex 側の状態も永続 volume を利用する

---

## 11. Recommended Internal Interfaces

### gateway -> orchestrator

- `start_session_from_slack(...)`
- `continue_session_from_slack(...)`
- `resolve_approval(...)`

### scheduler -> orchestrator

- `start_session_from_schedule(...)`

### orchestrator -> gateway

- `notify_progress(...)`
- `notify_approval(...)`
- `notify_completed(...)`
- `notify_failed(...)`

### orchestrator -> codex

- create / resume thread
- send user message
- send approval decision
- receive progress / approval / completion events
