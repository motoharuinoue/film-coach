# ADR-0004: 解析結果の形を JSON Schema で一元管理する

- 状態：採用
- 日付：2026-10-05

## 背景

解析結果は Python で作り、TypeScript の画面で読む。さらに公開デモでは、Python を動かさずに解析済みの JSON だけで画面を動かしたい。

## 決定

- `packages/schema` に JSON Schema を置き、版番号を持たせる。
- Python 側（Pydantic）と TypeScript 側の型は、ここから生成する。
- M0 では先に TypeScript の型と仮データを作り、M1 で JSON Schema に移す。
- M1-1 で骨格の時系列のスキーマ（`pose-sequence.v1.schema.json`）と、両言語の結果を突き合わせる共通データ（`fixtures/parity.v1.json`）を追加した。
- M1-3 で API の応答のスキーマ（`video-record.v1` / `target-track.v1`）を追加した。型の自動生成（json-schema-to-typescript）は、組（`prefixItems`）に対応しておらず `unknown` になったため使わない。代わりに、Python のテストが実際の API から応答の見本（`fixtures/api-samples.v1.json`）を作り、TypeScript のテストが「見本がスキーマに合うこと」と「画面の読み込み処理が見本を正しく読めること」を確かめる（契約テスト）。どちらかが形を変えると、どちらかのテストが落ちる。

## 結果

- Python と TypeScript で形がずれない。
- `samples/` の解析済み JSON を読むだけで、公開デモが同じ画面を表示できる。
