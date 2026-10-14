# 設計書(DM_SIM)

- 状態: **草案 v0.3**(2026-10-14)。効果・タイミング・操作の設計を [effects.md](./effects.md) に分離し、この文書の該当章(4・5.2・6・9・13・14)を整合させた。Q9〜Q15 は仮の既定値で確定(spec.md 9.2)
- 対象: デュエマ シミュレータ(ブラウザ版)
- 関連: [overview.md](./overview.md)(目的・技術スタック) / [spec.md](./spec.md)(仕様) / [decks.md](./decks.md)(対象デッキとカード効果) / **[effects.md](./effects.md)(カード効果・タイミング・UI操作。最重要)** / [reference_duel-hub.md](./reference_duel-hub.md)(参考: 既存ツールのUIと効果の記述形式)
- 「未確定」と書いた箇所は、spec.md 第9章の質問・仮決定で扱う。それまでは仮の方針で進める。

---

## 1. 設計の基本方針

| # | 方針 | 狙い |
|---|---|---|
| P1 | ゲームロジック(engine)はUIから完全分離した純粋なTypeScript | Node.jsとブラウザで同じコードを使う。DOM・React・Workerに依存しない |
| P2 | 「状態 + 行動 → 新しい状態」のreducer方式。状態はJSONで丸ごとコピーできる形 | AI探索(先読み)、undo、再現、テストが簡単になる |
| P3 | 乱数は状態の中に持つシード付き疑似乱数 | 同じシード・同じ行動列なら必ず同じ結果。バグの再現と統計の再現ができる |
| P4 | 選択が必要な場面は「保留中の判断(pending)」として状態に持つ。**メインステップの行動待ちも pending の一種** | ブロッカー・S・トリガー・対象選択などの割り込みを、人間・AIとも同じ仕組みで扱える |
| P5 | カード能力は**データ(AST)**で書き、小さなインタプリタ(VM)で実行する。例外は原始操作を足して吸収する | 手入力のJSONを増やすだけで対応カードを増やせる。能力のコピー(オルゲイト)も可能になる |
| P6 | AIは「見えている情報(PlayerView)」だけを受け取る。開示範囲は設定(`InfoPolicy`)で変えられる | 既定は人間と同じ公平な条件。弱ければ部分開示・決め打ちで調整する |
| P7 | 重い処理(探索AI・数千試合)はWeb Worker / Nodeで動かす | 画面を固めない |

---

## 2. 全体構成

```
          ┌────────────┐   ┌──────────────┐   ┌─────────────────┐
          │  UI(React)│   │ AI Worker     │   │ CLI (Node.js)   │
          │  対戦画面等 │   │ (探索AIの実行) │   │ 自動対戦・確率   │
          └─────┬──────┘   └──────┬───────┘   └────────┬────────┘
                │                 │                    │
                └────────┬────────┴──────────┬─────────┘
                         ▼                   ▼
                  ┌─────────────┐     ┌──────────────┐
                  │  engine     │◀────│  cards (JSON)│
                  │ (純TypeScript)│     └──────────────┘
                  └─────────────┘
                   ▲           ▲
                   │           │
              ai/ (エージェント)  sim/ (確率・バッチ)
```

依存の向きは「上 → 下」のみ。**engine は他のどれにも依存しない**(cards のデータを引数で受け取るだけ)。

---

## 3. ディレクトリ構成(予定)

> 着手前の計画です。実際の構成は [README.md](../README.md) の「構成」を参照してください(例: `engine/` は `rng.ts` `setup.ts` `reducer.ts` などではなく、`engine.ts` `procs.ts` `ops.ts` `vm.ts` `registry.ts` などの平坦な構成になっています)。

