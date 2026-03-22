---
name: tests-as-documentation
description: Use when adding, renaming, reorganizing, or reviewing tests in this repository, especially when the goal is to make tests readable as specification and align them with module boundaries and behavior-first descriptions.
---

# Tests as Documentation

このリポジトリでは、テストは実装詳細の断片ではなく、挙動の仕様書として読む。

## Use this skill when

- テストを追加する
- テストの名前を見直す
- テスト階層を整理する
- 仕様として読みづらいテストをレビューする

## Core rules

- 仕様の正本は `src/` と `tests/`
- `docs/` は背景と概要に留める
- テストは `tests/specs/<module>/` を基本配置にする
- subsystem をまたぐ主要シナリオだけ `tests/integration/` に置く
- 補助コードは `tests/support/`、固定データやモックは `tests/fixtures/` に置く

## Naming rules

- ファイル名は「どのモジュールのどの仕様か」が分かるように付ける
- テスト名は実装名ではなく、保証したい振る舞いを優先して書く
- テスト名は `Given/When/Then` の単語を直接書かなくてもよいが、前提・操作・期待結果が自然文で読める形にする
- `works` `handles` `returns correctly` のような曖昧な説明で終わらせない

## Workflow

1. まず対象テストが `specs` / `integration` / `support` / `fixtures` のどこに属するか決める
2. `describe` は機能やモジュール、`test` / `it` は振る舞いを表すように書く
3. テスト名だけで前提・操作・期待結果が読めるか確認する
4. 実装クラス名や内部メソッド名に引っ張られすぎていないか確認する
5. 必要なら [tests/README.md](../../../tests/README.md) と [docs/adr/ADR-2-tests-as-documentation.md](../../../docs/adr/ADR-2-tests-as-documentation.md) を更新する
