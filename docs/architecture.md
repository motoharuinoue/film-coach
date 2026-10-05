# アーキテクチャ

## 1. 全体像

```
┌──────────────── ブラウザ ─────────────────────┐
│ apps/web (React + TS)                          │
│  presentation   画面 / 骨格オーバーレイ / グラフ │
│  application    ユースケース・ポート            │
│  domain         指標・判定・重み付け            │
│  infrastructure 解析サービスの HTTP クライアント │
│  YouTube IFrame Player（お手本の表示）           │
└───────┬────────────────────────────────────────┘
        │ REST + SSE（解析の進み具合）
┌───────▼──────── ローカル Mac ──────────────────┐
│ services/analyzer (Python + FastAPI)           │
│  adapters       HTTP / ファイル・YouTube の取り込み / Ollama │
│  application    解析ジョブ / お手本の取り込み / レポート │
│  domain         フェーズ / 指標 / 判定 / 重み付け │
│  infrastructure rtmlib / SAM 2 / OpenCV / ffmpeg / SQLite │
│  data/          動画・骨格データ（ローカルのみ）  │
└───────┬────────────────────────────────────────┘
        │ 検索・情報取得・区間の取得のみ
    YouTube Data API / YouTube
```

公開デモ（GitHub Pages）では Python 側を動かさず、`samples/` の解析済み JSON を読み込んで同じ画面を表示する。

## 2. リポジトリ構成と層

フロントエンドも解析サービスも、クリーンアーキテクチャの層に分ける。依存は内側（domain）に向けるだけにし、そのルールをテストで守る（[ADR-0007](adr/0007-clean-architecture.md)）。

```
film-coach/
  apps/web/src/
    domain/            骨格・フェーズ・指標・判定・重み付け・コーチングの方針・エンティティ
    application/       ユースケース、ポート（外部への窓口）、CoachService
    infrastructure/    ポートの実装
      demo/            合成データ・デモ用リポジトリ（M1 で HTTP 実装に差し替え）
      writer/          改善点の文章化（テンプレート。M3 で Ollama を追加）
      browser/         localStorage など
    presentation/      React の画面・部品・フック
    composition.ts     コンポジションルート（infrastructure を差し込む唯一の場所）
    architecture.test.ts  依存の向きの検査
  services/analyzer/   解析サービス（M1）
    domain/            フェーズ・指標・判定・重み付け（web の domain と同じ規則）
    application/       解析ジョブ、お手本の取り込み、レポート
    adapters/          HTTP（FastAPI）、SourceAdapter（LocalFile / YouTube）、Ollama
    infrastructure/    rtmlib・SAM 2・OpenCV・ffmpeg・SQLite
    bootstrap.py       コンポジションルート（依存の検査は import-linter）
  packages/schema/     解析結果・お手本・重みの JSON Schema
  samples/             自分で撮ったサンプル動画 + 解析済み JSON
  docs/                設計書
  .github/workflows/   CI
```

| 層 | 依存してよい層 |
|---|---|
| domain | domain |
| application | domain |
| infrastructure（adapters を含む） | domain, application |
| presentation | domain, application |

`domain` と `application` は React などの外部パッケージに依存しない。

### ポート

| ポート | いまの実装 | 今後の実装 |
|---|---|---|
| `SessionRepository` | `DemoSessionRepository`（合成データ） | 解析サービスの HTTP クライアント（M1） |
| `ReferenceRepository` | `DemoReferenceRepository` | 解析サービスの HTTP クライアント（M2） |
| `ManualAdjustmentStore` | `LocalStorageManualStore` | 解析サービスの SQLite（M2） |
| `FindingWriter` | `TemplateFindingWriter` | Ollama のローカル LLM（M3） |
| `FootageLibrary` | `HttpFootageLibrary`（解析サービスの HTTP API。開発時だけ `VITE_ANALYZER_URL` で差し込む） | — |

## 3. 技術スタック

すべて無料で使えるものに限る。

### 3.1 フロントエンド

| 用途 | 採用 |
|---|---|
| 基盤 | React + TypeScript + Vite |
| スタイル | Tailwind CSS v4 |
| 動き | Framer Motion |
| ルーティング | React Router |
| サーバー状態 | TanStack Query |
| グラフ | 自前の SVG（後で ECharts / visx を検討） |
| 3D | react-three-fiber（M5） |
| 骨格オーバーレイ | Canvas / SVG + `requestVideoFrameCallback` でフレーム同期 |
| お手本の表示 | YouTube IFrame Player API |

### 3.2 解析サービス

