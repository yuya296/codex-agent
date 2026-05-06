# codex-agent

Slack DM と Codex (`codex app-server`) をつなぐ最小構成のエージェントです。  
構成は `gateway / worker` を中心にした最小構成で、会話制御は `Gateway` と Chat SDK の `thread.state` に寄せています。

このリポジトリでは **ソースコードを SSoT (Single Source of Truth)** とし、`docs/` は思想、全体像、運用手順を補助する概要資料として扱います。

## 必要環境

- Node.js 24 系
- npm
- Codex CLI（`codex app-server` が使えるバージョン）
- Slack App の認証情報
  - Bot Token: `xoxb-...`
  - Signing Secret
- Redis

## セットアップ

1. 依存関係をインストール

```bash
npm install
```

2. 環境変数を設定

```bash
export SLACK_BOT_TOKEN='xoxb-...'
export SLACK_SIGNING_SECRET='...'
export REDIS_URL='redis://localhost:6379'
```

必要に応じて以下も設定します。

- `SLACK_BOT_USERNAME`
- `CODEX_HOME`
- `CODEX_WORKER_COMMAND`
- `CODEX_WORKER_ARGS`
- `CODEX_WORKER_CWD`
- `WORKER_STREAM_EVENT_TIMEOUT_MS`
- `SLACK_AGENT_CHAT_STATUS_ENABLED`
- `DEBUG_SLACK_EVENTS`
- `DEBUG_WORKER_EVENTS`
- `DEBUG_WORKER_EVENT_DELTAS`
- `PORT`

デフォルト値:

- `CODEX_WORKER_COMMAND`: `codex`
- `CODEX_WORKER_ARGS`: `app-server`
- `SLACK_BOT_USERNAME`: `codex-agent`
- `CODEX_HOME`: `$CODEX_HOME` があればそれ、なければ `~/.codex`
- `REDIS_URL`: 必須
- `WORKER_STREAM_EVENT_TIMEOUT_MS`: `300000`
- `SLACK_AGENT_CHAT_STATUS_ENABLED`: `false`

## Docs

- [Docs Guide](./docs/README.md)
- [Architecture Overview](./docs/architecture_overview.md)
- [Architecture](./docs/architecture.md)
- [Spec](./docs/spec.md)
- [Slack API 設定ガイド](./docs/slack-api-setup.md)
- [Docker 運用ガイド](./docs/docker.md)
- [Archive](./docs/archive/)

必要な権限の要点:

- Bot Token Scopes: `chat:write`, `im:history`, `files:write`, `files:read`, `assistant:write`
- Event Subscription: `message.im`, `assistant_thread_started`, `assistant_thread_context_changed`
- Interactivity: ON
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

## 起動

```bash
npm start
```

SQLite-backed session model からの初回アップグレードでは、進行中 session と pending approval は引き継がれません。`SESSION_MIGRATION_SQLITE_PATH` は廃止済みで、設定すると起動時にエラーにします。

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
- app / worker の作業ディレクトリ: `/app`

詳細は [docs/docker.md](./docs/docker.md) を参照してください。

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
SLACK_SIGNING_SECRET=...
SLACK_BOT_USERNAME=codex-agent
REDIS_URL=redis://localhost:6379
DEBUG_SLACK_EVENTS=false
DEBUG_WORKER_EVENTS=false
DEBUG_WORKER_EVENT_DELTAS=false
CODEX_HOME=/root/.codex
CODEX_WORKER_COMMAND=codex
CODEX_WORKER_ARGS="app-server"
CODEX_WORKER_CWD=/app
WORKER_STREAM_EVENT_TIMEOUT_MS=300000
SLACK_AGENT_CHAT_STATUS_ENABLED=false
PORT=
```

`SLACK_AGENT_CHAT_STATUS_ENABLED=true` にすると、進捗通知に `assistant.threads.setStatus` を使います。classic な DM スレッド返信を維持したい場合は、Slack App 側の `Agent or Assistant` は OFF にしてください。

DM の流れは、初回投稿を `onDirectMessage`、その後の継続投稿を `onSubscribedMessage` として扱います。会話の継続に必要な最小状態は Chat SDK の `thread.state` に置き、SQLite の移行手順はありません。

Webhook は `POST /api/webhooks/slack` で受けます。ローカルで Slack と疎通させる場合は、`PORT` で公開した HTTP endpoint を ngrok などで外部公開してください。

通常回答の completed メッセージは、送信直前に Markdown を Slack 向けテキストへ整形します。箇条書きは `* `、番号付きリストは `1. ` の行構造を保つようにしています。ローカル画像パス（`/tmp/...png` など）が含まれる場合は、本文から取り除いたうえで thread にファイル添付します。Slack で受け取った画像添付は bot token の `files:read` で download し、一時ファイルのパスを worker に渡します。approval と status は今回の変換対象外です。

DM では管理コマンドも使えます。Slack の slash command ではなく通常メッセージとして送ります。先頭の空白は任意です。

- `/help`
- `/status`
- `/doctor`
- `/worker-restart`
- `/codex-check-update`

これらのレスポンスは英語です。

`WORKER_STREAM_EVENT_TIMEOUT_MS` は worker の turn 内で無通信を許容する最大時間です。重い処理で 5 分が短い場合だけ伸ばしてください。

`DEBUG_WORKER_EVENTS=true` にすると、worker から届いた turn 関連イベントを `[worker:event]` としてログ出力します。approval 待ち、サポート外の対話要求、silent timeout の切り分けに使えます。

`DEBUG_WORKER_EVENT_DELTAS=true` を追加すると、`item/agentMessage/delta` などの高頻度イベントも出します。通常は `false` のままにしてください。

## npm scripts

- `npm run doctor`: 環境チェック
- `npm start`: 本番起動
- `npm run dev`: watch 起動
- `npm run check`: TypeScript 型チェック
- `npm test`: `tsx --test` で `tests/specs/*/*.test.ts` と `tests/integration/*.test.ts` をまとめて実行
