# Docker Codex Home Defaults

- このファイルは Docker 起動時に `~/AGENTS.md` へ初回 seed される。
- `/app` はソースコード、`~/.codex` は Docker 内 Codex の永続 state と custom skills の置き場。
- `/app/AGENTS.md` と `/app/.codex/skills` は project local の定義であり、ここから自動複製しない。
- `playwright-cli` を使うときは、最初のコマンドから named session を使い、作業後は `close` で閉じる。
- Slack の画像返信検証では、2回目以降は既存の `/tmp/...png` を返す経路を優先する。
