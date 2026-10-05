# アーキテクチャ

## 1. 全体像

```
┌──────────────── ブラウザ ────────────────┐
│ apps/web (React + TS)                     │
│  画面 / 骨格オーバーレイ / グラフ           │
│  YouTube IFrame Player（お手本の表示）      │
└───────┬───────────────────────────────────┘
        │ REST + SSE（解析の進み具合）
┌───────▼──────── ローカル Mac ─────────────┐
│ services/analyzer (Python + FastAPI)      │
│  sources/     ファイル / YouTube の取り込み  │
│  pipeline/    検出 → 追跡 → 骨格 → フェーズ → 指標 │
│  judge/       ルールで判定                  │
│  references/  お手本の収集・重み・分布       │
│  report/      Ollama で文章化               │
│  SQLite + data/（動画・骨格データ）          │
└───────┬───────────────────────────────────┘
        │ 検索・情報取得・区間の取得のみ
    YouTube Data API / YouTube
```

公開デモ（GitHub Pages）では Python 側を動かさず、`samples/` の解析済み JSON を読み込んで同じ画面を表示する。

## 2. リポジトリ構成

```
film-coach/
  apps/web/            フロントエンド
  services/analyzer/   解析サービス
    sources/           SourceAdapter: LocalFile / YouTube
    pipeline/          解析の各段階
    judge/             判定ルールと metrics.yaml
    references/        お手本ライブラリ
    report/            レポート生成
  packages/schema/     解析結果・お手本・重みの JSON Schema
  samples/             自分で撮ったサンプル動画 + 解析済み JSON
  docs/                設計書
  .github/workflows/   CI
```

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
| 実行環境 | Python 3.12（uv で固定） |
| API | FastAPI + SSE |
| 人物検出・骨格推定 | rtmlib（RTMDet / RTMPose / RTMW、ONNX Runtime + CoreML） |
| 追跡 | ByteTrack |
| 対象選手のロック | SAM 2 |
| 画像処理 | OpenCV |
| 動画の変換 | ffmpeg |
| YouTube の取得 | yt-dlp（区間のみ） |
| YouTube の検索・情報 | YouTube Data API v3 |
| LLM | Ollama |
| 保存 | SQLite（SQLModel）。骨格データは Parquet / npz |

## 4. データモデル

### 4.1 自分の解析

| エンティティ | 主な項目 |
|---|---|
| Player | 名前、背番号、身長、利き腕、ポジション |
| Session | 日付、種別（ドリル／試合）、カメラ角度、メモ |
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

## 5. スキーマ駆動

解析結果の形は `packages/schema` の JSON Schema で一元管理し、版番号を持たせる。Python 側（Pydantic）と TypeScript 側の型はここから生成する。公開デモが解析済み JSON だけで動くのも、この共通の形があるから（[ADR-0004](adr/0004-schema-driven.md)）。

## 6. 開発環境

| ツール | 状態 |
|---|---|
| Node 23 / npm（workspaces） | 導入済み。依存の解決は npm 11 で行う（npm 10 は不具合で失敗する） |
| ffmpeg | 導入済み |
| Python 3.14 | 導入済み。ML 系ライブラリとの互換性のため、uv で 3.12 を固定して使う |
| uv / ollama / yt-dlp | 未導入（M1 で導入） |
| YouTube Data API キー | 利用者本人が Google Cloud のコンソールで発行する |
