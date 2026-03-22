# playwright-cli-docker

Docker 内の `playwright-cli` 実行に限定した補助 skill。

## 使い方

- 最初のコマンドから `-s=<name>` で named session を使う。
- 基本手順は `open` または `goto` → 必要な操作 → `screenshot --filename=/tmp/...png` → `close`。
- `--help` の実行は避け、必要なら既存 knowledge か短いコマンドで確認する。
- Slack の画像返信機能を再検証するときは、新しいスクショを毎回撮らず、既にある `/tmp/...png` をそのまま返す指示を優先する。
- 手動ログインが必要な確認では headed 実行を使い、profile は container の既定 path に保存される前提で扱う。
