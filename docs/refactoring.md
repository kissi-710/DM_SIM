# リファクタリング計画と記録

目的: **動作を変えずに**、保守性と処理速度を上げる。機能を継ぎ足して育ったプロジェクトなので、不合理な処理・重複・巨大な単位が残っていないかを点検し、直す。
流れ(各回とも同じ): ① 方針・注意点の文書化 → ② 問題点の洗い出し(対象の一覧) → ③ 実装 → ④ 動作不変の確認 → ⑤ ドキュメント更新。
これを 2 回行う。2 回目の対象は、1 回目の変更を含むプロジェクト全体。

- 関連: 進捗は [ROADMAP.md](../ROADMAP.md)、作業ルールは [CLAUDE.md](../CLAUDE.md)、未解決の問題は [ISSUES.md](../ISSUES.md)。

---

## 1. 方針(2 回共通)

1. **ルール・カード効果・AI の判断を変えない。** 変えてよいのは「同じ結果を、より少ない仕事で出す」ことと、「同じ働きを、読みやすい形に直す」ことだけ。
2. 速度の向上は、結果(勝敗・手順・乱数の消費)を変えない範囲で行う。**乱数を引く回数・順序は絶対に変えない**(1 回でもずれると、以降の対局がすべて変わる)。
3. 評価順を入れ替える最適化は、**純粋な(状態を書き換えない)判定どうしに限る**。`emit` / `nextId` / `rngNext` / `ask` を含む処理の順序は動かさない(`seq` が変わる)。
4. 1 コミット = 1 つの目的。リファクタと機能変更を混ぜない。挙動を変える変更が必要になったら、リファクタを止めて ISSUES.md に書く。
5. Rust 版(`rust/`)は TS 版が基準。TS の内部の整理は Rust に反映しない(外から見える挙動が同じため)。Rust 版は挙動の差分テスト(`npm run test:rust`)で TS 版と一致し続けることを確かめる。
6. 公開 API(他ファイル・テスト・Worker から使われる名前)は、移動しても元の場所から再エクスポートして、呼び出し側を壊さない。

## 2. 注意点(落とし穴)

| 注意 | 理由 |
|---|---|
| `seq`(イベント ID)の発番順 | `emit` / `nextId` の呼び出し回数と順序がイベント列・因果(`causedBy`)を決める。判定の順序換えで、呼ばれる回数が変わらないようにする |
| `ask` は状態変更の前 | 再開可能な実行(effects 6.5)の規約。整理で順序が入れ替わると「二重に変更される」不具合になる |
| `derive` の関数は純粋 | キャッシュ・早期 return を足してよいが、`Ctx` 以外の隠れた状態を持たせない |
| 配列の順序 | `legalActions` の並びは AI の同点の選び方に効く(先頭の手が選ばれる)。並びを変えない |
| 時間主導(ms)の探索 | 実行時間で結果が変わるので、検証には使えない。反復回数指定の AI だけを検証に使う |
| UI の分割 | テスト(`tests/ui/*`)が import しているパスを壊さない。元のファイルから再エクスポートする |

## 3. 動作不変の確認(ゲート)

各コミットの前に、次のすべてが通ること。

| 確認 | コマンド | 何を守るか |
|---|---|---|
| 型・lint | `npm run typecheck` / `npm run lint` | 構造の破綻 |
| 単体・シナリオ・ゴールデン | `npm test` | 既存の約 1200 件。`tests/sim/golden.test.ts` は固定シードの勝敗・手順の hash を持つ |
| **挙動スナップショット** | `npx tsx scripts/behavior-snapshot.ts --check tests/fixtures/behavior-snapshot.json` | 全デッキの組 × ランダム/ルールベース(4 シード)、ルール/MCTS の混合、確率・パターン調査の **手順・イベント列・最終状態の hash**。178 件。リファクタ前(コミット 70a0a4b)に採取 |
| Rust との差分 | `npm run test:rust`(環境が整っていれば) | TS 版の評価が Rust 版と一致し続けること |
| 速度 | `npx tsx scripts/bench-batch.ts rule 200` など | 遅くなっていないこと(±10% 程度のぶれは測定誤差) |
| UI | `npm run build` と実機の確認 | UI を触った回のみ |

スナップショットは、**ルール・カード・AI を意図して変えた時だけ**更新する。リファクタリングでは一度も更新しない(更新が必要になったら、挙動が変わった証拠なので、その変更を戻す)。

---

## 4. 第 1 回

### 4.1 現状の計測(着手前)

