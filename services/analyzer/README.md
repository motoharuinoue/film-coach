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

### 投球の検出と QB 指標

```bash
# 追跡結果から投球を見つけ、1 本ずつフェーズと QB 指標を出す（身長は cm）
uv run film-coach throws ../../data/outputs/clip/track.json --height 180
```

横から撮った映像を前提に、次の順で計算します（`throws.json`、`packages/schema/throw-analysis.v1.schema.json`）。

1. カメラの動きを打ち消す：追跡のときに、人の枠を除いた背景の特徴点を追ってフレームごとのカメラの動きを見積もり（`OpenCvCameraMotion`、`track.json` の `camera`）、関節の位置を場面の最初のフレームの座標にそろえる。手持ちで選手を追いかけた映像のため
2. 信頼度の低い関節を、前後のフレームから補う。速く振った腕は像が流れ、手首を胴体の上に取り違えやすい（そのときの信頼度は 0.2〜0.4 ほど）
3. 画像の座標をワールド 2D（メートル）に直す（`domain/world.py`）
   - 縮尺：太もも・すね・体幹の長さ（姿勢で変わりにくい）の合計を、人体寸法の標準の比率（身長の 0.779）で割って、画像の上での身長を見積もる
   - 地面：低いほうの足首の位置の中央値
   - 投げる向きと利き腕：手首が最も速く動く向きと、速いほうの手首。左投げは左右の関節を入れ替え、右投げの規則で計算する
4. 投球を見つける（`domain/throws.py`）：投げる手首の速さのピーク（身長の 3 倍/秒以上）のうち、手首が肩より上にあるもの。区間は、ドロップの前の構えの終わりから始める
5. 1 本ずつ、平滑化 → フェーズ分割 → 指標（画面と同じ規則、`analyze-pose` と同じ）。フェーズは、リリースからさかのぼって、前足と骨盤の横の動きの速さで決める（足首の高さは、カメラからの距離で見え方が変わるので使わない）

合成データを画像に写したテストで、TypeScript の実装と同じフェーズ（±2 フレーム）と指標（角度は一致、長さは縮尺の見積もりのずれの数 % 以内）になること、カメラが動いても打ち消して同じ結果になることを確かめています。本人が小さく映っている（画面の高さの 40% 未満）ときは、結果に注意を添えます。

手持ちで撮った 30fps の投球ドリル 4 本（1080p、本人が画面の高さの約半分）で、4 本とも投球を 1 本ずつ見つけ、セット・ステップ・接地・リリースが映像と合うことを目で確かめました。ステップ幅は 4 本とも身長の 0.42〜0.45 倍でそろっています。

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
| POST | `/api/videos/{id}/throws` | 投球の解析（`{heightCm, camera, slowmo}`）。追跡した骨格だけを使うので、YouTube の区間でも動く。`slowmo` はスロー再生の倍率（YouTube のお手本はスロー再生が多い。速さと時間を実際の時間に直す） |
| GET | `/api/videos/{id}/throws` | 投球の解析結果（`throw-analysis.v1.schema.json`） |
| GET | `/api/youtube/status` | YouTube Data API のキーがあるか（キーそのものは返さない）と、今日の無料枠 |
| GET | `/api/youtube/search?q=&cc=&max=` | お手本の候補を探す（`youtube-search.v1.schema.json`）。1 回 102 ユニット。キーがなければ 503、無料枠を超えたら 429 |
| GET | `/api/references` | 手元のお手本の一覧（`reference.v1.schema.json`）。新しい順 |
| POST | `/api/references` | 投球を解析した YouTube の映像をお手本にする（`{footageId, kind, trustedChannel, playerHeightCm}`）。YouTube の統計を取り直す（2 ユニット）。`data/references/<id>.json` に置く |
| PATCH | `/api/references/{id}` | 種類・信頼チャンネル・手動調整（ピン留め・除外・星）を変える |
| POST | `/api/references/{id}/refresh` | YouTube の統計を取り直す（2 ユニット） |
| DELETE | `/api/references/{id}` | お手本の登録だけを消す（元の映像と解析結果は残す） |
| GET | `/api/practices` | 練習（映像のまとめ）の一覧。新しい順 |
| POST | `/api/practices` | 練習を作る（`{name, date, kind, camera, memo, videoIds}`、映像は 50 本まで）。`data/practices/<id>.json` に置く |
| GET | `/api/practices/{id}` | 練習（`practice.v1.schema.json`） |
| DELETE | `/api/practices/{id}` | 練習を消す。まとめを消すだけで、映像と解析結果は残す |

- 解析は 1 本ずつ裏で動かします（ONNX Runtime が CPU を使い切るため）
- YouTube から取り込んだ区間は、追跡が終わったら元の動画を消し、枠・骨格と出典だけを残します。元の動画の複製になる確認用の動画も作りません（ADR-0005）
- 画面の開発サーバー以外から使うときは、`FILM_COACH_ALLOWED_ORIGINS` で許可する画面を指定します

実際の動画とモデルを使う確認は、手元にあるときだけ動かします（CI では動かしません）。

```bash
uv run pytest -m integration
```

### YouTube Data API のキー

お手本を探す（`/api/youtube/search`）には、YouTube Data API v3 のキーが要ります。Google Cloud のコンソールでプロジェクトを作って YouTube Data API v3 を有効にし、API キーを作ったら（「API の制限」を YouTube Data API v3 だけにする）、ターミナルで次を実行してキーを貼り付けます。

```bash
security add-generic-password -a "$USER" -s film-coach-youtube -w
```

キーは macOS のキーチェーンにだけ置き、リポジトリにもログにも出しません（環境変数 `YOUTUBE_API_KEY` でも渡せます）。無料枠は 1 日 10,000 ユニットで、検索 1 回に 102 ユニット使います。使った量は `data/youtube-quota.json` に、米国太平洋時間の日ごとに数えます。