```
DM_SIM/
├─ docs/                  # overview / design / spec / effects / decks
├─ src/
│  ├─ engine/             # 純TypeScript(DOM・React禁止)
│  │  ├─ types.ts         # GameState / Action / Event などの型
│  │  ├─ rng.ts           # シード付き乱数(状態に埋め込める形)
│  │  ├─ setup.ts         # デッキ→初期状態(シャッフル・シールド・初手)
│  │  ├─ reducer.ts       # step(state, action) → { state, events }
│  │  ├─ legal.ts         # legalActions(state)
│  │  ├─ view.ts          # toPlayerView(state, player)(隠し情報のマスク)
│  │  ├─ rules/           # 手続きフレーム: ターン進行・プレイ・攻撃・ブレイク・settle(チェックポイント)
│  │  ├─ events/          # 原始イベント・EventBus・パターン照合・能力の索引(registry)
│  │  ├─ pool.ts          # 待機プール・pickNext(101.4)
│  │  ├─ vm/              # 効果のインタプリタ(Step・Selector・Expr・フレーム)
│  │  ├─ ops/             # 原始操作(move/draw/lookTop/assign/addEffect/summonFree …)
│  │  ├─ replace.ts       # 置換パイプライン(トリガー抑制を含む)
│  │  ├─ derive.ts        # 派生ビュー(コスト・パワー・文明・攻撃可否 …)
│  │  └─ custom/          # 最後の手段のカード個別処理(原始操作だけを呼ぶ)
│  ├─ cards/
│  │  ├─ data/*.json      # カードデータ(手入力)
│  │  ├─ schema.ts        # JSONの検証(zod等は未定)
│  │  └─ loader.ts
│  ├─ ai/                 # random / rulebased / mcts と共通インターフェース
│  ├─ sim/
│  │  ├─ solitaire/       # 確率調査・パターン調査(8.2)
│  │  └─ batch/           # AI同士の自動対戦・集計
│  ├─ workers/            # ai.worker.ts など
│  ├─ ui/                 # Reactコンポーネント・CSS
│  └─ cli/                # node で動かす入口(batch / prob)
├─ tests/                 # Vitest(engineの単体テスト中心)。tests/cards/ にカード別シナリオ(effects.md 13章)
├─ package.json / tsconfig.json / vite.config.ts
└─ README.md
```

- `tsconfig` で `src/engine` から `src/ui` などをimportできないよう、ESLintの `no-restricted-imports` で禁止する(P1を機械的に守る)。

---

## 4. 状態モデル(型のスケッチ)

実装時に細部は変わる。ここでは構造の合意用。

```ts
type PlayerId = 0 | 1;
type Civilization = "light" | "water" | "darkness" | "fire" | "nature";
type Phase = "turnStart" | "draw" | "mana" | "main" | "attack" | "end";

interface CardInstance {
  uid: number;          // 試合内で一意。位置が変わっても不変
  defId: string;        // cards/data の id
  tapped: boolean;
  sick: boolean;        // 召喚酔い。出た時にtrue、自分のターン開始時にfalse(ターン開始時から継続してバトルゾーンにいたか)
}

interface PlayerState {
  deck: CardInstance[];       // 先頭が山札の上
  hand: CardInstance[];
  mana: CardInstance[];
  shield: CardInstance[];     // 裏向き。中身は本人にも見えない
  battle: CardInstance[];
  graveyard: CardInstance[];
}

interface GameState {
  players: [PlayerState, PlayerState];
  turn: number;               // 1始まりの通しターン
  active: PlayerId;
  phase: Phase;
  pending: PendingDecision | null;
  rng: number;                // 疑似乱数の内部状態
  winner: PlayerId | "draw" | null;
  nextUid: number;
  manaChargedThisTurn: boolean;
}
```

**効果・タイミング処理のための追加(effects.md 第3章が正)**: バトルゾーンは「重なり(山)」の配列 `Permanent[]`(`pid`・`cards[]`(先頭が一番上)・`tapped`・`sick`・`exShields`)にする(進化・侵略・S-MAX進化のため)。`CardInstance` に `ep`(ゾーンを移動するたびに増える)を持たせ、参照は `ObjRef = {uid, ep}` にする。`GameState` に `cont`(実行スタック)・`pool`(待機プール)・`effects`(生成型の継続効果)・`turnLog`・`usage`・`seq` を追加する。上の型スケッチの `battle: CardInstance[]` と `sick` は、この形に読み替える。

### 4.1 Action(行動)

```ts
type AttackTarget = { kind: "player" } | { kind: "creature"; pid: number };

type Action =
  | { type: "CHARGE_MANA"; uid: number }
  | { type: "SKIP_MANA" }
  | { type: "PLAY_CARD"; uid: number; from?: ZoneId; face?: number; extra?: PlayExtra }  // extra: ハイパーエナジーのタップ対象、手動マナ指定
  | { type: "ATTACK"; attacker: number; target: AttackTarget }
  | { type: "END_MAIN" }
  | { type: "END_TURN" }
  | { type: "ANSWER"; id: number; value: AnswerValue };   // pending への回答はこの1種類(id は pending.id)
```

