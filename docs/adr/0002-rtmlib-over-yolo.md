# ADR-0002: 人物検出・骨格推定に rtmlib を使う

- 状態：採用
- 日付：2026-10-05

## 背景

人物検出と骨格推定の候補は、Ultralytics YOLO（検出・骨格推定）と rtmlib（RTMDet / RTMPose / RTMW）。

- Ultralytics YOLO は AGPL-3.0。公開リポジトリで使うと、プロジェクト全体のライセンスに影響する。
- rtmlib は Apache-2.0。ONNX Runtime で動き、mmcv などの重い依存が要らない。Mac では CoreML の実行プロバイダを使える。

## 決定

rtmlib を使う。

| 用途 | モデル | 大きさ |
|---|---|---|
| 人物検出 | YOLOX-m（HumanArt で学習、NMS 込みの ONNX、Apache-2.0） | 約 94 MB |
| 骨格推定 | RTMPose-m（Body7 で学習、COCO-17、Apache-2.0） | 約 51 MB |

- モデルは OpenMMLab の公式配布（`download.openmmlab.com`）から、`film-coach models download` で明示的に取得し、`data/models/`（git の管理外）に置く。取得後に大きさが配布元と一致するかを確かめる。
- 実行は ONNX Runtime の CPU。CoreML は YOLOX で出力の形が合わずに失敗した（M4 の Mac で、検出 約 100 ms/フレーム、骨格推定 約 13 ms/人）。
- rtmlib の YOLOX は検出の信頼度を捨てるので、推論結果から信頼度を取り出す薄い包みを自前で書く（`infrastructure/rtm.py`）。
- 追跡は自前の IoU 追跡で始め、足りなければ ByteTrack（MIT）を検討する。対象選手のマスクは M4 で SAM 2（Apache-2.0）を使う。

## 結果

- リポジトリを MIT / Apache-2.0 で公開できる。
- YOLO より使える情報や事例が少ないので、モデルの差し替えができるよう検出・骨格推定はポート（`PersonDetector` / `PoseEstimator`）で抽象化しておく。
- 設計の時点では人物検出を RTMDet と書いていたが、rtmlib の標準の検出器は YOLOX だったので、M1-2 で改めた。
