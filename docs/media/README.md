# README の動画と図の作り方

README の動画（アニメーション WebP）は、作者の手元のデータでアプリを動かし、Google Chrome で録画したものです。手元のデータはリポジトリに含めないため、ここには作り方だけを記録しておきます。

## 映すもの・映さないもの

- **自分で撮影した映像**：ぼかした映像に差し替えてから映します。追跡で求めた本人の体の部分（手足・胴体・頭・ボールを持つ手のまわり）だけを残してほかをぼかし、本人の顔にはモザイクをかけます（`film-coach anonymize`）。
- **YouTube のお手本**：骨格・指標・出典の文字だけを映します。YouTube の映像（埋め込みプレイヤーやサムネイル）は映しません（ADR-0005）。
- **確認用の動画**（preview.mp4・focus.mp4）：ぼかしていないため使いません。

## 動画の作り方

```bash
# 1. 録画用にデータの複製を作る（元の data/ は変更しない）
scripts/demo/make-demo-data.sh <練習の ID> /tmp/film-coach-demo

# 2. 複製を読み込む解析サービスと画面を、普段とは別のポート番号で起動する
cd services/analyzer
FILM_COACH_DATA_DIR=/tmp/film-coach-demo FILM_COACH_ALLOWED_ORIGINS=http://localhost:5174 \
  uv run film-coach serve --port 8788
# 別のターミナルで
cd apps/web && VITE_ANALYZER_URL=http://127.0.0.1:8788 npx vite --port 5174

# 3. 場面ごとに録画し、docs/media/*.webp に書き出す（Ollama を起動しておくと、レポートの文章を LLM が作成する）
node apps/web/scripts/record-demo.ts http://localhost:5174 docs/media
```

- 録画は、Chrome の画面配信（CDP の screencast）でフレームを受け取り、ffmpeg でアニメーション WebP に変換します。GIF は、画面を一気にスクロールしたときに前のフレームの一部が残ることがあり、ファイルの大きさも 4 倍ほどになるため使っていません。
- 録画する場面と操作は `apps/web/scripts/record-demo.ts` に書いてあります。練習と映像の ID は、作者のデータのものです。
- 「本人を選んで追跡する」場面では、複製したデータの中で追跡をやり直すため、その映像の投球の解析結果が消えます。そのため最後に録画します。録画をやり直すときは、データの複製から作り直してください。

## 構成図の作り方

構成図（`architecture.png`）は、`architecture.html` を Chrome で 2 倍の解像度で撮影したものです。

```bash
node apps/web/scripts/render-diagram.ts
```
