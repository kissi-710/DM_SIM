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
  | { add: Expr[] }
  | { sub: [Expr, Expr] }
  | { min: Expr[] }
  | { max: Expr[] };

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
  | { power: { lte?: number; gte?: number } }
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
  /** 発生源が、そのターンに別のコスト(altCost の id)を使って出た */
  | { altUsed: string }
  /** $it のカード名が、指定の文字列を含む */
  | { nameHas: string }
  /** $it の(使う面の)能力に、「このクリーチャーが出た時」で始まる能力がある */
  | { hasCip: true }
  /** 誘発したイベントの項目が、指定の値と等しい(例: paid: 0 = マナを支払わずに出た) */
  | { eventIs: { [k: string]: string | number | boolean } }
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
  | 'revolutionChange';

export type StaticMod =
  | { type: 'costDelta'; delta: number; cond: Cond; /** 各ターンに1度だけ(発生源ごと)。使うと、そのターンはもう働かない */ oncePerTurn?: boolean }
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
  | { type: 'allowPlayFrom'; from: ZoneName; cond?: Cond; oncePerTurn?: boolean }
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
  | { type: 'grantKeyword'; keyword: 'speedAttacker' | 'machFighter' | 'slayer' | 'unblockable' | 'blocker'; cond: Cond };

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
  | { kind: 'permission'; play: 'summon' | 'cast' | 'put'; from: ZoneName; after?: 'deckBottom' }
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
  /** 手札から(このカード以外の)where に合うカードを n 枚捨てる */
  discard?: { n: number; where?: Cond };
  /** マナは払うが、コストを n 少なくする(指定すると、マナを払うかわりにはならない) */
  reduce?: number;
}

export type { EffectMod };
