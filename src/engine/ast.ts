// カード能力のAST(effects 6)。カードJSONはこの形で書く。

import type { Civ, ZoneName, EffectMod } from './types';

export type Expr =
  | number
  | { var: string }
  | { count: Selector }
  | { costOf: string }
  /** 誘発したイベントの、配列の項目(cards など)の数。「各ブレイクの前に」で、ブレイクする枚数だけ繰り返す時に使う */
  | { evLen: string }
  /** 変数のカードがいるバトルゾーンの山の、下に重なっているカードの枚数(フィールドの下など) */
  | { under: string }
  /** セレクタに合うカードの、コストの種類の数(「コストが異なるクリーチャー1体につき」) */
  | { distinct: { sel: Selector; by: 'cost' } }
  | { add: Expr[] }
  | { sub: [Expr, Expr] }
  | { min: Expr[] }
  | { max: Expr[] }
  | { mul: Expr[] }
  /** 変数のカードの、いまのパワー */
  | { powerOf: string };

export interface Selector {
  zone: ZoneName | ZoneName[];
  /** 能力の処理者から見た持ち主。'iter' は forPlayers の現在のプレイヤー */
  owner?: 'self' | 'opponent' | 'any' | 'iter';
  type?: 'creature' | 'spell' | 'card' | 'element' | 'tamaseed' | 'field' | 'crossgear';
  where?: Cond;
  /** 「選ぶ」対象か(ジャストダイバー等の判定を行う) */
  chooseable?: boolean;
  notSelf?: boolean;
  /** 除外する変数(参照のリスト) */
  except?: string;
  /** 候補を、この変数が指すカードに限る(lookTop で見たカードなど) */
  of?: string;
}

/** 条件。1キーのオブジェクトとして書く(評価は cond.ts)。$it = 判定対象のカード */
export type Cond =
  | { all: Cond[] }
  | { any: Cond[] }
  | { not: Cond }
  | { civ: Civ }
  | { civsAll: Civ[] }
  | { multicolor: boolean }
  | { cost: { eq?: Expr; lt?: Expr; lte?: Expr; gt?: Expr; gte?: Expr } }
  | { power: { lte?: Expr; gte?: Expr; lt?: Expr; gt?: Expr } }
  | { type: 'creature' | 'spell' | 'element' | 'tamaseed' | 'field' | 'crossgear' }
  | { evolution: boolean }
  | { race: string }
  | { tapped: boolean }
  | { sameCivAs: string }
  | { cmp: { l: Expr; op: '<' | '<=' | '>' | '>=' | '==' | '!='; r: Expr } }
  | { count: Selector; gte?: number; lte?: number; eq?: number }
  | { fiveCivs: Selector }
  | { civsPresent: { sel: Selector; civs: Civ[] } }
  | { logged: { pattern: { [k: string]: any }; min?: number; /** 指定の種類のイベントのうち、最後のものより後だけを数える(攻撃ごと、など) */ since?: string } }
  | { shields: { lte?: number; eq?: number; gte?: number; who?: 'self' | 'opponent' } }
  | { notInBattle: boolean }
  | { nonEmpty: string }
  /** 変数のカード(いまのゾーンの特性で見る)のどれかが where を満たす */
  | { some: { var: string; where: Cond } }
  /** $it が、能力の発生源自身 */
  | { isSelf: true }
  /** 誘発したイベント(出た・唱えた)が、S・トリガーとして使われたもの */
  | { stUsed: true }
  /** $it が、シールドゾーンで表向き */
  | { faceUp: true }
  /** 発生源が、ハイパーモード中 */
  | { hyper: true }
  /** 発生源(バトルゾーンのクリーチャー)が、タップしている(true)・アンタップしている(false) */
  | { selfTapped: boolean }
  /** $it の持ち主が、能力の処理者(self)・その相手(opponent) */
  | { ownedBy: 'self' | 'opponent' }
  /** 変数のカード(進化クリーチャー)が、$it(バトルゾーンのクリーチャー)の上に進化できる(進化元の条件を満たす) */
  | { baseFor: string }
  /** $it(バトルゾーンのクリーチャー)が、そのキーワードを持つ(「ブロッカー」を持つクリーチャー) */
  | { hasKw: 'blocker' | 'speedAttacker' | 'machFighter' | 'slayer' }
  /** 発生源が、そのターンに別のコスト(altCost の id)を使って出た */
  | { altUsed: string }
  /** $it のカード名が、指定の文字列を含む */
  | { nameHas: string }
  /** $it の(使う面の)能力に、「このクリーチャーが出た時」で始まる能力がある */
  | { hasCip: true }
  /** 誘発したイベントの項目が、指定の値と等しい(例: paid: 0 = マナを支払わずに出た) */
  | { eventIs: { [k: string]: string | number | boolean } }
  /** 変数のカードがすべて where を満たし、コストがすべて同じ(1枚以上) */
  | { allSame: { var: string; where?: Cond } }
  /** 誘発したイベント(重なった時)で、$it の下にあった(重ねられた)クリーチャーが where を満たす */
  | { onBase: Cond }
  /** $it のパワーが、セレクタに合うカードの中で、一番大きい(max)・小さい(min) */
  | { powerRank: { which: 'max' | 'min'; of: Selector } }
  /** ゲーム中に1度の能力(key)を、まだ使っていない */
  | { unused: string }
  | { turnOf: 'self' | 'opponent' }
  | { zoneIs: ZoneName }
  /** $it が、能力の発生源(EXライフを持つクリーチャー)のEXライフのシールドか */
  | { exShield: true }
  | { true: true };

