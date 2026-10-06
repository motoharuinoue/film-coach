# README の動画の作り方

README の動画（アニメーション WebP）は、作者の手元のデータでアプリを動かし、Google Chrome で録ったものです。手元のデータはリポジトリに入れないので、ここには作り方だけを残します。

## 映すもの・映さないもの

- **自分の映像**：本人以外と顔をぼかした映像に差し替えてから映す。追跡で求めた本人の体の形（手足の線・胴体・頭・ボールを持つ手のまわり）だけを残し、顔はモザイクにする（`film-coach anonymize`）。
- **YouTube のお手本**：骨格・指標・出典の文字だけを映す。YouTube の映像（埋め込み・サムネイル）は映さない（ADR-0005）。
- **確認用の動画**（preview.mp4・focus.mp4）：ぼかしていないので使わない。

## 手順

```bash
# 1. 録画用のデータの写しを作る（元の data/ は変えない）
scripts/demo/make-demo-data.sh <練習の ID> /tmp/film-coach-demo

# 2. 写しを読む解析サービスと画面を、ふだんとは別の番号で起動する
cd services/analyzer
FILM_COACH_DATA_DIR=/tmp/film-coach-demo FILM_COACH_ALLOWED_ORIGINS=http://localhost:5174 \
  uv run film-coach serve --port 8788
# 別のターミナルで
cd apps/web && VITE_ANALYZER_URL=http://127.0.0.1:8788 npx vite --port 5174

# 3. 場面ごとに録って、docs/media/*.webp に書き出す（Ollama を起動しておくと、レポートの文章を LLM が書く）
node apps/web/scripts/record-demo.ts http://localhost:5174 docs/media
```

- 録画は、Chrome の画面配信（CDP の screencast）でコマを受け取り、ffmpeg でアニメーション WebP にする。GIF は、画面を一度で移ったときに前のコマの一部が残ることがあり、大きさも 4 倍ほどになるので使わない。
- 場面と操作は `apps/web/scripts/record-demo.ts` にある。練習・映像の ID は作者のデータのもの。
- 「本人を選ぶ」の場面は、写しの中で追跡をやり直す（その映像の投球の解析が消える）ので、最後に録る。録り直すときは、写しを作り直す。
