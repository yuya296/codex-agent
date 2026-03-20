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
- `WORKER_STREAM_EVENT_TIMEOUT_MS`
- `SQLITE_PATH`
- `SLACK_AGENT_CHAT_STATUS_ENABLED`
- `DEBUG_SLACK_EVENTS`
- `DEBUG_WORKER_EVENTS`
- `DEBUG_WORKER_EVENT_DELTAS`
- `PORT`

デフォルト値:

- `CODEX_WORKER_COMMAND`: `codex`
- `CODEX_WORKER_ARGS`: `app-server`
- `CODEX_HOME`: `$CODEX_HOME` があればそれ、なければ `~/.codex`
- `WORKER_STREAM_EVENT_TIMEOUT_MS`: `300000`
- `SLACK_AGENT_CHAT_STATUS_ENABLED`: `false`
- `SQLITE_PATH`: `./data/app.sqlite`

## Docs

- [仕様](./docs/spec.md)
- [アーキテクチャ](./docs/architecture.md)
- [図表](./docs/diagrams.md)
- [Slack API 設定ガイド](./docs/slack-api-setup.md)
- [Docker 運用ガイド](./docs/docker.md)

必要な権限の要点:

- App-Level Token scope: `connections:write`
- Bot Token Scopes: `chat:write`, `im:history`
- Event Subscription: `message.im`
- `Agents & AI Apps`: ON
- `Agent or Assistant`: OFF

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
- app / worker の作業ディレクトリ: `/app`

詳細は [docs/docker.md](/Users/yuya/dev/codex-agent/docs/docker.md) を参照してください。

開発時:

```bash
npm run dev
```

補足:

- アプリ本体は環境変数をそのまま読みます
- Docker Compose は `.env` を読めますが、ローカル実行時に `.env` を自動ロードはしません
- 起動時に `CODEX_HOME` の値が worker プロセスにも渡されます
- Docker は host repo を bind mount しないので、コード変更反映には再 build が必要です

## 環境変数

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
DEBUG_SLACK_EVENTS=false
DEBUG_WORKER_EVENTS=false
DEBUG_WORKER_EVENT_DELTAS=false
CODEX_HOME=/root/.codex
CODEX_WORKER_COMMAND=codex
CODEX_WORKER_ARGS="app-server"
CODEX_WORKER_CWD=/app
WORKER_STREAM_EVENT_TIMEOUT_MS=300000
SQLITE_PATH=./data/app.sqlite
SLACK_AGENT_CHAT_STATUS_ENABLED=false
PORT=
```

`SLACK_AGENT_CHAT_STATUS_ENABLED=true` にすると、進捗通知に `assistant.threads.setStatus` を使います。classic な DM スレッド返信を維持したい場合は、Slack App 側の `Agent or Assistant` は OFF にしてください。

通常回答の completed メッセージは、送信直前に Markdown から Slack の mrkdwn へ変換します。変換は `md-to-slack` 準拠で、見出しや画像はライブラリ仕様で落ちます。approval と status は今回の変換対象外です。

`WORKER_STREAM_EVENT_TIMEOUT_MS` は worker の turn 内で無通信を許容する最大時間です。重い処理で 5 分が短い場合だけ伸ばしてください。

`DEBUG_WORKER_EVENTS=true` にすると、worker から届いた turn 関連イベントを `[worker:event]` としてログ出力します。approval 待ち、サポート外の対話要求、silent timeout の切り分けに使えます。

`DEBUG_WORKER_EVENT_DELTAS=true` を追加すると、`item/agentMessage/delta` などの高頻度イベントも出します。通常は `false` のままにしてください。

## npm scripts

- `npm run doctor`: 環境チェック
- `npm start`: 本番起動
- `npm run dev`: watch 起動
- `npm run check`: TypeScript 型チェック
- `npm test`: テスト実行
