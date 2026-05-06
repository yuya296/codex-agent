# Tests Guide

このディレクトリでは、テストを **実装を説明する仕様書** として読むことを意図する。

- 挙動の正本は `src/` と `tests/`
- `docs/` は概要と背景説明
- テスト名は「何を保証するか」が先に読める文にする

## Directory structure

- `specs/`
  - モジュール単位の仕様テスト。`src/` の責務境界に対応させる
- `integration/`
  - subsystem をまたいだ主要フローの仕様
- `support/`
  - テスト支援コード。仕様の正本ではない
- `fixtures/`
  - モックプロセスや固定データ

## Specs structure

- `specs/admin/`
  - 運用コマンドの仕様
- `specs/cli/`
  - 補助 CLI / doctor 系の仕様
- `specs/config/`
  - 環境変数と設定解決の仕様
- `specs/gateway/`
  - Chat SDK thread / Slack presentation / approval flow の仕様
- `specs/worker/`
  - worker runtime / protocol / helper の仕様

## Naming rules

- ファイル名は「どのモジュールのどの仕様か」が分かるように付ける
- テスト名は「実装名」より「保証したい振る舞い」を優先して書く
- テスト名は `Given/When/Then` の単語自体は使わなくてもよいが、前提・操作・期待結果が自然文で読める形にする
- 単に `works` `handles` `returns correctly` のような曖昧な表現で終わらせない
- `unit` / `integration` は必要な場合だけファイル名に残し、主語はモジュールやシナリオにする