| 項目 | 値 |
|---|---|
| 規模 | TS(src)+ Rust(rust/src)で約 2.9 万行。最大: `rust/src/procs.rs` 1387 行、`src/engine/procs.ts` 1090 行、`src/ui/GameView.tsx` 1071 行(うち `GameView` 1 関数が約 840 行) |
| 型・lint | エラーなし |
| `npm test` | 1201 件成功(6 件スキップ)、約 56 秒 |
| 速度(`bench-batch`、1 スレッド) | ルールベース 167 試合/秒(約 6.0ms/試合)、ランダム 303 試合/秒、MCTS(120 反復)約 1.3 秒/試合 |
| プロファイル(MCTS 4 試合) | 平らで、飛び抜けた一点はない。自己時間の上位: `collect`(誘発の収集)6.3%、`planPayment` 4.0%、`cloneState` 3.7%、`charsLite` 3.1%、`evalCond` 3.0% |
| 未使用の export | なし(型・補助関数が「同じファイル内でだけ」使われるのに `export` されているものはある。害はなく、対象外) |

### 4.2 問題点と対象の一覧(第 1 回)

挙動を変えないものだけを挙げる。`効果` は、保守性(保)・速度(速)のどちらに効くか。

| ID | 場所 | 問題 | 直し方 | 効果 |
|---|---|---|---|---|
| R1-1 | `engine/derive.ts` | `costBase` / `manaCivs` / `isSick` / `infoOf` が、1 つの値のためだけに `charsLite`(オブジェクトを毎回生成)を呼ぶ。合法手の列挙・支払い計画で何度も呼ばれる | 面の添字・面・文明を求める軽い内部関数に分け、生成をやめる | 速 |
| R1-2 | `engine/derive.ts` | `costOf` / `canCast` / `playerAttackBlockedByEntry` が、必要な種類(`costDelta` など)以外も含めて、全常在型能力の `while` 条件を評価している | 能力の種類で先に絞ってから `while` を評価する(純粋な判定なので結果は同じ) | 速 |
| R1-3 | `engine/ops.ts` | `tryTrigger` が、手前の安い判定(`subject` / `turn` / 使用回数の上限)より先に、`snapOf` と評価コンテキストを作る。誘発の候補の大半は、ここで落ちる | 安い判定を先に行う。回数の上限のキーの組み立てを 1 か所にする | 速・保 |
| R1-4 | `engine/engine.ts` `legal.ts` `sim/goal.ts` | 「`PLAY_CARD` の面の既定値(最初のクリーチャー面、無ければ 0)」の導出が 3 か所に重複し、`legal.ts` では `findIndex` を 2 回呼ぶ | `defaultPlayFace(def)` を 1 つにして共有する | 保 |
| R1-5 | `engine/legal.ts` | `extraVariants` の末尾に、未使用の import を隠すための `void hasKeyword;`。`enumerateRaw` に `repeat ? start : start`(常に `start`)。`enumerateAssign` に使われない `used` 集合と、`JSON.parse(JSON.stringify())` による複製 | 死んだコードを消し、複製を直接の複製にする | 保・速 |
| R1-6 | `engine/vm.ts` | 効果の実行で `any` が多く、型の穴になっている(`const a: any = (ins.act as any)[key]` など) | 局所的に型を付ける(`ActDef` の値の型)。実行ロジックは変えない | 保 |
| R1-7 | `ai/mcts.ts` | `./eval` の import が 2 行に分かれている。`rollout` が、同じラウンドの全候補手で同じ `rolloutL1(w)` を毎回作り直す | import を 1 本にする。`rolloutL1` を重みのオブジェクトごとに 1 回だけ計算する | 保・速 |
| R1-8 | `ai/rulebased.ts` | `makeRuleBased` で計算済みの `params` を使わず、`chooseAnswer` が呼ばれるたびに `withL1` と重み(`RULE_WEIGHTS` の差し替え)を作り直す | 作成時に 1 回だけ計算して渡す | 速 |
| R1-9 | `ui/GameView.tsx` | 1071 行の中に、カード詳細・派生値・ログ・待機中の能力・ヘルプが同居。`GameView` 1 関数が約 840 行。直近の 1 手のイベントから `Set` を作る `useMemo` が 5 つ、ほぼ同じ形で並ぶ | 表示だけの部品を別ファイルに移し(元のファイルから再エクスポート)、イベントから `Set` を作る処理を 1 つの補助関数にまとめる | 保 |
| R1-10 | その他 | 重複 import(`cli/prob.ts` の `node:fs` など) | 1 本にまとめる | 保 |

### 4.3 実施結果(第 1 回)

全項目を実施した。コミット: `de66327`(R1-1〜R1-6)/ `453f11a`(R1-7・R1-8)/ `9ee5f36`(R1-9)/ `7da0216`(R1-10)。