- 以前の個別 Action(`BLOCK` / `CHOOSE_TARGET` / `ORDER` / `OPTIONAL` / `SPLIT` …)は `ANSWER` に統合した。`AnswerValue` は pending の**入力形式**(下の 4.2)ごとの型。
- **マナの支払い**: 初期は自動。公式ルール(112.2a)では、コストに含まれる**文明ごとにマナ1枚**をタップし、残りは数値の合計で満たす。**マナゾーンの多色カードは1枚で複数文明を満たせない**(どれか1つの文明として数える)。このため、どのマナをタップするかは**割り当て問題**(文明ごとの二部マッチング)になる。自動支払いは、割り当てが成立するもののうち「手札の他カードの文明条件を残しやすいマナ」を優先してタップする。手動選択が必要になれば `PLAY_CARD.extra` に指定を足す。
- 行動を絞る(合法手の数を減らす)ことは、探索AIの強さに直結するため、選択肢を増やす変更は慎重に行う。

### 4.2 Pending(保留中の判断)と入力形式

```ts
interface Pending {
  id: number;                     // 古い画面からの二重送信を弾く
  player: PlayerId;               // 回答するプレイヤー(相手ターン中の相手の選択も含む)
  why: PendingReason;             // 目的(下)
  input: InputSpec;               // 入力の形(7種)。UIはこれだけを見て画面部品を選ぶ
  source?: ObjRef;                // どのカード/能力の判断か(表示用)
}

type PendingReason =
  | "turnAction"                  // メインステップ等の行動待ち(CHARGE_MANA / PLAY_CARD / ATTACK / END_*)
  | "block" | "triggerDeclare"    // 攻撃・ブレイクの割り込み
  | "pickNext"                    // 同時に待機している能力のうち、次に解決するもの
  | "select" | "modes" | "may" | "assign" | "replaceChoice" | "ack";   // 効果の解決中の判断

type InputSpec =                  // 入力形式は7種類(effects.md 11.2)
  | { shape: "pick";    candidates: ObjRef[]; min: number; max: number }
  | { shape: "assign";  items: ObjRef[]; slots: { id: string; count: number }[] }
  | { shape: "option";  options: string[]; pick: number; repeat: boolean; allIf?: boolean }
  | { shape: "yesno" }
  | { shape: "order";   candidates: number[] }
  | { shape: "payment"; need: Cost; mana: ObjRef[] }
  | { shape: "ack";     shown: ObjRef[] };
```

`pending` があるあいだ、`legalActions` は **その player の応答だけ**を返す。これでターン外の割り込み(相手ターン中のブロック・S・トリガー)も、通常の行動と同じ「1手」として扱える。`pick` のように組み合わせが多い入力は、列挙(`enumerateAnswers`)に上限を置き、UIは `validate` で確定の可否を判定する。

### 4.3 Event(出来事の記録)

`step` は新しい状態に加えて `Event[]` を返す。種類は少数の**原始イベント**(`moved` / `entered` / `evolved` / `cast` / `attackDeclared` / `shieldBroken` / `abilityTriggered` / `stepStart` / `looked` / `gameLoss` など、effects.md 4.1)で、「〜時」はそのパターンで表す。

- UIの対戦ログ(因果ツリー)・アニメーション・デバッグ・**ソリティア調査の使用履歴**に使う。
- 誘発の元になるのでロジックも Event を使う(待機プール)。ただし、状態だけで次が決まる(Event 自体は状態に溜め込まない。今ターン分のみ `turnLog` に持つ)。

---

## 5. reducer と合法手

```ts
step(state: GameState, action: Action, cards: CardDB): { state: GameState; events: Event[] }
legalActions(state: GameState, cards: CardDB): Action[]
toPlayerView(state: GameState, player: PlayerId): PlayerView
```

- `step` は**純粋関数**(入力を書き換えない、時刻・グローバル乱数を使わない)。
- 不正な Action が来たら例外を投げる(AI・UIのバグを早く見つけるため)。
- コピーは手動のコピーオンライト(変更したゾーンだけ新しい配列にする)。性能が問題になった時点でimmer等を検討する。**シリアライズ可能(関数・クラスインスタンス・循環参照を入れない)**を状態の制約にする。

### 5.1 ターン進行

```
turnStart(アンタップ) → draw → mana → main → attack → end → (相手のturnStartへ)
```

| ステップ | 自動/選択 | 内容 |
|---|---|---|
| turnStart | 自動 | 自分のマナ・クリーチャーをアンタップ |
| draw | 自動 | 1枚ドロー。先攻1ターン目はスキップ。山札が0枚になったプレイヤーは敗北(spec 3.7) |
| mana | 選択 | 手札1枚をマナゾーンへ(任意、1ターン1回)。多色カードはタップ状態で入る |
| main | 選択 | 手札から召喚/呪文を、条件を満たす限り何度でも |
| attack | 選択 | アンタップ状態で召喚酔いでないクリーチャーで攻撃 |
| end | 自動 | ターン終了時効果の処理 → 相手へ |