export type ActDef = { [act: string]: any };

export type StepDef =
  | { op: 'act'; act: ActDef }
  | {
      op: 'select';
      as: string;
      who?: 'controller' | 'opponent' | 'iter';
      from: Selector | { var: string };
      min?: Expr;
      max?: Expr;
      random?: boolean;
      /** 変数に、選んだものを追記する(既にあれば、その後ろに足す)。両者が選んでから一括で処理する時に使う */
      append?: boolean;
      /** 選んだカードの表記コストの合計がこの値以下になるように、好きな数を選ぶ(min は 0 になる) */
      sumLte?: Expr;
      prompt?: string;
    }
  | { op: 'may'; then: StepDef[]; else?: StepDef[]; prompt?: string }
  | { op: 'if'; cond: Cond; then: StepDef[]; else?: StepDef[] }
  | { op: 'each'; in: string; as: string; body: StepDef[] }
  | { op: 'repeat'; times: Expr; body: StepDef[] }
  | {
      op: 'modes';
      pick: number;
      repeat?: boolean;
      allIf?: Cond;
      who?: 'controller' | 'opponent';
      options: { label: string; steps: StepDef[] }[];
    }
  | { op: 'forPlayers'; body: StepDef[] }
  | { op: 'custom'; handler: string; args?: any };

export type Pattern = { type: string; [k: string]: any };

export interface TriggerSpec {
  on: Pattern | Pattern[];
  watch?: ZoneName[];
  subject?: 'self' | 'other' | 'any';
  turn?: 'own' | 'opponent' | 'any';
  nthThisTurn?: number;
  /**
   * 自身がバトルゾーンを離れた時にも、その出来事で誘発する(離れる直前の状態を見る。総合ルール 603.5c・603.5d)。
   * 過去の状態を見られるのは、その能力を持つカード自身だけ。他のクリーチャーが同時に離れても、誘発は自身の分の1回
   */
  lookBack?: boolean;
  /** 同じ種類・持ち主(・理由)のイベントの、そのターンの n 回目以降 */
  nthMin?: number;
  limit?: { perTurn: number };
  if?: Cond;
  ifAtResolve?: Cond;
}

export type KeywordName =
  | 'blocker'
  | 'breaker'
  | 'shieldTrigger'
  | 'gStrike'
  | 'speedAttacker'
  | 'machFighter'
  | 'exLife'
  | 'justDiver'
  | 'sympathy'
  | 'hyperEnergy'
  | 'yobinion'
  | 'invasion'
  | 'slayer'
  | 'revolutionChange'
  /** パワード・ブレイカー: パワー n ごとに、シールドをもう1つブレイクする */
  | 'poweredBreaker'
  /** S・バック: attacker(条件)に合うカードが、自分のシールドゾーンから手札に加わる時、それを捨てて、手札のこの呪文をコストを支払わずに唱えてもよい */
  | 'sBack';

