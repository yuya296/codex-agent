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

2. 環境変数を設定

```bash
export SLACK_BOT_TOKEN='xoxb-...'
export SLACK_APP_TOKEN='xapp-...'
```

必要に応じて以下も設定します。

- `CODEX_HOME`
- `CODEX_WORKER_COMMAND`
- `CODEX_WORKER_ARGS`
- `CODEX_WORKER_CWD`
- `SQLITE_PATH`
- `SLACK_AGENT_CHAT_STATUS_ENABLED`
- `PORT`

デフォルト値:

- `CODEX_WORKER_COMMAND`: `codex`
- `CODEX_WORKER_ARGS`: `app-server`
- `CODEX_HOME`: `$CODEX_HOME` があればそれ、なければ `~/.codex`
- `SLACK_AGENT_CHAT_STATUS_ENABLED`: `false`
- `SQLITE_PATH`: `./data/app.sqlite`

Slack App 側の具体的な設定は以下を参照してください。  
[Slack API 設定ガイド](./docs/slack-api-setup.md)
[Docker 運用ガイド](./docs/docker.md)

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

## Docker で起動

Slack token などは外部環境変数から渡します。

`.env.example` を `.env` にコピーして使えます。

```bash
docker compose up -d --build
docker compose exec app codex login --device-auth
```

Docker では次を使います。

- Codex 認証: `./.docker/codex-home`
- Playwright profile: `./.docker/playwright-agent-profile`
- SQLite: `./.docker/data/app.sqlite`

詳細は [docs/docker.md](/Users/yuya/dev/codex-agent/docs/docker.md) を参照してください。

開発時:

```bash
npm run dev
```

補足:

- アプリ本体は環境変数をそのまま読みます
- Docker Compose は `.env` を読めますが、ローカル実行時に `.env` を自動ロードはしません
- 起動時に `CODEX_HOME` の値が worker プロセスにも渡されます

## 環境変数

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
CODEX_HOME=~/.codex
CODEX_WORKER_COMMAND=codex
CODEX_WORKER_ARGS="app-server"
CODEX_WORKER_CWD=
SQLITE_PATH=./data/app.sqlite
SLACK_AGENT_CHAT_STATUS_ENABLED=false
PORT=
```

`SLACK_AGENT_CHAT_STATUS_ENABLED=true` にすると、進捗通知に `assistant.threads.setStatus` を使います。通常の DM 運用や未対応 token の環境では `false` のまま使ってください。

## npm scripts

- `npm run doctor`: 環境チェック
- `npm start`: 本番起動
- `npm run dev`: watch 起動
- `npm run check`: TypeScript 型チェック
- `npm test`: テスト実行
