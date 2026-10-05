# packages/schema

フロントエンド（TypeScript）と解析サービス（Python）で共有するデータの形（[ADR-0004](../../docs/adr/0004-schema-driven.md)）。

| ファイル | 内容 |
|---|---|
| `pose-sequence.v1.schema.json` | 1 レップ分の骨格の時系列（COCO-17、ワールド 2D） |
| `video-record.v1.schema.json` | 解析サービスに取り込んだ動画の記録（API の応答と保存の形） |
| `target-track.v1.schema.json` | 大勢が映る映像で、指定した 1 人を追った結果（フレームごとの枠と骨格、画像のピクセル座標） |
| `fixtures/api-samples.v1.json` | API の応答の見本（Python のテストが作り、TypeScript の契約テストが使う） |
| `fixtures/parity.v1.json` | 両言語の実装が同じ結果を出すことを確かめる共通データ（合成骨格と、フェーズ・指標の期待値） |

## 共通データの更新

期待値は TypeScript の実装から作ります。ドメインの規則を変えたら、両言語を直したうえで作り直してください。

```bash
UPDATE_FIXTURES=1 npm test -- parity   # TypeScript 側で作り直す
cd services/analyzer && uv run pytest  # Python 側で一致を確かめる
```
