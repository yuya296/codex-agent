# Docker 運用ガイド

## 概要

`codex-agent` を Docker Compose で起動できます。  
実行定義は `compose.yaml` を共通基盤として、local は `compose.override.yaml`、remote は `compose.server.yaml` を重ねます。

app 自体は image 内の `/app` で動作し、Codex worker の作業対象も `/app` です。host の repo は container に bind mount しません。コード変更を反映するには再 build が必要です。base image は `node:24-trixie` を使い、browser は Debian package の `chromium` を入れています。

## 前提

- Docker
- Docker Compose
- Slack App の設定完了

## Compose ファイル

- `compose.yaml`
  - 共通の service 定義
- `compose.override.yaml`
  - local 専用の build と bind mount
- `compose.server.yaml`
  - remote 専用の bind mount と restart policy

`docker compose up -d --build` は local で `compose.override.yaml` まで自動で読みます。
remote は `-f compose.yaml -f compose.server.yaml` を明示します。

## local で使うパス

- Codex 認証: `./.docker/codex-home`
- Playwright agent profile: `./.docker/playwright-agent-profile`
- SQLite: `./.docker/data/app.sqlite`
- project local rules/skills: `/app/AGENTS.md`, `/app/.codex/skills`
- Docker 用 `CODEX_HOME` defaults: `docker/codex-home-defaults/`

これらは local 用 bind mount です。host の通常 `.codex` や普段使いの Chrome profile は共有しません。

## remote で使うパス

- Compose env file: `/etc/codex-agent/app.env`
- 永続データ root: `/srv/codex-agent`
- Codex 認証: `/srv/codex-agent/codex-home`
- Playwright agent profile: `/srv/codex-agent/playwright-agent-profile`
- SQLite: `/srv/codex-agent/data/app.sqlite`

remote 側の bind mount root は `HOST_STATE_ROOT` で上書きできます。既定値は `/srv/codex-agent` です。

## rules / skills の扱い

Docker では rules / skills を次の 2 層で分けます。

- `/app/AGENTS.md`, `/app/.codex/skills`
  - repo に含まれる project local 定義
- `docker/codex-home-defaults/`
  - `~/.codex/AGENTS.md`, `~/.codex/skills` へ初回 seed する Docker 用デフォルト

entrypoint は `docker/codex-home-defaults/` だけを `CODEX_HOME` に初回投入します。`~/AGENTS.md` は `~/.codex/AGENTS.md` への symlink として揃えます。`/app/.codex/skills` は自動複製しません。  
既に `CODEX_HOME` 側に存在するファイルは保持し、repo 更新で自動上書きはしません。ただし default 側は正常で、seed 済みの `SKILL.md` が壊れている場合だけは起動時に自動修復します。

デフォルトを再投入したい場合は、対象の `CODEX_HOME` 側ファイルを削除してから container を再起動します。

## 環境変数

local は `.env.example` を `.env` にコピーして値を入れる運用で構いません。Docker Compose が `.env` と `compose.override.yaml` を自動で読みます。
remote は `deploy/env/server.env.example` を `/etc/codex-agent/app.env` にコピーし、`--env-file` で明示します。

| 変数 | 必須 | 既定値 | 用途 |
|---|---|---|---|
| `APP_IMAGE` | 任意 | `codex-agent:local` | compose が使う image 名。local build tag や remote pull 元を切り替える |
| `HOST_STATE_ROOT` | remote のみ | `/srv/codex-agent` | remote 側 bind mount の root |
| `SLACK_BOT_TOKEN` | 必須 | なし | Slack Bot Token。メッセージ送信、DM 受信、ファイル操作に使う |
| `SLACK_APP_TOKEN` | 必須 | なし | Slack App-Level Token。Socket Mode 接続に使う |
| `SLACK_AGENT_CHAT_STATUS_ENABLED` | 任意 | `false` | `assistant.threads.setStatus` を使うときに `true` にする |
| `DEBUG_SLACK_EVENTS` | 任意 | `false` | Slack event / client 呼び出しをログ出力する |
| `DEBUG_WORKER_EVENTS` | 任意 | `false` | worker の主要イベントをログ出力する |
| `DEBUG_WORKER_EVENT_DELTAS` | 任意 | `false` | 高頻度な delta イベントも追加でログ出力する |
| `CODEX_HOME` | 任意 | `/root/.codex` | container 内の Codex 認証・設定ディレクトリ |
| `CODEX_WORKER_COMMAND` | 任意 | `codex` | worker プロセス起動コマンド |
| `CODEX_WORKER_ARGS` | 任意 | `app-server` | worker 起動時の引数 |
| `CODEX_WORKER_CWD` | 任意 | `/app` | worker の作業ディレクトリ |
| `WORKER_STREAM_EVENT_TIMEOUT_MS` | 任意 | `300000` | worker turn 内で無通信を許容する最大時間(ms) |
| `SQLITE_PATH` | 任意 | `/data/app.sqlite` | SQLite ファイルの保存先 |
| `PORT` | 任意 | なし | 必要な場合のみ app の待受ポートを明示する |
| `PLAYWRIGHT_AGENT_PROFILE_DIR` | 任意 | `/profiles/agent` | Playwright 用ブラウザ profile の保存先 |
| `PLAYWRIGHT_MCP_CONFIG` | 任意 | `/run/playwright/cli.config.json` | Playwright MCP の設定ファイルパス |

