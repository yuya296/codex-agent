# Slack API 設定ガイド

`codex-agent` は Slack Socket Mode で動作します。  
このドキュメントでは、Slack App の作成から `npm start` で受信できる状態までを説明します。

## 1. Slack App を作成

1. Slack API の管理画面で「Create New App」を選択
2. 「From scratch」を選び、アプリ名と対象 Workspace を指定して作成

## 2. Socket Mode を有効化

1. `Socket Mode` を ON
2. `App-Level Tokens` で新規トークンを作成
3. Scope は `connections:write` を付与
4. 発行された `xapp-...` を控える（`SLACK_APP_TOKEN`）

## 3. Bot Token Scope を設定

`OAuth & Permissions` の `Bot Token Scopes` に次を追加します。

- `chat:write`（Bot がスレッド返信するため）
- `im:history`（DM の `message.im` イベントを購読するため）

補足:

- このアプリは DM (`channel_type=im`) のみ処理します。
- パブリックチャンネル運用を追加する場合は、別途 scope とイベント購読を追加してください。

## 4. Event Subscriptions を設定

1. `Event Subscriptions` を ON
2. `Subscribe to bot events` に `message.im` を追加

## 5. Interactivity を有効化

`Interactivity & Shortcuts` を ON にします。  
本アプリは Approve/Reject ボタンを使うため、Interactivity が必要です。

## 6. Workspace にインストール

1. `Install App`（または `Reinstall to Workspace`）を実行
2. 発行された `Bot User OAuth Token` (`xoxb-...`) を控える（`SLACK_BOT_TOKEN`）

## 7. codex-agent 側に設定

プロジェクトルートで以下を実行します。

```bash
npm run setup
```

プロンプトで最低限以下を入力します。

- `SLACK_BOT_TOKEN`: `xoxb-...`
- `SLACK_APP_TOKEN`: `xapp-...`
- `CODEX_WORKER_COMMAND`: `codex`
- `CODEX_WORKER_ARGS`: `app-server`

## 8. 動作確認

```bash
npm run doctor
npm start
```

Slack で Bot に DM を送り、次を確認します。

1. トップレベル投稿で新規セッションが開始される
2. 同スレッド返信で継続入力として処理される
3. 承認要求時に `Approve/Reject` ボタンが表示される

## トラブルシュート

- `not_authed` / `invalid_auth`
  - トークン文字列の取り違えを確認（`xoxb-` と `xapp-`）
  - App を再インストールして最新 token を再取得
- DM を送っても反応しない
  - `message.im` 購読が有効か確認
  - `im:history` scope 追加後に再インストールしたか確認
- ボタンを押しても反応しない
  - `Interactivity & Shortcuts` が ON か確認
  - Socket Mode が ON か確認

