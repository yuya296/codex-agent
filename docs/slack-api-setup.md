# Slack API 設定ガイド

`codex-agent` は Slack Socket Mode で動作します。  
このドキュメントでは、Slack App の作成から `npm start` で受信できる状態までを説明します。

AgentChat の loading status を使う場合は、Slack App 側で `Agents & AI Apps` を有効化し、`codex-agent` 側で `SLACK_AGENT_CHAT_STATUS_ENABLED=true` を設定します。既定値は `false` で、未対応 token や通常 DM 運用ではそのまま使えます。

## 必要な権限と設定

- App-Level Token scope: `connections:write`
- Bot Token Scopes: `chat:write`, `im:history`
- Event Subscriptions: `message.im`
- Required features: `Socket Mode`, `Interactivity & Shortcuts`, `Agents & AI Apps`, `App Home` のメッセージ送信許可

不要なもの:

- `assistant:write` はこの実装では不要
- `assistant_thread_started` と `assistant_thread_context_changed` の購読も不要

## 1. Slack App を作成

1. Slack API の管理画面で「Create New App」を選択
2. 「From scratch」を選び、アプリ名と対象 Workspace を指定して作成

## 2. Socket Mode を有効化

1. `Socket Mode` を ON
2. `App-Level Tokens` で新規トークンを作成
3. Scope は `connections:write` を付与
4. 発行された `xapp-...` を控える（`SLACK_APP_TOKEN`）

## 3. Agents & AI Apps を有効化

1. Slack App 管理画面の `Agents & AI Apps` を開く
2. feature を有効化する
3. AgentChat の loading status を使う場合だけ、後述の `slack_agent_chat_status_enabled` を `true` にする

補足:

- ON にするのは `Agent or Assistant` のトグルです
- `Agent or Assistant Overview` は未入力でも問題ありません
- `Suggested Prompts` は今回の実装では不要です

## 4. App Home でメッセージ送信を有効化

1. `Features` > `App Home` を開く
2. `Show Tabs` の `Messages Tab` を ON にする
3. `Allow users to send Slash commands and messages from the messages tab` を ON にする

Slack で「このアプリへのメッセージ送信はオフにされています。」と出る場合は、まずここを確認してください。

## 5. Bot Token Scope を設定

`OAuth & Permissions` の `Bot Token Scopes` に次を追加します。

- `chat:write`（Bot がスレッド返信し、AgentChat status 更新にも使う）
- `im:history`（DM の `message.im` イベントを購読するため）

補足:

- このアプリは DM (`channel_type=im`) のみ処理します。
- `assistant.threads.setStatus` は 2026年3月5日時点で `chat:write` で利用可能です。
- パブリックチャンネル運用を追加する場合は、別途 scope とイベント購読を追加してください。

## 6. Event Subscriptions を設定

1. `Event Subscriptions` を ON
2. `Subscribe to bot events` に `message.im` を追加

`assistant_thread_started` と `assistant_thread_context_changed` は今回の実装では不要です。

## 7. Interactivity を有効化

`Interactivity & Shortcuts` を ON にします。  
本アプリは Approve/Reject ボタンを使うため、Interactivity が必要です。

## 8. Workspace にインストール

1. `Install App`（または `Reinstall to Workspace`）を実行
2. 発行された `Bot User OAuth Token` (`xoxb-...`) を控える（`SLACK_BOT_TOKEN`）

scope や event を変更した場合も、必ず `Reinstall to Workspace` を実行してください。

## 9. codex-agent 側に設定

環境変数で最低限以下を設定します。

- `SLACK_BOT_TOKEN`: `xoxb-...`
- `SLACK_APP_TOKEN`: `xapp-...`
- `SLACK_AGENT_CHAT_STATUS_ENABLED`: AgentChat status を使うときだけ `true`
- `CODEX_WORKER_COMMAND`: `codex`
- `CODEX_WORKER_ARGS`: `app-server`

例:

```bash
export SLACK_BOT_TOKEN='xoxb-...'
export SLACK_APP_TOKEN='xapp-...'
export SLACK_AGENT_CHAT_STATUS_ENABLED=true
```

未対応 token や通常 DM 運用では `false` のまま使ってください。

## 10. 動作確認

```bash
npm run doctor
npm start
```

Slack で Bot に DM を送り、次を確認します。

1. トップレベル投稿で新規セッションが開始される
2. 同スレッド返信で継続入力として処理される
3. 承認要求時に `Approve/Reject` ボタンが表示される
4. `SLACK_AGENT_CHAT_STATUS_ENABLED=true` の場合、進捗中に AgentChat の loading status が表示される

## トラブルシュート

- `not_authed` / `invalid_auth`
  - トークン文字列の取り違えを確認（`xoxb-` と `xapp-`）
  - App を再インストールして最新 token を再取得
- AgentChat の status が出ない
  - `Agents & AI Apps` を有効化したか確認
  - `SLACK_AGENT_CHAT_STATUS_ENABLED=true` になっているか確認
  - scope や feature 変更後に `Reinstall to Workspace` したか確認
- 「このアプリへのメッセージ送信はオフにされています。」と出る
  - `Features` > `App Home` > `Messages Tab` が ON か確認
  - `Allow users to send Slash commands and messages from the messages tab` が ON か確認
- DM を送っても反応しない
  - `message.im` 購読が有効か確認
  - `im:history` scope 追加後に再インストールしたか確認
- ボタンを押しても反応しない
  - `Interactivity & Shortcuts` が ON か確認
  - Socket Mode が ON か確認

## 参考

- [Developing AI apps](https://docs.slack.dev/ai/developing-ai-apps)
- [Set status scope update (2026-03-05)](https://docs.slack.dev/changelog/2026/03/05/set-status-scope-update/)