`phase` が自動のステップは、`step` の中でまとめて進める(UI・AIは選択が必要な場面でだけ呼ばれる)。ターン進行は実行スタックの最下層の手続きフレーム(`proc: "turn"`)で、メイン/攻撃ステップの行動待ちは `pending(why: "turnAction")` として出す(effects.md 3章・9章・10章)。

### 5.2 攻撃の処理フロー

公式の攻撃ステップ(506攻撃クリーチャー指定 → 507ブロッカー指定 → 508バトル → 509ダイレクトアタック → 510攻撃終了)に合わせる。**詳細は effects.md 第10章**(手続きフレーム `attack` / `breakShields`、各段階で `settle`(待機プールの解決)を呼ぶ)。

要点:

- 攻撃宣言(攻撃クリーチャーをタップ)で `attackDeclared` を発行し、「攻撃する時」の誘発と侵略を処理してからブロックへ進む。
- ブレイクしたシールドは、手札に加わる前に S・トリガー/G・ストライクを宣言し、全部手札に移ってから、宣言されたものを1枚ずつ解決する。解決中に新しくブレイクされた S・トリガーは先に解決する(101.4g)。
- 革命2のように「ブレイク後の枚数」で決まる付与は、宣言の判定時に派生ビューで評価する。

---

## 6. カード能力の実装方針

**詳細は [effects.md](./effects.md)**(最重要)。この章は要約。

1. **能力はデータ(AST)**。種類は `keyword` / `trigger` / `spell` / `static` / `replace` / `permission` / `costMod` / `custom`。効果の本体は `steps`(`act` / `select` / `may` / `if` / `each` / `repeat` / `modes`)の列で、**再開可能なインタプリタ(VM)**が実行する。
2. **すべての状態変化は原始操作を通す**。原始操作が「提案 → 置換 → 実行 → イベント発行 → 誘発の収集」を行う。
3. **誘発は待機プールに入れ、チェックポイントで1つずつ解決する**。順序は S・トリガー最優先 → ターンプレイヤー側 → 非ターンプレイヤー側、同じプレイヤー内は本人が選ぶ(101.4)。
4. **置換効果は専用のパイプライン**で、1つの出来事に1回だけ適用し、連鎖させない(101.5)。「トリガーしない」(キーナリー)も置換の一種として同じ場所で扱う。
5. **継続効果は派生ビューで計算**する(`View.cost` / `power` / `canAttack` / `canCast` / `canBeChosen` …)。「生成時に範囲が決まる効果」だけは対象のIDを固定して `state.effects` に持つ。
6. **ターン進行・プレイ・攻撃も実行スタックのフレーム**として書き、割り込みを同じ仕組みで入れ子にする。
7. **カード固有コード(`custom`)は最後の手段**。足りない時はまず原始操作を足す。

方針:

- **対応するのは、実際に使うデッキ(1〜2個分)のカードだけ**。未対応能力のカードをデッキに入れたら、`loader` が起動時にエラーにする(黙って無視しない)。
- 効果の対象選択は `pending` を使い、人間もAIも同じ経路で選ぶ。
- 実装は**垂直スライス**(effects.md 15.1)で、最初に「イベント → プール → VM → pending → UI」を細く最後まで通す。

---

## 7. AI設計

### 7.1 インターフェース

```ts
interface Agent {
  name: string;
  chooseAction(
    view: PlayerView,           // 自分から見える情報だけ
    legal: Action[],
    ctx: { rng: Rng; budget?: { iterations?: number; ms?: number } }
  ): Action | Promise<Action>;
}
```

- `PlayerView`: 自分の手札・マナ・場・墓地、相手の場・マナ・墓地・手札/山札/シールドの**枚数のみ**。ここに、`InfoPolicy`(7.3)に従って開示した情報を加える。
- 全Agentが同じインターフェースなので、人間(UI)・ランダム・ルールベース・MCTSを自由に組み合わせて対戦できる。

### 7.2 段階

