# ADR-0004: 解析結果の形を JSON Schema で一元管理する

- 状態：採用
- 日付：2026-10-05

## 背景

解析結果は Python で作り、TypeScript の画面で読む。さらに公開デモでは、Python を動かさずに解析済みの JSON だけで画面を動かしたい。

## 決定

- `packages/schema` に JSON Schema を置き、版番号を持たせる。
- Python 側（Pydantic）と TypeScript 側の型は、ここから生成する。
- M0 では先に TypeScript の型と仮データを作り、M1 で JSON Schema に移す。

## 結果

- Python と TypeScript で形がずれない。
- `samples/` の解析済み JSON を読むだけで、公開デモが同じ画面を表示できる。
