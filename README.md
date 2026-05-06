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
  - App-Level Token: `xapp-...`
- Redis

## セットアップ

1. 依存関係をインストール

```bash
npm install
```

2. 環境変数を設定

```bash
export SLACK_BOT_TOKEN='xoxb-...'
export SLACK_APP_TOKEN='xapp-...'
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
- [Remote Deploy Guide](./docs/deploy-remote.md)
- [Archive](./docs/archive/)

必要な権限の要点:

- Bot Token Scopes: `chat:write`, `im:history`, `files:write`, `files:read`, `assistant:write`
- App-Level Token Scopes: `connections:write`
- Event Subscription: `message.im`, `assistant_thread_started`, `assistant_thread_context_changed`
- Interactivity: ON
- Socket Mode: ON
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

ローカル起動では `compose.yaml` と `compose.override.yaml` が自動で使われます。`.env.example` を `.env` にコピーして使えます。

```bash
docker compose up -d --build
docker compose exec app codex login --device-auth
```

ローカル Docker では次を使います。

- Codex 認証: `./.docker/codex-home`
- Playwright profile: `./.docker/playwright-agent-profile`
- app / worker の作業ディレクトリ: `/app`

remote Docker host では `compose.server.yaml` を追加指定します。

```bash
deploy/server/build.sh
deploy/server/up.sh
```

registry image を使う場合は `deploy/server/build.sh` の代わりに `deploy/server/pull.sh` を使います。

補助スクリプトを使わない場合:

```bash
docker compose --env-file /etc/codex-agent/app.env \
  -f compose.yaml \
  -f compose.server.yaml \
  up -d
```

remote では次を使います。

- Compose env file: `/etc/codex-agent/app.env`
- 永続データ root: `/srv/codex-agent`
- Codex 認証: `/srv/codex-agent/codex-home`
- Playwright profile: `/srv/codex-agent/playwright-agent-profile`
- SQLite: `/srv/codex-agent/data/app.sqlite`
- `APP_IMAGE=codex-agent:local` の場合は host build、pullable image を指定した場合は pull 運用

Docker 内の rules/skills は local / remote 共通で 2 層です。

- project local: `/app/AGENTS.md`, `/app/.codex/skills`
- Docker 用 `CODEX_HOME` defaults: `docker/codex-home-defaults/`

container 起動時は `docker/codex-home-defaults/` だけを `~/.codex` に初回 seed します。global rules の実体は `~/.codex/AGENTS.md` で、`~/AGENTS.md` はその symlink として扱います。`/app/.codex/skills` をそのまま複製はしません。既存の `CODEX_HOME` 側ファイルは保持され、repo 更新で自動上書きはしません。

詳細は [docs/docker.md](./docs/docker.md) と [docs/deploy-remote.md](./docs/deploy-remote.md) を参照してください。

開発時:

```bash
npm run dev
```

補足:

- アプリ本体は環境変数をそのまま読みます
- local では `.env` と `compose.override.yaml` が自動で読まれます
- remote では `--env-file /etc/codex-agent/app.env -f compose.yaml -f compose.server.yaml` を明示します
- 起動時に `CODEX_HOME` の値が worker プロセスにも渡されます
- Docker は host repo を bind mount しないので、コード変更反映には再 build が必要です

## 環境変数

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_BOT_USERNAME=codex-agent
REDIS_URL=redis://localhost:6379
APP_IMAGE=codex-agent:local
DEBUG_SLACK_EVENTS=false
DEBUG_WORKER_EVENTS=false
DEBUG_WORKER_EVENT_DELTAS=false
CODEX_HOME=/root/.codex
CODEX_WORKER_COMMAND=codex
CODEX_WORKER_ARGS="app-server"
CODEX_WORKER_CWD=/app
WORKER_STREAM_EVENT_TIMEOUT_MS=300000
SLACK_AGENT_CHAT_STATUS_ENABLED=false
```

remote 用テンプレートは `deploy/env/server.env.example` を使います。`HOST_STATE_ROOT` は remote 専用 compose 変数で、既定値は `/srv/codex-agent` です。

`SLACK_AGENT_CHAT_STATUS_ENABLED=true` にすると、進捗通知に `assistant.threads.setStatus` を使います。classic な DM スレッド返信を維持したい場合は、Slack App 側の `Agent or Assistant` は OFF にしてください。

DM の流れは、初回投稿を `onDirectMessage`、その後の継続投稿を `onSubscribedMessage` として扱います。会話の継続に必要な最小状態は Chat SDK の `thread.state` に置き、SQLite の移行手順はありません。

Chat SDK の Slack Socket Mode を使います。public webhook URL は不要で、`SLACK_APP_TOKEN` を使って Slack へ WebSocket 接続します。

通常回答の completed メッセージは、送信直前に Markdown を Slack 向けテキストへ整形します。箇条書きは `* `、番号付きリストは `1. ` の行構造を保つようにしています。ローカル画像パス（`/tmp/...png` など）が含まれる場合は、本文から取り除いたうえで thread にファイル添付します。Slack で受け取った添付ファイルは bot token の `files:read` で download し、対応形式の画像・PDF・テキスト系ファイルは一時ファイルのパスを worker に渡します。テキスト系と PDF は内容プレビューも worker 入力へ埋め込みます。未対応 MIME type やサイズ上限超過は thread に warning を返し、turn 後に一時ディレクトリを cleanup します。approval と status は今回の変換対象外です。

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