## local 起動

```bash
docker compose up -d --build
```

ソースコードを変えたら、app 本体へ反映するには再 build が必要です。

ログ確認:

```bash
docker compose logs -f app
```

## local 初回 Codex 認証

container 内で Codex にログインします。

```bash
docker compose exec app codex login --device-auth
```

この認証状態は `./.docker/codex-home` に残るため、container 再起動後も維持されます。

補足:

- Docker では browser callback の `localhost` が container 側になるため、通常の `codex login` より `--device-auth` を標準手順にします
- API key を使う場合は `codex login --with-api-key` でも構いません

container 内確認:

```bash
docker compose exec app sh -lc 'echo $CODEX_HOME && echo $CODEX_WORKER_CWD'
```

## remote 起動

remote は `compose.server.yaml` と repo 外の env file を明示します。

```bash
docker compose --env-file /etc/codex-agent/app.env \
  -f compose.yaml \
  -f compose.server.yaml \
  up -d
```

補助スクリプトも使えます。

```bash
deploy/server/bootstrap.sh
deploy/server/build.sh
deploy/server/pull.sh
deploy/server/up.sh
deploy/server/logs.sh
deploy/server/login-codex.sh
```

remote 更新:

```bash
deploy/server/build.sh
deploy/server/up.sh
```

registry image を使う場合:

```bash
deploy/server/pull.sh
deploy/server/up.sh
```

`pull` は `APP_IMAGE` が registry image のときだけ使います。`codex-agent:local` を host build している場合は、`deploy/server/build.sh` を使います。
`HOST_STATE_ROOT` を変えて初回 bootstrap したい場合は、`HOST_STATE_ROOT=/your/path deploy/server/bootstrap.sh` のように shell 側で渡します。

Lightsail Instance を前提にした詳細手順は [deploy-remote.md](./deploy-remote.md) を参照してください。

## timeout / hang 切り分け

`worker execution failed: Error: timed out waiting for worker stream event (300000ms)` が出る場合は、まず `DEBUG_WORKER_EVENTS=true` で最後の worker event を確認してください。通常は高頻度 delta を抑制しているので、ログ量は大きくなりません。

```bash
echo 'DEBUG_WORKER_EVENTS=true' >> .env
docker compose up -d --build
docker compose logs -f app
```

本当に長い無通信処理で 5 分が短いだけなら、`WORKER_STREAM_EVENT_TIMEOUT_MS` を伸ばします。

`item/agentMessage/delta` まで見たい場合だけ、追加で `DEBUG_WORKER_EVENT_DELTAS=true` を使います。

## Playwright profile

`playwright-cli` は container 内で動きます。  
profile は `PLAYWRIGHT_AGENT_PROFILE_DIR` に固定され、local では host の `./.docker/playwright-agent-profile`、remote では `${HOST_STATE_ROOT}/playwright-agent-profile` に保存されます。browser は image 内の `/usr/bin/chromium` を使います。

既存の個人用 Chrome profile を直接共有する運用は非推奨です。lock や破損、普段使いブラウザとの競合が起きやすいためです。

## 補足

- app 設定は container 環境変数をそのまま使います
- Docker は `/app` 固定の image 実行前提で、host repo を live mount しません
- remote は repo 外の env file と永続データ root を前提にします
- 今回は秘密情報隔離は最小対応です。worker への env allowlist までは入れていません
- Playwright 公式 docs の推奨に合わせて `init: true` と `ipc: host` を compose に入れています