| レベル | 内容 | 目的 |
|---|---|---|
| L0 ランダム | 合法手から一様ランダム。1試合が最後まで回れば成功 | エンジンの健全性テスト・基準線 |
| L1 ルールベース | 優先度つき手続き(例: 毎ターンマナチャージ、マナを余らせず高コストから召喚、安全な攻撃だけ行う、ブロッカーを残す) | 人間らしい基本動作・比較用の中程度の強さ |
| L2 モンテカルロ | 各合法手について、ランダム(またはL1)でプレイアウトを多数回行い、勝率が最も高い手を選ぶ | 強いCPU・デッキ評価 |

### 7.3 情報条件(`InfoPolicy`)と探索AIの隠し情報の扱い

相手の隠し情報をどこまで見せるかを、設定で変えられるようにする。既定は「公平」(人間と同じ)。

```ts
interface InfoPolicy {
  preset: "fair" | "partial" | "hypothesis" | "full";
  knowOpponentDecklist: boolean;              // 相手のデッキリストを既知にするか
  reveal?: {                                  // partial: 何を開示するか
    opponentHandCount?: number;               // 相手の手札のうちN枚の中身を開示
    opponentHandKinds?: string[];             // 種類だけ開示(例: "shieldTrigger", "blocker")
  };
  hypotheses?: Hypothesis[];                  // hypothesis: 決め打ち(例: 「相手は◯◯を持つ」)
}
```

- `toPlayerView(state, player, infoPolicy)` が、開示範囲に応じて相手の情報を加える。**開示の処理はこの関数だけに閉じ込める**(AI側のコードは設定を意識しない)。
- **決め打ち**は、人間が「次のターンにあれが来た時のために動く」読みに近い。探索AIの決定化(下記)で、相手の未公開カードのサンプリングに**重み**をつける(仮説のカードを多めに引かせる)ことで表す。重みの強さは設定にする。
- 調整の流れ: 「公平」でバッチ対戦して強さを測る → 弱ければ「部分開示」「決め打ち」を足して勝率の変化を見る(バッチは 8.1)。「全開示」は強さの上限を測るために使う。

**探索AI(L2)の決定化**: 相手の手札・シールド・山札の中身は見えない。**決定化(determinization)**として、相手の「未公開のカード集合」(既知のデッキリスト − 公開済みカード)からランダム(または重みつき)に割り当てた仮の状態を作り、その状態でプレイアウトする。これを多数回繰り返して手を選ぶ。デッキリストが未知の設定では、決定化の母集団を変える。計算量の上限は「反復回数」と「時間(ms)」の両方で指定できるようにする。

### 7.4 Web Worker

- `ai.worker.ts` が `{ view, legal, budget, agentName }` を受け取り、`{ action }` を返す。UIスレッドは探索中も操作可能。
- Workerに渡すのは `PlayerView` などJSON化できるデータだけ(P2の制約がここで効く)。

---

## 8. シミュレーション基盤

### 8.1 AI同士のバッチ対戦(`sim/batch`)

```ts
runMatches({ deckA, deckB, agentA, agentB, games, seed, swapFirst })
  → { winsA, winsB, draws, avgTurns, firstPlayerWinRate, perGameLog? }
```

- 試合ごとのシードを `seed + i` から派生させ、全試合を再現可能にする。
- Nodeで実行(`npm run batch -- ...`)。並列化が必要なら `worker_threads` を使う(最初は単一スレッド)。
- 無限ループ対策として **ターン上限(暫定100)** を設け、超えたら引き分け扱いにして記録する。

### 8.2 ソリティア調査(`sim/solitaire`): 確率調査とパターン調査

「4ターン目にコスト7のカードを使うには?」「その確率は?」を調べる。**カード効果込みで進めるため、engineをそのまま使う**(ブースト・デドダム・ヨビニオンなどの処理を別実装しない)。

**ソリティアモード**: `setup` で初期状態を作り、自分のターンだけ進める(相手のターンは行動なしでパスする)。先攻なら1ターン目のドローはなし。初期条件(初手に必ず含める/含めないカード、山札の上の固定)は、シャッフル結果の制約として与える。

**目標(Goal)**: GUIの条件ビルダーが組み立てる木構造。JSONとして保存・再利用できる。

```ts
type Goal =
  | { op: "and" | "or"; args: Goal[] }
  | { op: "not"; arg: Goal }
  | { op: "pred"; timing: Timing; pred: Predicate };

type Timing = { turn: number; at: "anyMain" | "turnEnd" | "byTurn" };   // byTurn = Nターン目までのどこかで

type Predicate =
  | { kind: "castable"; card: CardMatcher }                     // 手札にあり、その時点のマナで払える
  | { kind: "cast";     card: CardMatcher }                     // 実際に使った
  | { kind: "manaCount"; min: number; civ?: Civilization }
  | { kind: "zoneHas";  zone: Zone; card: CardMatcher; min?: number };

interface CardMatcher {
  names?: string[]; cost?: { eq?: number; gte?: number }; civs?: Civilization[];
  type?: "creature" | "spell"; face?: "creature" | "spell";
  costBasis: "printed" | "effective";                           // 表記コスト / 軽減後の実コスト(spec Q11)
}
```

