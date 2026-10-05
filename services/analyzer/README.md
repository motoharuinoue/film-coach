# services/analyzer

Film Coach の解析サービス（Python）。骨格の時系列から、フェーズ分割と QB 指標を出します。

フロントエンドの `apps/web/src/domain` と同じ規則を実装し、`packages/schema/fixtures/parity.v1.json` で両言語の結果が一致することを確かめています。

## 層（クリーンアーキテクチャ）

| 層 | 置くもの | 依存してよい層 |
|---|---|---|
| `domain` | 骨格・フェーズ分割・指標。標準ライブラリだけを使う | domain |
| `application` | ユースケースとポート（外部への窓口） | domain |
| `infrastructure` | ポートの実装（JSON の読み書き、人物検出・骨格推定（rtmlib）、動画の読み書き（OpenCV・ffmpeg）、モデルの取得） | domain, application |
| `adapters` | 入口（CLI、HTTP の API） | domain, application |
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

1. 全員を検出して IoU で追跡する（YOLOX-m）。場面の切り替わり（カット）を見つけたら、そこで追跡を切る
2. 指した点を含む追跡を選ぶ
3. 人の陰で途切れた追跡を、位置と大きさでつなぎ直す。20 フレーム以内の抜けは補間する。どちらもカットはまたがない
4. 対象選手の枠だけ骨格を推定する（RTMPose-m）

カットは、前のフレームからの色の分布（HSV ヒストグラム）と画の形（ごく小さく縮めた白黒の画像）の急な変化で見つけます（`infrastructure/video_cv.py` の `OpenCvShotDetector`）。いくつもの場面をつないだ YouTube の動画で、カットの向こうの別の人に乗り移らないようにするためです。クロスフェードのようなゆっくりした切り替わりは見つけられません。

1920×1080・30fps・20 秒の動画で、Apple M4 の CPU で約 85 秒かかります。

## HTTP の解析サービス

画面（`apps/web`）から使う API です。手元の画面からだけ使う前提で、`127.0.0.1` だけで待ち受けます。

```bash
uv run film-coach serve   # http://127.0.0.1:8787/api/health
```

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/health` | 状態とモデルの有無 |
| GET | `/api/videos` | 取り込んだ動画の一覧 |
| POST | `/api/videos` | 動画のアップロード（multipart、mp4 / mov / m4v、2 GB まで） |
| POST | `/api/videos/youtube` | YouTube の区間の取り込み（`{url, start, end}`、60 秒まで） |
| GET | `/api/videos/{id}` | 記録（`video-record.v1.schema.json`）と、使える URL |
| GET | `/api/videos/{id}/frame?t=秒` | 本人を指すためのフレーム（JPEG、幅 1280 まで） |
| GET | `/api/videos/{id}/media` | 元の動画（Range 対応）。YouTube の区間は解析のあとに消すので 410 |
| POST | `/api/videos/{id}/track` | 追跡の開始（`{t, x, y, label}`、座標は元の動画のピクセル）。202 でジョブを返す |
| GET | `/api/jobs/{jobId}/events` | 進み具合（SSE：`state` → `progress` → `done` / `failed`） |
| GET | `/api/videos/{id}/track` | 追跡結果（`target-track.v1.schema.json`） |
| GET | `/api/videos/{id}/outputs/{preview,focus}.mp4` | 確認用の動画 |

- 解析は 1 本ずつ裏で動かします（ONNX Runtime が CPU を使い切るため）
- YouTube から取り込んだ区間は、追跡が終わったら元の動画を消し、枠・骨格と出典だけを残します。元の動画の複製になる確認用の動画も作りません（ADR-0005）
- 画面の開発サーバー以外から使うときは、`FILM_COACH_ALLOWED_ORIGINS` で許可する画面を指定します

実際の動画とモデルを使う確認は、手元にあるときだけ動かします（CI では動かしません）。

```bash
uv run pytest -m integration
```
