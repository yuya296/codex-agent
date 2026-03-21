# Refactor Review (gateway / orchestrator / worker)

## 1. 対象と観点

- 対象: `src/gateway`, `src/orchestrator`, `src/worker`
- 観点:
  - モジュール規模（把握しやすさ）
  - 責務分担（境界の明瞭さ）
  - 人間によるトレーサビリティ（追跡のしやすさ）
  - 独自実装の量（既存ライブラリ移譲余地）

## 2. 規模サマリ

`wc -l src/gateway/*.ts src/orchestrator/*.ts src/worker/*.ts` での行数:

| module | file | LOC |
|---|---|---:|
| gateway | `src/gateway/bolt.ts` | 309 |
| gateway | `src/gateway/gateway.ts` | 375 |
| orchestrator | `src/orchestrator/orchestrator.ts` | 235 |
| worker | `src/worker/stdio-jsonrpc-worker-client.ts` | 853 |
| worker | `src/worker/restartable-worker-client.ts` | 47 |
| worker | `src/worker/types.ts` | 29 |

所感:

- `worker` が合計 929 行で、特に `stdio-jsonrpc-worker-client.ts` 853 行に集中。
- `gateway` は 684 行で、Slack イベント解釈と表示変換が同居。
- `orchestrator` は 235 行だが、分岐・状態遷移・通知・エラーハンドリングの重複が目立つ。

## 3. 現状責務の整理

### 3.1 gateway

実装上の責務:

- Slack message event から start/continue を判定して orchestrator を呼ぶ。
- admin command 解釈・実行。
- approval action を orchestrator に橋渡し。
- 実行中/完了/失敗通知の Slack 変換。
- Markdown -> Slack mrkdwn 変換。
- ローカル画像抽出・アップロード対象化。
- Slack 添付画像を一時ディレクトリにダウンロードし、本文にパス注入。

主な該当箇所:

- `Gateway.handleMessageEvent`, `notify*` 群。
- `buildSlackMessageEvent`, `downloadSlackImageFiles`。
- `toSlackMrkdwn`, `renderSlackCompletedMessage`, `extractLocalImageFiles`。

### 3.2 orchestrator

実装上の責務:

- Session 作成/継続/approval 解決。
- Session state 永続化（repository 経由）。
- Worker イベントを Session state + Gateway 通知に反映。
- running/waiting_approval 時の follow-up message 方針実装。

主な該当箇所:

- `startSessionFromSlack`, `continueSessionFromSlack`, `resolveApproval`。
- `applyWorkerEvent`（イベント->状態遷移・通知の集約点）。

### 3.3 worker

実装上の責務:

- 子プロセス起動（`codex app-server`）と stdio JSON-RPC 通信。
- initialize/thread start/resume/turn start/steer 等の RPC 呼び出し。
- stream event の buffering/matching/timeout。
- approval request の検出・保留・応答。
- delta/itemCompleted/turnCompleted を `WorkerRunEvent` に還元。
- デバッグログとノイズ抑制。

主な該当箇所:

- `StdioJsonRpcWorkerClient` クラス全体。
- 特に `collectTurnEvents` がイベント集約ロジックの中心。

## 4. 問題点（トレーサビリティ/責務分担/独自実装量）

### 4.1 worker への複数関心事の集中

`StdioJsonRpcWorkerClient` に以下が同居している。

- transport（spawn/stdin/stdout）
- protocol（JSON-RPC request/response）
- session/turn 状態追跡
- approval ドメインロジック
- event 要約・ログポリシー

結果:

- 1 つの不具合の追跡で読む範囲が広くなる。
- 変更インパクトの見積もりが難しい。
- 単体テストの粒度が粗くなりやすい。

### 4.2 gateway の「Slack adapter」と「表示整形」の混在

`gateway.ts` は本来 adapter 層だが、Markdown 変換や画像抽出など表示ロジックを大量に持つ。

結果:

- Slack イベント処理を追いたい時に、表示系ユーティリティまで同時に読む必要がある。
- 表示仕様の変更が event routing のレビュー範囲に混ざる。

### 4.3 orchestrator の分岐重複

`startSessionFromSlack` / `continueSessionFromSlack` / `resolveApproval` の各経路で、

