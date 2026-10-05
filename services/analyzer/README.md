# services/analyzer

Film Coach の解析サービス（Python）。骨格の時系列から、フェーズ分割と QB 指標を出します。

フロントエンドの `apps/web/src/domain` と同じ規則を実装し、`packages/schema/fixtures/parity.v1.json` で両言語の結果が一致することを確かめています。

## 層（クリーンアーキテクチャ）

| 層 | 置くもの | 依存してよい層 |
|---|---|---|
| `domain` | 骨格・フェーズ分割・指標。標準ライブラリだけを使う | domain |
| `application` | ユースケースとポート（外部への窓口） | domain |
| `infrastructure` | ポートの実装（JSON の読み書き。M1-2 で骨格推定・動画の正規化） | domain, application |
| `adapters` | 入口（CLI。M1-3 で HTTP） | domain, application |
| `bootstrap.py` | 依存を組み立てる | すべて |

依存の向きは `uv run lint-imports` で検査します。

## 使い方

```bash
uv sync
uv run pytest            # テスト（両言語の一致の確認を含む）
uv run lint-imports      # 層のルールの検査
uv run ruff check        # lint
uv run mypy              # 型検査

# 骨格の時系列（packages/schema/pose-sequence.v1.schema.json）からフェーズと指標を出す
uv run film-coach analyze-pose path/to/pose.json --camera side
```
