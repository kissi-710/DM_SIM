#!/bin/bash
# 履歴ベンチ(scripts/history-bench.ts)用に、過去のコミットの探索 AI(src/ai)を scripts/legacy/<版>/ に取り出す。
# 現在のエンジン(src/engine など)の上で動くよう、import の相対パスだけを書き換える(コードは変えない)。
#   bash scripts/legacy-extract.sh
# 版: v0 = 1987996(最初期の L2) / v1 = 71db838(ペア比較・マナの重みの調整) / v2 = c326a74(ptree の導入) /
#     v3 = 8e230b3(軌跡平均) / vmain = 4b9ee70(2026-10-17 の main。現在のコードの infer=0 と手の列が一致する)
set -e
cd "$(dirname "$0")/.."
rm -rf scripts/legacy
extract() { # 版 コミット
  local name=$1 commit=$2
  mkdir -p scripts/legacy/$name
  for f in $(git ls-tree -r --name-only "$commit" src/ai); do
    git show "$commit:$f" | sed \
      -e "s#'\.\./engine/#'../../../src/engine/#g" \
      -e "s#'\.\./sim/#'../../../src/sim/#g" \
      -e "s#'\.\./cards'#'../../../src/cards'#g" \
      -e "s#'\.\./cards/#'../../../src/cards/#g" \
      -e "s#'\.\./wasm/#'../../../src/wasm/#g" \
      -e "s#'\.\./ui/#'../../../src/ui/#g" > "scripts/legacy/$name/$(basename "$f")"
  done
  echo "$name $commit: $(ls scripts/legacy/$name | wc -l) ファイル"
}
extract v0 1987996
extract v1 71db838
extract v2 c326a74
extract v3 8e230b3
extract vmain 4b9ee70