- `notifyProgress('thinking...')`
- live event の有無分岐
- 失敗時の `failed` 反映

が反復している。

結果:

- 状態遷移の差分を人間が追いにくい。
- 仕様追加時に同種修正漏れの可能性が上がる。

### 4.4 既存ライブラリ移譲余地

現状は意図的に薄い構成だが、以下は独自実装割合が高い。

- Markdown -> Slack mrkdwn 変換（正規表現ベース）
- JSON-RPC ストリーム状態機械

完全置換はコストが高いが、責務分離だけでも読みやすさ改善余地が大きい。

## 5. アーキテクチャレビュー（現状評価）

### 5.1 良い点

- 全体の依存方向は明確（Gateway -> Orchestrator -> Worker/Repository）。
- Session source of truth と会話 source of truth の分離方針は docs と実装が整合。
- `WorkerClient` interface が存在し、実行基盤差し替え余地が確保されている。

### 5.2 改善優先度（高->低）

1. `worker` の内部責務分割（まずファイル内 private class レベルでも可）
2. `orchestrator` の run 実行テンプレート化（重複除去）
3. `gateway` の表示整形を専用モジュールへ移動

## 6. 最小変更での refactor 案（段階的）

「コード量最小」「過度な abstraction を避ける」を守る前提。

### Phase 1: worker の読解容易化（機能変更なし）

- `stdio-jsonrpc-worker-client.ts` 内で責務別セクションを明示。
- `collectTurnEvents` 内の分岐を小関数化（`handleDelta`, `handleItemCompleted`, `handleTurnCompleted` など）。
- approval 関連を `ApprovalTracker` 的な private helper に抽出（まず同ファイル内）。

狙い:

- クラス外公開 API は変えず、トレース時の移動コストだけ下げる。

### Phase 2: orchestrator の実行テンプレート化

- 「worker 呼び出し + liveEvent fallback + 失敗時 failed 通知」を `runWorkerFlow` に共通化。
- `start/continue/resolveApproval` は「前処理（state遷移）」と「実際の worker action 指定」に集中。

狙い:

- 状態遷移のレビュー単位を揃える。
- 例外経路を 1 箇所にまとめる。

### Phase 3: gateway の表示責務分離

- `gateway-renderer.ts`（仮）へ以下を移動。
  - `toSlackLoadingMessage`
  - `toSlackMrkdwn`
  - `renderSlackCompletedMessage`
  - 画像抽出関連
- `Gateway` 本体は「Slack event -> orchestrator command」「notifier -> publisher call」に絞る。

狙い:

- adapter の責務を明確化。
- 表示仕様変更時の影響範囲を狭くする。

## 7. ライブラリ移譲に関する提案

### 7.1 積極導入より先に「境界の可視化」を推奨

現段階では、いきなり外部ライブラリへ全面置換するより、先に境界を明確化した方が失敗コストが低い。

- Markdown 変換: 変換ルールが Slack 方言であるため、一般 markdown ライブラリを入れても後段変換は残る可能性が高い。
- JSON-RPC: 通信そのものより、Codex 固有イベントの状態機械が主要複雑性。

### 7.2 将来的な移譲候補（中期）

- JSON-RPC framing/request id 管理を既成ライブラリに寄せる（ただし stdio サポート要確認）。
- Markdown パースを remark 系で AST 化し、Slack レンダラを薄く保つ。

## 8. 具体的なレビュー観点（次の実装PRで見るべき点）

- worker の 1 ファイル当たり LOC を 400〜500 行程度まで段階削減できるか。
- orchestrator で `failed` 反映の分岐が 1 箇所に寄っているか。
- gateway が event routing と rendering の責務を明示的に分けられているか。
- `WorkerClient` / `GatewayNotifier` interface が肥大化していないか（最小維持）。

## 9. 結論

現状アーキテクチャの大枠（Gateway/Orchestrator/Worker の層構造）は妥当。
一方で、トレーサビリティ上の最大ボトルネックは `worker` の単一巨大実装。

したがって、最適な refactor 順序は以下。

1. worker 内責務分割（公開 API 不変）
2. orchestrator 実行テンプレート化
3. gateway 表示責務分離

この順序なら、独自実装を増やさずに、読みやすさと保守性を最小コストで改善できる。