`step` ごとに「その時点で達成したか」を判定する追跡器(`GoalTracker`)を通し、「Nターン目のメイン中のどこかで」のような途中の達成も取りこぼさない。

**確率調査**(`runProbability`):
- **方針プレイ**: プレイ方針(L1ルールベースを流用した自動プレイ)でNターン進め、達成率と95%信頼区間を出す。
- **探索による上限**: 各シャッフルについて、自分のターン内の行動列を探索し、**目標に到達する打ち方が1つでもあれば達成**とみなす。山札の並びを知っている前提の値になるため、方針プレイより高く出る。探索は、**状態ハッシュ**(盤面・手札・マナ・墓地・山札の並びを正規化したもの)で重複を除き、分岐の多い選択(デドダムの割り振りなど)も探索対象にする。ノード数の上限(`maxNodes`)を超えたシャッフルは「未判定」として別集計する。
- **厳密値**: 目標が「カードを引く」だけで書ける場合は、超幾何分布で厳密値を出し、Monte Carloの検算にする。

**パターン調査**(`runPatterns`):
- 探索で見つかった達成履歴を、`HistoryKey`(ターンごとの「マナチャージしたカード」「使ったカード(順序つき)」「効果の選択」)に射影して集計する。同一視の粗さは設定(既定は上記。「使用カードの集合のみ」に粗くもできる)。
- パターンごとに、件数・割合、初手に含まれていたカードの頻度(必要条件の要約)、代表シャッフルのシードを保持する。履歴は、`{ seed, actions[] }` として保存し、対戦画面で**再生**できるようにする(P2・P3の恩恵)。

**実行**: Workerで、シード範囲をチャンクに分けて処理し、進捗を通知する。キャンセルできる。

**計算量の注意**: 探索は指数的に増える。(a)状態ハッシュによる重複排除 (b)目標に無関係な行動の同一視 (c)ターン内で順序が結果に影響しない行動の順序正規化 (d)`maxNodes` で打ち切り、を入れる。

**engineへの要求**: 状態を丸ごとコピーでき、同じ状態から決定的に進められること。効果の選択(デドダムの割り振り、ヨビニオンを使うか、など)も `legalActions` に現れる「行動」として表すこと(6章・4.2)。

---

## 9. UI設計

- React + CSS。カード盤面は DOM / CSS Grid で作る。Canvas・ゲームエンジンは使わない。
- 状態管理: engineの `GameState` を `useReducer` で保持する薄いラッパー(`useGame`)を1つ作り、コンポーネントは状態を読むだけ。
- 画面: ①トップ(メニュー) ②デッキ/設定選択(座席ごとの人間/CPU・情報条件・先攻後攻) ③対戦(人間操作 / CPU同士の観戦) ④ソリティア調査(条件ビルダー → 実行 → 確率・パターン一覧 → 履歴の再生) ⑤バッチ結果(後続)
- 対戦画面: 相手の場 / 自分の場 / 手札 / マナ / シールド枚数 / **待機中の能力の一覧(待機プール)** / ログ(因果ツリー)/ 操作ボタン(マナチャージ・ターン終了など)。選べる対象は強調表示し、`legalActions` に含まれる操作だけ有効にする。
- **操作**: 手札→マナ(マナチャージ)、手札→バトルゾーン(召喚・詠唱)、自分のクリーチャー→相手のクリーチャー/シールド(攻撃)をドラッグで行う。すべてにクリックでの代替を用意する。ドラッグ開始時に、`legalActions` から作った「ドロップ先マップ」で落とせる場所を強調する(effects.md 11.3)。
- **入力ウィジェットは7種類**(pick / assign / option / yesno / order / payment / ack)を1回作るだけで、カードの数が増えても増えない(effects.md 11.2)。
- 多段階の入力はUIで集めて1つの Action として送る。効果の解決中の選択だけが pending(effects.md 11.1)。
- アニメーションは返ってきた Event を順に再生するだけにして、論理状態と表示状態を分ける。
- カード表示: **テキストのみ**(確定: 当面画像なし)。画像は `CardDef.image`(任意)があれば表示する作りにしておき、有無で画面が崩れないようにする。
- 同時に表示できる状態は1つだけ。AIの思考中は「考え中」表示を出し、入力を無効にする。
- **将来のスマホ対応に備える**(今回はPCのみ): ロジックとレイアウトを分ける(コンポーネントは見た目と状態を分離)/ 寸法はCSS Grid・Flexと相対単位で指定し、盤面の配置を後から差し替えられるようにする / ホバーだけで成立する操作を作らない(クリック・タップで同じことができる)/ タップしやすい大きさを意識する / 入力は Pointer Events でマウス・タッチを共通に扱う。

