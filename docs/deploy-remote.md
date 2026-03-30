# Remote Deploy Guide

このドキュメントは、`codex-agent` を remote Docker host へ置く手順をまとめる。  
ここでは Lightsail Instance のような、Docker Compose を使える汎用 Linux host を前提にする。

## 前提

- Docker と Docker Compose が導入済み
- この repo を host 上に配置済み
- Slack App の token を発行済み
- Codex CLI を container 内で使う運用を許容する

## 使うファイル

- compose base: `compose.yaml`
- remote override: `compose.server.yaml`
- remote env template: `deploy/env/server.env.example`
- remote helper scripts: `deploy/server/*.sh`

## 使うパス

- repo: 任意の checkout path
- env file: `/etc/codex-agent/app.env`
- state root: `/srv/codex-agent`
- Codex 認証: `/srv/codex-agent/codex-home`
- Playwright profile: `/srv/codex-agent/playwright-agent-profile`
- SQLite: `/srv/codex-agent/data/app.sqlite`

必要に応じて `HOST_STATE_ROOT` で state root を変えられる。

## 初期セットアップ

1. state ディレクトリを作る

```bash
deploy/server/bootstrap.sh
```

2. env file を配置する

```bash
sudo mkdir -p /etc/codex-agent
sudo cp deploy/env/server.env.example /etc/codex-agent/app.env
sudo chmod 600 /etc/codex-agent/app.env
```

3. `/etc/codex-agent/app.env` を編集する

最低限、次を設定する。

- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN`

`APP_IMAGE` は運用に合わせて選ぶ。

- host build を使うなら `codex-agent:local`
- pull 運用なら pull 可能な image tag

## image を用意する

host build の場合:

```bash
deploy/server/build.sh
```

pullable image を使う場合:

```bash
deploy/server/pull.sh
```

## 起動

```bash
deploy/server/up.sh
```

ログ確認:

```bash
deploy/server/logs.sh
```

## 初回 Codex 認証

container 起動後、device auth でログインする。

```bash
deploy/server/login-codex.sh
```

認証状態は `/srv/codex-agent/codex-home` に残るため、container 再起動後も維持される。

## 更新

host build の場合:

```bash
git pull
deploy/server/build.sh
deploy/server/up.sh
```

pullable image の場合:

```bash
git pull
deploy/server/pull.sh
deploy/server/up.sh
```

## バックアップ

最低限バックアップ対象にするのは次の 2 つ。

- `/srv/codex-agent/codex-home`
- `/srv/codex-agent/data`

Playwright の login state を保持したいなら、必要に応じて `/srv/codex-agent/playwright-agent-profile` も含める。

Lightsail では instance snapshot か disk snapshot を使う。  
永続データを instance root disk から分けたい場合は、state root を別 disk に載せる。
