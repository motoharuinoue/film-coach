# ADR-0002: 人物検出・骨格推定に rtmlib を使う

- 状態：採用
- 日付：2026-10-05

## 背景

人物検出と骨格推定の候補は、Ultralytics YOLO（検出・骨格推定）と rtmlib（RTMDet / RTMPose / RTMW）。

- Ultralytics YOLO は AGPL-3.0。公開リポジトリで使うと、プロジェクト全体のライセンスに影響する。
- rtmlib は Apache-2.0。ONNX Runtime で動き、mmcv などの重い依存が要らない。Mac では CoreML の実行プロバイダを使える。

## 決定

rtmlib を使う。追跡は ByteTrack（MIT）、対象選手のロックは SAM 2（Apache-2.0）を使う。

## 結果

- リポジトリを MIT / Apache-2.0 で公開できる。
- YOLO より使える情報や事例が少ないので、モデルの差し替えができるよう検出・骨格推定はインターフェースで抽象化しておく。