---

## 10. データ・永続化

- カードデータ: `src/cards/data/*.json`(手入力)。起動時に `schema.ts` で検証。
- デッキ: 当面はJSONファイルとして保持。後から `localStorage` への保存と、JSONのインポート/エクスポートを追加する。
- 試合の再現用に、`{ seed, deckA, deckB, actions[] }` を保存・再生できる形式にする(バグ報告・検証用)。

---

## 11. テスト戦略(Vitest)

| 種類 | 内容 |
|---|---|
| ルール単体テスト | 1ルール1テスト。例: 先攻1ターン目はドローしない / 召喚酔いは攻撃できない / W・ブレイカーは2枚割る / 同パワーは相打ち / シールド0で攻撃すると勝利 / 山札切れで敗北 |
| 不変条件テスト | 任意のタイミングで「各プレイヤーの全ゾーンのカード合計=デッキ枚数」「uidに重複なし」 |
| 決定性テスト | 同じシード・同じ行動列で、結果の状態が完全に一致する |
| スモークテスト | ランダムAI同士で数千試合し、全試合が終了し、例外が出ず、不変条件が保たれる |
| カード別シナリオ | 28種それぞれに、状態を与えて行動列を流し結果を検証するテスト(effects.md 13.1)。公式Q&A・裁定メモの注意点もここでテスト化 |
| 因果ツリー・性能 | 全イベントに `causedBy` が付く。1試合の所要時間に上限(effects.md 13.2) |
| カードデータ検証 | 全JSONがschemaを満たし、未対応能力がない |
| AI回帰 | L1がL0に勝ち越す(例: 勝率60%以上)ことを統計的に確認 |

- UIのテストは最小限(重要な操作フローのみ)。ロジックのテストを厚くする。

---

## 12. ビルド・公開

- 開発: `npm run dev`(Vite)/ `npm test`(Vitest)/ `npm run build`
- 公開: 未定(当面は自分でローカルで使うだけ: `npm run dev` / `npm run build && npm run preview`)。将来 Pages などに載せる場合は、Vite の `base` を公開パスに合わせる。
- CI(任意): push 時に lint・型チェック・テスト・ビルドを実行(GitHub Actions)。

---

## 13. 実装フェーズと完了条件

最優先は**効果・タイミング・操作の基盤**(effects.md)。フェーズ1〜2で、細くても「イベント → 待機プール → VM → pending → 最小UI」を最後まで通す(垂直スライス)。

| フェーズ | 内容 | 完了条件 |
|---|---|---|
| 0 | プロジェクト初期化(Vite+React+TS+Vitest、ESLint)。`node -v` の確認 | `npm test` と `npm run dev` が通る |
| 1 | コアルール(型・rng・setup・reducer・legal・勝利判定)+**効果基盤のS0**(原始操作・イベント・VM・pending・シナリオDSL)。カード: フェアリー・ライフ、デドダム | ルール単体テストとシナリオテストが通り、`assign` ウィジェットを含む最小UIで動く |
| 2 | **効果基盤のS1〜S6**(誘発とプール、攻撃・S・トリガー、modes、置換とEXライフ、踏み倒し・進化・侵略・コスト、コピー・ターンスキップ)と、decks.md の28種の能力処理 | 28種がすべて読み込め、未対応能力は起動時エラー。カード別シナリオが通る。同時誘発の順序を人間が選べる |
| 3 | ランダムAI+バッチ対戦CLI | ランダム同士の数千試合がエラーなく完走し、不変条件テストが通る |
| 4 | 対戦UI(人間 vs ランダムAI): ドラッグ操作、待機プール表示、7種の入力ウィジェット、因果ツリーのログ | ブラウザで1試合を最後まで遊べる |
| 5 | ソリティア調査(確率調査 → パターン調査)と条件ビルダーUI | 引きだけの目標でMonte Carloと超幾何の厳密値が一致し、「4ターン目に7コスト」の確率とパターンが出る |
| 6 | ルールベースAI(L1)と情報条件(`InfoPolicy`) | L0に統計的に勝ち越す。公平/部分開示/全開示でバッチ結果を比較できる |
| 7 | 探索型AI(L2)+Worker | UIが固まらず、L1に勝ち越す |
| 8 | 公開設定・デッキ保存・(任意)オンライン対戦 | 友達がURLから遊べる |

