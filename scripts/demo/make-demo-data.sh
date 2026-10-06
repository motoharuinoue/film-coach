#!/usr/bin/env bash
# README のデモ動画を録るための、手元のデータの写しを作る。元のデータ（data/）は変えない。
#
#   - 練習にまとめた自分の映像：本人以外と顔をぼかした映像に差し替える（film-coach anonymize）
#   - お手本（YouTube）：骨格と指標（解析結果）だけ。元の動画は解析のあとに消しているので、もともと持っていない
#   - 確認用の動画（preview.mp4・focus.mp4）は、ぼかしていないので写さない
#
# 使い方：scripts/demo/make-demo-data.sh <練習の ID> <書き出し先>
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DATA="${FILM_COACH_DATA_DIR:-$REPO/data}"
PRACTICE="$1"
OUT="$2"

json() { python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print($2)" "$1"; }

own=$(json "$DATA/practices/$PRACTICE.json" "' '.join(d['videoIds'])")
refs=$(for f in "$DATA"/references/*.json; do json "$f" "d['videoId']"; done)

rm -rf "$OUT"
mkdir -p "$OUT/library" "$OUT/practices"
for id in $own $refs; do
  mkdir -p "$OUT/library/$id/outputs"
  cp "$DATA/library/$id/record.json" "$OUT/library/$id/"
  for f in track.json throws.json; do
    if [ -f "$DATA/library/$id/outputs/$f" ]; then cp "$DATA/library/$id/outputs/$f" "$OUT/library/$id/outputs/"; fi
  done
done
cp "$DATA/practices/$PRACTICE.json" "$OUT/practices/"
cp -R "$DATA/references" "$OUT/"
if [ -d "$DATA/drills" ]; then cp -R "$DATA/drills" "$OUT/"; fi
ln -s "$DATA/models" "$OUT/models"

cd "$REPO/services/analyzer"
for id in $own; do
  media=$(ls "$DATA/library/$id"/source.* 2>/dev/null | head -1 || true)
  if [ -z "$media" ]; then continue; fi # YouTube の区間など、元の動画を持っていない
  uv run film-coach anonymize "$media" --track "$DATA/library/$id/outputs/track.json" --out "$OUT/library/$id/source.mp4"
done