export type StaticMod =
  | { type: 'costDelta'; delta: Expr; cond: Cond; /** 各ターンに1度だけ(発生源ごと)。使うと、そのターンはもう働かない */ oncePerTurn?: boolean; /** これを適用した後のコストの下限(「ただしコストは0以下にならない」= 1) */ floor?: number }
  /** 攻撃中、このクリーチャーのパワーを n 増やす(パワーアタッカー) */
  | { type: 'powerAttacker'; n: number }
  /** このクリーチャーがシールドをブレイクする時、相手はそのシールドを手札に加えるかわりに墓地に置く */
  | { type: 'burnShields' }
  /** 各ターン、はじめて自分のクリーチャーがバトルする時、そのクリーチャーはそのバトルに勝つ */
  | { type: 'firstBattleWins' }
  /** 各ターン、はじめて出る相手のクリーチャーは、タップして出る */
  | { type: 'enterTappedFirst' }
  /** 相手のターンのはじめに、相手は自身のマナゾーンのカードを n 枚までしかアンタップできない */
  | { type: 'untapLimit'; n: number }
  /** 自分のターン中、cond に合う自分のカードを from のゾーンから召喚してもよい(コストは支払う)。oncePerTurn なら「1体」(発生源ごとに各ターン1度) */
  | { type: 'allowPlayFrom'; from: ZoneName; cond?: Cond; oncePerTurn?: boolean; /** アビスラッシュを与える(墓地から召喚すると、そのターン攻撃でき、ターンの終わりに山札の下に置かれる) */ rush?: boolean }
  /** このクリーチャーは、相手に選ばれない(攻撃・ブロックはされる) */
  | { type: 'cannotBeChosen' }
  /** 相手がクリーチャーを選ぶなら、可能ならこのクリーチャーを選ばなければならない */
  | { type: 'mustBeChosen' }
  /** このクリーチャーは、呪文によって相手に選ばれない */
  | { type: 'protectFromSpells' }
  /** 自分は、呪文を唱えられなくする効果を無視して、cond に合う呪文を唱えてもよい */
  | { type: 'ignoreCastBan'; cond: Cond }
  | { type: 'cannotAttackPlayerWhenEntered' }
  | { type: 'cannotCast'; cond: Cond }
  | { type: 'powerAdd'; n: number }
  /** 自分の墓地から呪文を唱えた後、墓地のかわりに山札の下に置く */
  | { type: 'graveCastToBottom' }
  /** 自分のクリーチャー(cond に合うもの)すべてにキーワードを与える。unblockable = ブロックされない */
  | { type: 'grantKeyword'; keyword: 'speedAttacker' | 'machFighter' | 'slayer' | 'unblockable' | 'blocker' | 'cannotBeAttacked'; cond: Cond }
  /** 自分は、山札が0枚でもゲームに負けない */
  | { type: 'noDeckOutLoss' }
  /** 相手のクリーチャーは、タップして出る */
  | { type: 'enterTapped' }
  /** このクリーチャーのパワーを、式の値だけ増やす(「〜1体につき+3000」など。評価は、このクリーチャーから見る) */
  | { type: 'powerAddExpr'; expr: Expr }
  /** このクリーチャーがシールドをブレイクする時、相手はそのシールドを手札に加えるかわりに、自身の山札の上から4枚目の位置に横向きに刺す(5.S.D.) */
  | { type: 'stab5sd' }
  /** 相手は、自身の山札を見れず、順序を変えられない */
  | { type: 'deckLock' }
  /** 相手は、自身の「S・トリガー」を使えない(G・ストライクは使える) */
  | { type: 'noOppShieldTrigger' }
  /** 相手のクリーチャーが攻撃するなら、可能ならこのクリーチャーを攻撃する */
  | { type: 'attackMeFirst' }
  /** 相手は、自身のターンに1回までしか呪文を唱えられない */
  | { type: 'oneSpellPerTurn' }
  /** このクリーチャーは攻撃できない */
  | { type: 'cannotAttack' }
  /** このクリーチャーは、相手プレイヤーを攻撃できない */
  | { type: 'cannotAttackPlayer' }
  /** 相手は、cond に合うカード(クリーチャーでないカードなど)を使えない(召喚・唱える・出すのすべて) */
  | { type: 'cannotPlay'; cond: Cond }
  /** 自分の他のクリーチャー(cond に合うもの)が相手のクリーチャーとバトルする時、かわりにこのクリーチャーにバトルさせてもよい */
  | { type: 'battleProxy'; cond: Cond }
  /** ガードマン: このクリーチャーをタップして、相手クリーチャーの攻撃先を、自分の他のクリーチャーからこのクリーチャーに変更してもよい */
  | { type: 'guardman' }
  /** 自分の他のカード(cond に合うもの)のパワーを n 増やす */
  | { type: 'powerAddOthers'; n: number; cond: Cond };

