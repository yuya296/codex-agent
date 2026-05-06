# Architecture

このドキュメントは、実装詳細の再記述ではなく、`codex-agent` の根幹の設計思想を短く共有するためのメモ。
挙動の正本は `src/` と `tests/` に置く。

## System intent

- Slack DM と `codex app-server` をつなぐ最小構成のエージェントである
- 独自実装は薄く保ち、会話実行の本体は `codex app-server` に委譲する
- ドキュメントは全体像と判断理由を補助し、実装仕様の写しにはしない

## Current boundaries

- `gateway`
  - 外部チャネルとの境界
  - Chat SDK thread と Slack presentation をまとめて扱う
- `worker`
  - `codex app-server` と対話する内部境界

## Core principles

- 1 Slack root thread = 1 Session
- 1 Session = 1 Codex thread
- Session の会話本体や approval 状態の source of truth は `codex app-server`
- `thread.state` には `codexThreadId` と `pendingApprovalId` だけを保持する
- 失敗後も同じ Slack thread から再開できることを優先する

## Documentation policy

- 図や文章は「なぜそうなっているか」「どこから読むか」を補助する
- 詳細仕様、詳細シーケンス、過去時点のレビュー記録は主系統の docs には置かない
- 歴史的な資料は `docs/archive/` に置く

## References

- [Architecture Overview](./architecture_overview.md)
- [Spec](./spec.md)
- [Docs Guide](./README.md)
