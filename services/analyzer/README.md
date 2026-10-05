# services/analyzer

Film Coach の解析サービス（Python）。骨格の時系列から、フェーズ分割と QB 指標を出します。

フロントエンドの `apps/web/src/domain` と同じ規則を実装し、`packages/schema/fixtures/parity.v1.json` で両言語の結果が一致することを確かめています。

## 層（クリーンアーキテクチャ）

| 層 | 置くもの | 依存してよい層 |
|---|---|---|
| `domain` | 骨格・フェーズ分割・指標。標準ライブラリだけを使う | domain |
| `application` | ユースケースとポート（外部への窓口） | domain |
| `infrastructure` | ポートの実装（JSON の読み書き、人物検出・骨格推定（rtmlib）、動画の読み書き（OpenCV・ffmpeg）、モデルの取得） | domain, application |
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

# 骨格推定のモデル（約 145 MB）を data/models/ に取得する。最初に 1 回だけ
uv run film-coach models download

# 大勢が映る映像から 1 人を追い、その人の骨格を出す
# 「5 秒の時点で、画像の (1440, 430) に映っている人」を指す
uv run film-coach track ../../data/videos/clip.mov --at 5 --point 1440,430 --label "#5"
```

`track` は `data/outputs/<動画名>/` に次のファイルを書き出します（どれも git の管理外）。

| ファイル | 内容 |
|---|---|
| `track.json` | フレームごとの対象選手の枠と骨格（`packages/schema/target-track.v1.schema.json`） |
| `preview.mp4` | 映像全体に、対象選手の枠と骨格を重ねた動画 |
| `focus.mp4` | 対象選手を追いかけて切り出した動画 |

処理の流れ：

1. 全員を検出して IoU で追跡する（YOLOX-m）
2. 指した点を含む追跡を選ぶ
3. 人の陰で途切れた追跡を、位置と大きさでつなぎ直す。20 フレーム以内の抜けは補間する
4. 対象選手の枠だけ骨格を推定する（RTMPose-m）

1920×1080・30fps・20 秒の動画で、Apple M4 の CPU で約 85 秒かかります。

実際の動画とモデルを使う確認は、手元にあるときだけ動かします（CI では動かしません）。

```bash
uv run pytest -m integration
```
