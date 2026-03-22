# Spec

このドキュメントは、現在の実装を読む前に押さえておくべきスコープと不変条件だけを簡潔にまとめる。
詳細な仕様は `src/` と `tests/` を正本とする。

## Current scope

- Slack DM のトップレベル投稿で新規 Session を開始する
- 既存 Slack thread への返信で Session を継続する
- `codex app-server` を実行バックエンドとして使う
- approval を Slack 上で `Approve / Reject` で処理する
- Docker で起動できる
- SQLite に最小限の session 情報を保存する

## Out of scope

- public channel support
- mention based invocation
- dedicated web UI
- scheduler / recurring schedule
- 会話履歴全文の永続化

## Stable invariants

- 1 Slack root thread = 1 Session
- 1 Session = 1 Codex thread
- Session identity は `slack_team_id + slack_channel_id + slack_root_thread_ts`
- `running` 中の追加投稿は queue せず steer として扱う
- `waiting_approval` 中の追加投稿は現在の approval を reject 扱いにして新しい入力として扱う
- failure 後も同じ Slack thread から再開可能とする

## Persistence policy

- SQLite の owner は `orchestrator`
- 保持するのは session 対応関係と最小状態に留める
- 会話本文や approval 状態の source of truth は `codex app-server`

## Reading guide

- 全体像は [Architecture Overview](./architecture_overview.md)
- 設計思想は [Architecture](./architecture.md)
- 実際の挙動は `src/` と `tests/`
