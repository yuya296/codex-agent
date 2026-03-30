# Docker 運用ガイド

## 概要

`codex-agent` を Docker Compose で起動できます。  
Slack token は外部環境変数から渡し、container 側の Codex 認証は host の通常 `.codex` と分離して `./.docker/codex-home` に保持します。

app 自体は image 内の `/app` で動作し、Codex worker の作業対象も `/app` です。host の repo は container に bind mount しません。コード変更を反映するには再 build が必要です。base image は `node:24-trixie` を使い、browser は Debian package の `chromium` を入れています。

## 前提

- Docker
- Docker Compose
- Slack App の設定完了

## 使うパス

- Codex 認証: `./.docker/codex-home`
- Playwright agent profile: `./.docker/playwright-agent-profile`
- SQLite: `./.docker/data/app.sqlite`
- project local rules/skills: `/app/AGENTS.md`, `/app/.codex/skills`
- Docker 用 `CODEX_HOME` defaults: `docker/codex-home-defaults/`

これらは bind mount です。host の通常 `.codex` や普段使いの Chrome profile は共有しません。

## rules / skills の扱い

Docker では rules / skills を次の 2 層で分けます。

- `/app/AGENTS.md`, `/app/.codex/skills`
  - repo に含まれる project local 定義
- `docker/codex-home-defaults/`
  - `~/.codex/AGENTS.md`, `~/.codex/skills` へ初回 seed する Docker 用デフォルト

entrypoint は `docker/codex-home-defaults/` だけを `CODEX_HOME` に初回投入します。`~/AGENTS.md` は `~/.codex/AGENTS.md` への symlink として揃えます。`/app/.codex/skills` は自動複製しません。  
既に `./.docker/codex-home` 側に存在するファイルは保持し、repo 更新で自動上書きはしません。ただし default 側は正常で、seed 済みの `SKILL.md` が壊れている場合だけは起動時に自動修復します。

デフォルトを再投入したい場合は、対象の `./.docker/codex-home` 側ファイルを削除してから container を再起動します。

## 環境変数

`.env.example` を `.env` にコピーして値を入れる運用で構いません。Docker Compose が `.env` を読みます。

| 変数 | 必須 | 既定値 | 用途 |
|---|---|---|---|
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

## 起動

```bash
docker compose up -d --build
```

ソースコードを変えたら、app 本体へ反映するには再 build が必要です。

ログ確認:

```bash
docker compose logs -f app
```

## 初回 Codex 認証

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
profile は `PLAYWRIGHT_AGENT_PROFILE_DIR` に固定され、既定では host の `./.docker/playwright-agent-profile` に保存されます。browser は image 内の `/usr/bin/chromium` を使います。

既存の個人用 Chrome profile を直接共有する運用は非推奨です。lock や破損、普段使いブラウザとの競合が起きやすいためです。

## 補足

- app 設定は container 環境変数をそのまま使います
- Docker は `/app` 固定の image 実行前提で、host repo を live mount しません
- 今回は秘密情報隔離は最小対応です。worker への env allowlist までは入れていません
- Playwright 公式 docs の推奨に合わせて `init: true` と `ipc: host` を compose に入れています