| 用途 | 採用 |
|---|---|
| 実行環境 | Python 3.13（uv で固定。onnxruntime・OpenCV・rtmlib が対応済みで、手元に入っているため） |
| API | FastAPI + SSE（127.0.0.1 だけで待ち受け、CORS は手元の画面だけ許可） |
| 人物検出・骨格推定 | rtmlib（YOLOX-m / RTMPose-m、ONNX Runtime の CPU。CoreML は YOLOX で失敗するため使わない） |
| 追跡と対象選手のロック | 自前の IoU 追跡（`domain/tracking.py`）。途切れた追跡を位置と大きさでつなぎ直し、短い抜けは補間する。場面の切り替わり（OpenCV で検出）はまたがない |
| 対象選手のマスク（M4） | SAM 2 |
| カメラの動きの補正 | OpenCV。人の枠を除いた背景の特徴点を Lucas-Kanade で追い、RANSAC で相似変換を当てはめる（`OpenCvCameraMotion`） |
| 画像の座標 → ワールド 2D | 自前（`domain/world.py`）。縮尺は脚と体幹の長さ（人体寸法の比率）、地面は足首、向きと利き腕は手首の動きから |
| 画像処理 | OpenCV |
| 動画の変換 | ffmpeg |
| YouTube の取得 | yt-dlp（区間のみ） |
| YouTube の検索・情報 | YouTube Data API v3（標準ライブラリの urllib で呼ぶ。キーは macOS のキーチェーンか環境変数 `YOUTUBE_API_KEY`。無料枠は `data/youtube-quota.json` に、米国太平洋時間の日ごとに数える） |
| LLM | Ollama |
| 保存 | M1 はファイル（`data/library/<id>/` に記録の JSON・元の動画・解析結果、`data/practices/<id>.json` に練習）。件数が増えたら SQLite に移す |

## 4. データモデル

### 4.1 自分の解析

| エンティティ | 主な項目 |
|---|---|
| Player | 名前、背番号、身長、利き腕、ポジション |
| Session | 日付、種別（ドリル／試合）、カメラ角度、メモ。実際の映像のまとめは「練習」（`practice.v1`、`data/practices/`）として実装した。デモの Session（合成データ）と区別するため |
| Video | 取り込み元（local / youtube）、出典 URL、fps、解像度、長さ |
| Rep | 開始・終了フレーム、対象の追跡 ID、フェーズの境界 |
| PoseSequence | 骨格データのパス、関節ごとの信頼度 |
| Metric | 指標キー、値、単位、判定、根拠フレーム、信頼度 |
| Finding | 重要度、タイトル、説明、根拠フレーム、推薦ドリル |
| Report | 生成した内容（JSON）、作成日時 |

### 4.2 お手本

| エンティティ | 主な項目 |
|---|---|
| Reference | YouTube の動画 ID、チャンネル、再生数、高評価数、登録者数、ライセンス、区間、分類タグ |
| ReferenceRep | お手本から切り出したレップと骨格データ |
| ReferenceWeight | 指標ごとの P / C / Q / K / M と最終的な重み |
| ReferenceDistribution | 指標ごとの重み付き分位（10% / 25% / 50% / 75% / 90%） |

## 5. スキーマ駆動と両言語の一致

解析結果の形は `packages/schema` の JSON Schema で一元管理し、版番号を持たせる。公開デモが解析済み JSON だけで動くのも、この共通の形があるから（[ADR-0004](adr/0004-schema-driven.md)）。

| ファイル | 内容 | 使う場所 |
|---|---|---|
| `pose-sequence.v1.schema.json` | 1 レップ分の骨格の時系列（COCO-17、ワールド 2D、`[x, y, 信頼度]`） | 解析サービスが読み込み時に検証する |
| `fixtures/parity.v1.json` | 合成骨格 4 ケースと、フェーズ・指標の期待値 | TypeScript と Python の両方のテストで、同じ結果になることを確かめる |

フェーズ分割と指標の規則は TypeScript（`apps/web/src/domain`）と Python（`services/analyzer/src/film_coach/domain`）の両方にある。期待値は TypeScript の実装から作り（`UPDATE_FIXTURES=1 npm test -- parity`）、Python のテストがフレーム番号の完全一致と、指標の 1e-9 以内の一致を確かめる。丸めは JavaScript の `Math.round` にそろえる（Python の `round` は偶数丸めなので使わない）。

## 6. 開発環境

| ツール | 状態 |
|---|---|
| Node 23 / npm（workspaces） | 導入済み。依存の解決は npm 11 で行う（npm 10 は不具合で失敗する） |
| ffmpeg | 導入済み |
| Python 3.13 / 3.14 | 導入済み。解析サービスは uv で 3.13 に固定する（`services/analyzer/.python-version`） |
| uv / yt-dlp | 導入済み（M1） |
| ollama | 未導入（M3 で導入） |
| YouTube Data API キー | 利用者本人が Google Cloud のコンソールで発行し、`security add-generic-password -a "$USER" -s film-coach-youtube -w` でキーチェーンに置く（キーがコマンドの履歴に残らない） |