export type ReplaceApply =
  | { type: 'changeDest'; to: ZoneName }
  | { type: 'cancelTrigger' }
  | { type: 'smaxSacrifice' }
  /** かわりに、この手順を行う(出来事は起きない)。ゲームに負ける時の置換などで使う */
  | { type: 'steps'; steps: StepDef[] };

export type Ability =
  | { kind: 'keyword'; name: KeywordName; n?: number; while?: Cond; steps?: StepDef[]; attacker?: Cond; label?: string }
  | { kind: 'trigger'; spec: TriggerSpec; optional?: boolean; steps: StepDef[]; label?: string; /** キーワードから展開した誘発型能力(「出た時」で始まる能力に数えない) */ gen?: boolean }
  | { kind: 'spell'; steps: StepDef[] }
  | { kind: 'static'; mod: StaticMod; while?: Cond }
  | { kind: 'replace'; match: Pattern; apply: ReplaceApply; optional?: boolean; while?: Cond; label?: string }
  | { kind: 'permission'; play: 'summon' | 'cast' | 'put'; from: ZoneName; after?: 'deckBottom'; /** アビスラッシュ */ rush?: boolean }
  /** このカード自身を使うコストの増減(delta は負で軽減。cond を満たす時だけ。評価は、このカードを使う人から見る。floor: これを下回らない) */
  | { kind: 'selfCost'; delta: Expr; cond?: Cond; floor?: number }
  /** ハイパー化: 自分のメインステップ中に、自分の他のクリーチャーを tapOther 体タップして、ハイパーモードを解放できる(次の自分のターンのはじめまで) */
  | { kind: 'hyperize'; tapOther: number }
  /** シンカライズ: このタマシードがクリーチャーであるかのように、この上に進化クリーチャーを置ける */
  | { kind: 'shinkalize' }
  /** マナを払うかわりの、別のコスト(PlayExtra.alt で選ぶ)。手札から使う時 */
  | { kind: 'altCost'; id: string; label: string; when?: Cond; cost: AltCostSpec };

/** 別のコスト(マナを払うかわりに行う)。discard を持たなければ、何も払わない */
export interface AltCostSpec {
  /** この別のコストで使えるゾーン(省略 = 手札) */
  from?: ZoneName[];
  /** 自分のクリーチャーを n 体タップする(ムゲンクライム) */
  tapCreatures?: number;
  /** マナを、コストのかわりに n 払う(このカードの文明を満たす。ムゲンクライム) */
  pay?: number;
  /** 手札から(このカード以外の)where に合うカードを n 枚捨てる */
  discard?: { n: number; where?: Cond };
  /** マナは払うが、コストを n 少なくする(指定すると、マナを払うかわりにはならない) */
  reduce?: number;
  /** こうして出したら、このターンの終わりに山札の下に置く。そうしたら、カードを1枚引く(J・O・E) */
  endBottomDraw?: boolean;
}

export type { EffectMod };
