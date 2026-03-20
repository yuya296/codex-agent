# codex-agent

Slack DM と Codex (`codex app-server`) をつなぐ最小構成のエージェントです。  
構成は `gateway / orchestrator / sqlite / worker(codex app-server)` の MVP です。

## 必要環境

- Node.js 24 系（`node:sqlite` を利用）
- npm
- Codex CLI（`codex app-server` が使えるバージョン）
- Slack App のトークン
  - Bot Token: `xoxb-...`
  - App Level Token: `xapp-...`（Socket Mode 用）

## セットアップ

1. 依存関係をインストール

```bash
npm install
```

2. 対話式セットアップを実行

```bash
npm run setup
```

`setup` は以下を対話入力し、`~/.config/codex-agent/config.toml` に保存します。

- 必須: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `CODEX_HOME`, `CODEX_WORKER_COMMAND`, `CODEX_WORKER_ARGS`, `SQLITE_PATH`
- 任意: `SLACK_AGENT_CHAT_STATUS_ENABLED`, `CODEX_WORKER_CWD`, `PORT`

デフォルト値:

- `CODEX_WORKER_COMMAND`: `codex`
- `CODEX_WORKER_ARGS`: `app-server`
- `CODEX_HOME`: `$CODEX_HOME` があればそれ、なければ `~/.codex`
- `SLACK_AGENT_CHAT_STATUS_ENABLED`: `false`
- `SQLITE_PATH`: `./data/app.sqlite`

保存時の挙動:

- 既存 `config.toml` がある場合は上書き確認あり
- `~/.config/codex-agent` を自動作成
- `config.toml` のパーミッションは `0600`

Slack App 側の具体的な設定は以下を参照してください。  
[Slack API 設定ガイド](./docs/slack-api-setup.md)

必要な権限の要点:

- App-Level Token scope: `connections:write`
- Bot Token Scopes: `chat:write`, `im:history`
- Event Subscription: `message.im`

## 起動前チェック

```bash
npm run doctor
```

`doctor` は次を確認します。

- `npm install` 済みか
- `codex` コマンド実行可否
- `codex app-server` サブコマンド有無
- `node:sqlite` のロード可否
- `sqlite3` CLI（任意、未導入は WARN）

## 起動

```bash
npm start
```

開発時:

```bash
npm run dev
```

補足:

- 設定読み込みは `config.toml` のみです（`.env` は読みません）
- 起動時に `codex.home` の値が `CODEX_HOME` 環境変数として worker プロセスに渡されます

## 設定ファイル形式

`~/.config/codex-agent/config.toml`

```toml
[slack]
bot_token = "xoxb-..."
app_token = "xapp-..."

[codex]
home = "~/.codex"
worker_command = "codex"
worker_args = ["app-server"]
# worker_cwd = "/absolute/path" # optional

[app]
sqlite_path = "./data/app.sqlite"
slack_agent_chat_status_enabled = false
# port = 3000 # optional
```

`slack_agent_chat_status_enabled = true` にすると、進捗通知に `assistant.threads.setStatus` を使います。通常の DM 運用や未対応 token の環境では `false` のまま使ってください。

## npm scripts

- `npm run setup`: 対話式設定
- `npm run doctor`: 環境チェック
- `npm start`: 本番起動
- `npm run dev`: watch 起動
- `npm run check`: TypeScript 型チェック
- `npm test`: テスト実行
