# 設計書

| 文書 | 内容 |
|---|---|
| [requirements.md](requirements.md) | コンセプト、ペルソナ、機能要件、QB 指標、お手本ライブラリ、非機能要件 |
| [ui.md](ui.md) | デザイン言語、画面一覧、画面ごとの構成 |
| [architecture.md](architecture.md) | 全体像、リポジトリ構成、技術スタック、データモデル |
| [roadmap.md](roadmap.md) | マイルストーン、ポートフォリオとしての仕掛け、検証方法、要確認事項 |

## ADR（設計判断の記録）

| # | 決定 |
|---|---|
| [0001](adr/0001-local-processing.md) | 重い処理はローカル Mac で動かす |
| [0002](adr/0002-rtmlib-over-yolo.md) | 人物検出・骨格推定に rtmlib を使う |
| [0003](adr/0003-rules-judge-llm-writes.md) | 判定はルールエンジン、LLM は文章化だけ |
| [0004](adr/0004-schema-driven.md) | 解析結果の形を JSON Schema で一元管理する |
| [0005](adr/0005-youtube-terms-and-copyright.md) | YouTube の規約と著作権への対応（確認待ち） |
| [0006](adr/0006-reference-weighting.md) | お手本の重み付けを 5 つの要素の積にする |
| [0007](adr/0007-clean-architecture.md) | クリーンアーキテクチャで層を分け、依存の向きをテストで守る |
