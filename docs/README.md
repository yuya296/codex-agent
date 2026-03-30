# Docs Guide

このリポジトリでは、**ソースコードを SSoT (Single Source of Truth)** とする。

- `src/` と `tests/` が実装仕様の正本
- `docs/` は設計意図、全体像、運用手順の補助資料
- ドキュメントとコードが食い違う場合は、まずコードを優先して読む

## Recommended reading order

1. [Architecture Overview](./architecture_overview.md)
2. [Architecture](./architecture.md)
3. [Spec](./spec.md)
4. 必要に応じて運用ガイド
   - [Slack API Setup](./slack-api-setup.md)
   - [Docker Guide](./docker.md)
   - [Remote Deploy Guide](./deploy-remote.md)

## Document roles

- `architecture_overview.md`
  - 現在のシステム境界を俯瞰するための図
- `architecture.md`
  - 根幹の設計思想と責務分担のメモ
- `spec.md`
  - 現在の実装で重要なスコープと不変条件の概要
- `slack-api-setup.md`
  - Slack App の設定手順
- `docker.md`
  - Docker での運用手順
- `deploy-remote.md`
  - remote Docker host への配置手順

## Historical documents

詳細な検討メモや過去時点の資料は [archive](./archive/) に置く。
これらは参考情報であり、現在の仕様の正本ではない。