(確率シミュレータを早めに使いたいため、5はフェーズ4と並行して進めてもよい。ただし、**ソリティア調査はカード効果の処理に依存する**ので、フェーズ2のS3(modes・選択)あたりまでは待つ。)

---

## 14. 設計上の決定事項(ADR簡易版)

| ID | 決定 | 理由 | 状態 |
|---|---|---|---|
| D1 | engineは純TypeScript、状態はJSON互換 | P1・P2 | 確定 |
| D2 | 乱数は状態内のシード付きPRNG | 再現性 | 確定 |
| D3 | 割り込みは `pending` で表現 | 人間/AI共通化 | 確定 |
| D4 | マナ支払いは自動(割り当て問題として解く: 文明ごとに1枚+残りは数値。マナの多色カードは1文明扱い) | 合法手の爆発を避ける。現行ルール(112.2a) | 確定(方針) |
| D5 | AIの情報は `InfoPolicy` で調整。既定は公平(PlayerViewのみ) | 人間と同条件が基本。弱ければ部分開示・決め打ちで調整 | 確定 |
| D6 | ターン上限100で引き分け扱い(シミュレーション用) | 無限ループ対策。公式に引き分けの規定は確認できなかった | 仮 |
| D7 | カード画像は任意項目。当面なし | 画像なしで進める | 確定 |
| D8 | Node.js は現行LTS、パッケージ管理は npm、git はローカルのみ(PC環境は未確認) | 無回答のため既定値(spec 9.2 Q9)。フェーズ0で `node -v` を確認 | 仮 |
| D9 | 召喚酔いは `sick` フラグ(自分のターン開始時に解除) | 現行ルール(301.4 / 301.5): ターン開始時から継続してバトルゾーンにいるか | 確定 |
| D10 | 置換効果は専用のresolver(1つの出来事に1回だけ適用) | 現行ルール(101.5)。置換は連鎖しない | 確定 |
| D11 | シミュレータはengineをそのまま使うソリティア+探索 | カード効果込みの確率・使用履歴を出すため | 確定(方針) |
| D12 | 選択肢を持つ能力は、解決の開始時に必要回数分まとめて選び、上から順に処理 | 2022年のルール変更 | 確定 |
| D13 | 能力はASTで表し、インタプリタ(VM)で実行する。カード固有コードは最後の手段 | 能力のコピー(オルゲイト)・列挙・検証にはデータが必要 | 確定(方針) |
| D14 | すべての状態変化は原始操作を通し、置換 → 実行 → イベント → 誘発の収集の順 | 置換・誘発・ログ・履歴調査の一元化 | 確定(方針) |
| D15 | 誘発は待機プールに入れ、チェックポイントでのみ解決。プール全体から毎回選び直す | 101.4a / 101.4c を構造で保証。新旧の優先は要確認(effects L1) | 仮 |
| D16 | ターン進行・プレイ・攻撃も実行スタックのフレームとして書く | 割り込みの入れ子を同じ仕組みで扱う | 確定(方針) |
| D17 | メインステップの行動待ちも pending にし、個別 Action は `ANSWER` に統合 | UI/AIの経路を1本にする | 確定(方針) |
| D18 | 入力形式を7種に正規化し、UIは7ウィジェットだけを実装 | カード数が増えてもUIが増えない | 確定(方針) |
| D19 | 多段階の入力はUIで集めて1つの Action として送る(新しい情報が出る場合のみ pending) | キャンセルとUndoを簡単にする | 確定(方針) |
| D20 | オブジェクト参照は `(uid, ep)`、バトルゾーンは `Permanent`(山) | 別ゾーンのカードは別物(400.5)、進化の山を表す | 確定(方針) |
| D21 | 継続効果は派生ビュー+生成型は対象を固定(110.2e) | 解除忘れ防止とルール準拠 | 確定(方針) |

仮決定の項目と質問は [spec.md 第9章](./spec.md#9-未確定事項質問) を参照。効果・タイミングの要確認ルールは [effects.md 第15章](./effects.md) の台帳(L1〜L10)。
