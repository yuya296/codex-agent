---
name: slack-image-dm-verification
description: Use when verifying this repository's Slack bot behavior by actually sending image-attached DMs in Slack Web, especially with `docker compose up -d --build` and `playwright-cli` against the CodexAgent DM thread.
---

# Slack Image DM Verification

この skill は、このリポジトリの Slack Bot に対して「画像付き DM を実送信して挙動確認する」ための手順を固定する。

## Use this skill when

- Slack 画像添付まわりの不具合を再現確認する
- `thinking...` が出るかを Slack 実画面で確認する
- Docker で起動した `codex-agent` に対して Playwright で DM を送る
- `file_share` イベントが入口で落ちていないかをログで確認する

## Preconditions

- 作業ディレクトリは repo root
- `.env` に Slack token 類が入っている
- 検証対象は `docker compose up -d --build` で起動する
- Slack Web に人間がログインできる
- 検証用画像は [assets/codex-logo.png](assets/codex-logo.png) を使う

## Workflow

1. まず `docker compose up -d --build` で app を更新起動する
2. `docker compose ps` と `docker compose logs --tail=80 app` で起動完了を確認する
3. `playwright-cli open --browser=chrome --headed --persistent <Slack DM URL>` で GUI ブラウザを開く
4. 未ログインならユーザにログインしてもらい、ログイン後に Playwright を再開する
5. 対象 DM の最新スレッドを開く
6. 画像付き投稿を試す
7. 送信直後に Slack 画面と `docker compose logs --tail=120 app` の両方を見る
8. 結果を「Slack UI」と「コンテナログ」で突き合わせて報告する

## Sending Rules

- 既存の会話を汚しすぎないよう、ユーザ指定のスレッドに返信する
- 画像は [assets/codex-logo.png](assets/codex-logo.png) を使う
- workspace 外の画像を無理に使わない
- approval が出て確認を妨げる場合は、その理由を記録してから閉じる

## Minimal Execution Pattern

1. `docker compose up -d --build`
2. `docker compose logs --tail=80 app`
3. `playwright-cli ... open --headed --persistent <url>`
4. スナップショットで返信 textbox と添付ボタンを特定
5. [assets/codex-logo.png](assets/codex-logo.png) を Playwright で添付する
6. 本文付きで送る
7. 直後に次を確認する

- Slack に自分の画像付き投稿が出る
- `thinking...` もしくは status 更新が出る
- bot 返信または approval が出る
- app ログに `subtype:"file_share"` の event が出る
- app ログに `assistant.threads.setStatus` が出る

## Failure Triage

- `thinking...` すら出ない
  - `app.event('message')` の入口で落ちている可能性を優先
  - `messageEvent` が `null` になっていないか確認
  - `team_id` / `user` / `channel_type` の shape 差分を疑う
- 画像付きのときだけ止まる
  - 画像ダウンロード処理の例外とログ有無を確認
  - `file_share` subtype のみ通る経路差分を確認
- approval で止まる
  - 返信不能ではなく worker 側の承認待ち
  - UI 上の approval message とコンテナログを証跡として残す

## Log Lines To Look For

- `[slack:event]` の `subtype:"file_share"`
- `[slack:event-dropped]`
- `[slack:message-handler-error]`
- `[slack:image-download-error]`
- `[slack:client]` の `assistant.threads.setStatus`
- `[slack:client]` の `chat.postMessage`

## Report Format

以下を短く返す。

- どのスレッドに何を送ったか
- Slack UI で何が見えたか
- コンテナログで何が出たか
- 再現したか / しなかったか
- approval や残課題があるか
