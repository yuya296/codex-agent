# Slack API 設定ガイド

`codex-agent` は Slack webhook で動作します。  
このドキュメントでは、Slack App の作成から `POST /api/webhooks/slack` に到達できる状態までを説明します。

会話は Chat SDK の `thread.state` に寄せ、初回 DM は `onDirectMessage`、同じ thread にぶら下がる継続投稿は `onSubscribedMessage` で処理します。SQLite の移行手順はありません。classic な DM 返信のまま loading status を使う前提なので、Slack App 側では `Agents & AI Apps` は有効化しますが、`Agent or Assistant` は OFF にします。`codex-agent` 側では `SLACK_AGENT_CHAT_STATUS_ENABLED=true` を設定します。既定値は `false` で、未対応 token や通常 DM 運用ではそのまま使えます。

## 必要な権限と設定

- Bot Token Scopes: `chat:write`, `im:history`, `files:write`, `files:read`
- `SLACK_AGENT_CHAT_STATUS_ENABLED=true` を使う場合は `assistant:write`
- Event Subscriptions: `message.im`, `assistant_thread_started`, `assistant_thread_context_changed`
- Required features: `Event Subscriptions`, `Interactivity & Shortcuts`, `Agents & AI Apps`

不要なもの:

- `assistant:write` はこの実装では不要
- `assistant_thread_started` と `assistant_thread_context_changed` はこの実装では不要
- `App Home` のメッセージ送信許可はこの実装では不要

## Slack App を作成

1. Slack API の管理画面で「Create New App」を選択
2. 「From scratch」を選び、アプリ名と対象 Workspace を指定して作成

## Request URL を用意

Slack から到達できる webhook URL を用意します。

- 受け口: `POST /api/webhooks/slack`
- ローカル開発時は ngrok などで公開
- 例: `https://xxxxx.ngrok.app/api/webhooks/slack`

## Agents & AI Apps を設定

1. Slack App 管理画面の `Agents & AI Apps` を開く
2. `Agent or Assistant` は OFF のままにする
3. 後述の `SLACK_AGENT_CHAT_STATUS_ENABLED=true` を使う場合でも、`Agent or Assistant` は ON にしない

補足:

- `Agents & AI Apps` の画面自体は使いますが、classic thread UX を維持するため `Agent or Assistant` は OFF にします
- `Agent or Assistant Overview` は未入力でも問題ありません
- `Suggested Prompts` は今回の実装では不要です

## Bot Token Scope を設定

`OAuth & Permissions` の `Bot Token Scopes` に次を追加します。

- `chat:write`（Bot がスレッド返信し、AgentChat status 更新にも使う）
- `im:history`（DM の `message.im` イベントを購読するため）
- `files:write`（ローカル画像を thread に添付アップロードするため）
- `files:read`（Slack で受け取った画像添付を download して worker に渡すため）
- `assistant:write`（`SLACK_AGENT_CHAT_STATUS_ENABLED=true` のときだけ）

補足:

- このアプリは DM (`channel_type=im`) のみ処理します。
- `assistant.threads.setStatus` は 2026年3月5日時点で `chat:write` で利用可能です。
- パブリックチャンネル運用を追加する場合は、別途 scope とイベント購読を追加してください。

## Event Subscriptions を設定

1. `Event Subscriptions` を ON
2. `Request URL` に `https://<your-domain>/api/webhooks/slack` を設定
3. `Subscribe to bot events` に次を追加
   - `app_mention`
   - `message.im`
   - `assistant_thread_started`
   - `assistant_thread_context_changed`

classic thread 前提では DM しか処理しませんが、Chat SDK の Slack adapter と status 対応のため上記イベントをそろえます。

## Interactivity を有効化

`Interactivity & Shortcuts` を ON にします。  
本アプリは Approve/Reject ボタンを使うため、Interactivity が必要です。

## Workspace にインストール

1. `Install App`（または `Reinstall to Workspace`）を実行
2. 発行された `Bot User OAuth Token` (`xoxb-...`) を控える（`SLACK_BOT_TOKEN`）

scope や event を変更した場合も、必ず `Reinstall to Workspace` を実行してください。

## codex-agent 側に設定

環境変数で最低限以下を設定します。

- `SLACK_BOT_TOKEN`: `xoxb-...`
- `SLACK_SIGNING_SECRET`: Slack app の Signing Secret
- `REDIS_URL`: `redis://localhost:6379` など
- `SLACK_AGENT_CHAT_STATUS_ENABLED`: AgentChat status を使うときだけ `true`
- `CODEX_WORKER_COMMAND`: `codex`
- `CODEX_WORKER_ARGS`: `app-server`

例:

```bash
export SLACK_BOT_TOKEN='xoxb-...'
export SLACK_SIGNING_SECRET='...'
export REDIS_URL='redis://localhost:6379'
export SLACK_AGENT_CHAT_STATUS_ENABLED=true
```

未対応 token や通常 DM 運用では `false` のまま使ってください。

## 動作確認

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
  - Bot token の再取得を確認（`xoxb-...`）
  - App を再インストールして最新 token を再取得
- `invalid signature`
  - `SLACK_SIGNING_SECRET` を確認
  - Slack app の Request URL が正しいか確認
- AgentChat の status が出ない
  - `Agents & AI Apps` の画面が利用可能な app か確認
  - `Agent or Assistant` を OFF にしているか確認
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
  - Interactivity の Request URL が `/api/webhooks/slack` を向いているか確認

## 参考

- [Developing AI apps](https://docs.slack.dev/ai/developing-ai-apps)
- [Set status scope update (2026-03-05)](https://docs.slack.dev/changelog/2026/03/05/set-status-scope-update/)
