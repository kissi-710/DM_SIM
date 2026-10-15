# ISSUES(DM_SIM の未解決の問題点)

- 更新日: 2026-10-15(HEAD `8c40561` 以降)
- 解決済みの項目と、そのときの調査記録は [HISTORY.md](./HISTORY.md) に移した(基本的に読む必要はない)。
- **番号は固定**(振り直さない)。解決した項目の番号は欠番になる。旧番号(2026-10-15 の振り直し前)との対応は HISTORY.md §1。
- 修正はこの文書の対象外。項目ごとに別コミットで直す(CLAUDE.md)。直したら、この文書から消して HISTORY.md に移す。
- 関連: 進捗は [ROADMAP.md](./ROADMAP.md)、公式との照合は [docs/rules-reference.md](./docs/rules-reference.md) 12章。

**確度**: 【再現】実際に動かして確認した / 【読解】コードを読んで判断した(未再現) / 【照合】docs 同士・docs とコードの食い違い。

## 現在の状態(2026-10-15)

| 確認 | 結果 |
|---|---|
| `npm run typecheck` / `npm run lint` | エラー・警告なし(`noUnusedLocals` / `noUnusedParameters` を有効化済み) |
| `npm test` | 929 件成功(58 ファイル) |
| `npm run test:rust`(Rust 版と TS 版の差分テスト) | 成功(取り直したフィクスチャで) |
| `npm run test:coverage` | 文 67%・分岐 61%(2026-10-15 時点。UI のテスト追加前) |
| `npm audit --omit=dev` | 脆弱性 0 |
| 未解決の項目 | 1件(低 1。ISSUE-19 は持ち主の判断) |

## 一覧

| ID | 優先度 | 確度 | 概要 |
|---|---|---|---|
| ISSUE-19 | 低 | 照合 | `package.json` の `repository` と、公開時のライセンスが未定(持ち主の判断) |

---

## 品質・保守性

### ISSUE-19 `package.json` の `repository` と、公開時のライセンスが未定【照合】
- 旧番号: ISSUE-25(CI・カバレッジ・`engines`・`license: UNLICENSED` は対応済み)
- 内容: `repository` がない。`license` は `UNLICENSED`(private。公開時のライセンスは持ち主が決める)。
- 修正案: リポジトリの URL と、公開する場合のライセンス(MIT など)を決めて入れる。

---

## 性能の計測(2026-10-15。Node 上。ISSUE-23〜27 の修正前の値と、問題として挙げなかった点)

| 項目 | 結果 |
|---|---|
| ルールベース同士の 1 試合(マルル対ザーディ、12.3 ターン・57 手) | 3.7ms(約 270 試合/秒。1 手 64µs。内訳: 合法手の列挙 18%・視点の作成 9%・AI の判断 46%・`step` 27%) |
| `cloneState`(80 枚) | 1.5µs |
| `legalActions`(人間の手番・平均 6.2 手) | 14µs(`buildDropMap` を足しても 13µs。UI が再描画のたびに呼んでも無視できる) |
| 盤面 35 枚の派生値(`charsOf`・`powerOf`・`hasKeyword`)の再計算 | 23µs(実ブラウザの描画は未計測) |
| `step` の中の `validateAction`(合法手の再検証。`planPlay` の二重実行) | 探索時間の 2% |
| MCTS 120 反復の 1 手(WASM 版) | 6.5〜7.0ms |
| 配布物(`vite build`) | 本体 468KB(gzip 143KB)・`ai.worker` 127KB・`sim.worker` 148KB・WASM 581KB(gzip 209KB)。画面ごとの分割はない |
| ソリティアの方針プレイ(探索なし) | 1 試行 約 0.6ms(探索ありは、コスト7の目標で 88ms/試行) |

計測用の使い捨てスクリプトは `scratch/perf/`(git の管理外)。

---

## この調査の限界

- ゲームルールの正しさ(公式との一致)は、docs の照合表を基にした。総合ルール原文(PDF)は、あらためて読んでいない。
- Rust 版(`rust/`・`src/wasm/`)は、差分テストが通ることを確認しただけで、コードの正しさは読んでいない。性能も、TS 版との比(上記)だけを測り、Rust 側のホットパスのプロファイルは取っていない。
- 【読解】の項目は、コードから判断したもので、再現していない。
- 性能の数値は Node(TS 版・WASM 版)での値。ブラウザでの描画・Worker の起動・メモリは測っていない。
