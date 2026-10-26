#!/bin/bash
# 全コアに shard を並べて collect.ts を実行し、結果を 1 つの JSONL にまとめる。
#   scripts/saturation/run.sh <出力.jsonl> [collect.ts のオプション...]
# 環境変数 K: 並列数(既定 nproc)
set -e
OUT=$1; shift
K=${K:-$(nproc)}
for ((i = 0; i < K; i++)); do
  npx tsx "$(dirname "$0")/collect.ts" "$@" --out "$OUT.$i" --shard "$i/$K" &
done
wait
cat "$OUT".[0-9]* > "$OUT" && rm -f "$OUT".[0-9]*
echo "完了 $(wc -l < "$OUT") 試合 → $OUT"