| ID | 結果 |
|---|---|
| R1-1 | `derive.ts` に `faceIdxOf`(非公開)・`faceTypeOf` を足し、`costBase` / `manaCivs` / `isSick` / `infoOf` を、オブジェクト生成なしで求めるようにした。ai・engine・sim の `charsLite(...).cost` / `.civs` / `.type`(hint なし)の約 24 か所を置き換えた(`charsLite` は、面・種族なども使う箇所に残した) |
| R1-2 | `activeStatics(c, modType?)` で種類を先に絞る。`costOf` / `canCast` / `playerAttackBlockedByEntry` が使う |
| R1-3 | `tryTrigger` で、`subject` / `turn` の判定を、スナップショット・評価コンテキストの作成より前に。`limitKey` に集約 |
| R1-4 | `defaultPlayFace(def)` を `derive.ts` に置き、`engine.ts` / `legal.ts` / `goal.ts` で共有 |
| R1-5 | `legal.ts` の `void hasKeyword`・`repeat ? start : start`・未使用の `used` 集合・JSON 複製を整理 |
| R1-6 | `vm.ts` の冗長な `any`(2 か所)を外した。`cond` の `any` は、判別共用体に `nonEmpty` が無いため残した(型の穴だが、実行は変えない) |
| R1-7 | `rolloutL1` を `WeakMap` で重みごとに 1 回に。`./eval` の二重 import を解消 |
| R1-8 | `chooseAnswer` の重みを、`makeRuleBased` の作成時に 1 回だけ作る |
| R1-9 | `GameView.tsx` 1071 → 871 行。`CardDetail.tsx`(90 行)・`SidePanels.tsx`(59 行)・`HelpPanel.tsx`(65 行)・`GameDialogs.tsx`(支払い・棋譜。107 行)を新設。`cardsOfEvents` で 4 つの `useMemo` を集約。`GameView` から `CardDetail` / `PoolPanel` / `LogPanel` を再エクスポートし、既存の import は無変更 |
| R1-10 | 重複 import 5 か所を 1 本に |

**動作不変の確認(すべて通過)**

| 確認 | 結果 |
|---|---|
| `npm run typecheck` / `npm run lint` | エラーなし |
| `npm test` | 1201 件成功(6 件スキップ。着手前と同じ) |
| 挙動スナップショット(178 件) | 全件一致(手順・イベント列・最終状態の hash が着手前と同じ) |
| `npm run test:rust` | 5 件成功(TS 版の出力から作り直した正解データと Rust 版が一致) |
| `npm run build` | 成功 |
| 実機(ブラウザ) | 対戦画面で、カード詳細・ログ・ヘルプ・棋譜ダイアログが表示され、コンソールにエラーなし。**支払いダイアログ(PayDialog)は実機で出していない**(UI テストと型で確認。第 2 回で、マナ選択が出る場面を作って確認する) |

**速度**(1 スレッド。同じ PC で、着手前のコミットと交互に測定。ぶれは ±5% 程度)

| 項目 | 着手前 | 第 1 回後 |
|---|---|---|
| ルールベース 400 試合 | 163〜170 試合/秒 | 174〜213 試合/秒(約 +10〜25%) |
| ランダム 400 試合 | 337 試合/秒 | 339 試合/秒(差なし) |
| MCTS(120 反復)4 試合 | 1.42〜1.52 秒/試合 | 1.42 秒/試合(誤差内) |

効いたのは、合法手の列挙・支払い計画・誘発の収集で呼ばれる軽量アクセサと、`activeStatics` の絞り込み。MCTS は Rust 版(WASM)が使えれば探索の本体がそちらで動くので、TS 側の速度は主に UI のない環境(CLI・テスト)に効く。

### 4.4 第 1 回で見送ったもの(第 2 回の候補)

- `GameView` のキー入力の処理(約 200 行の 1 つの `useEffect`)の切り出し。状態の多くを閉じ込めているので、フックに分ける設計が要る。
- `engine/procs.ts`(1090 行)の、攻撃・ブレイク・チェックポイントの分割。
- `collect`(誘発の収集)が、イベントごとに全カードを走査する。トリガーを持つカードの索引を持てば減らせるが、`uid` 順の走査順(= 誘発の発生順)を保つ設計が要る。
- `planPayment` の中間の `Map` / `Set` の削減。

対象にしないもの(理由つき): `rust/`(TS が基準で、差分テストが守っている。内部の整理は別の機会)、`docs/data/`(実験の記録)、`scripts/` の単発の実験スクリプト(再実行が目的ではなく、記録として残す)、`scratch/`(git の管理外)。
