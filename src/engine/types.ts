// ゲームの型定義(design 4 / effects 3)。状態はすべてJSON互換。関数・クラス・循環参照を入れない。

export type PlayerId = 0 | 1;
export type Civ = 'light' | 'water' | 'darkness' | 'fire' | 'nature';
export const CIVS: Civ[] = ['light', 'water', 'darkness', 'fire', 'nature'];
export const CIV_LABEL: Record<Civ, string> = { light: '光', water: '水', darkness: '闇', fire: '火', nature: '自然' };

/** hyper = 超次元ゾーン(各プレイヤーの表向きの置き場。インターステラが唱えた呪文を一時的に置く) */
export type ZoneName = 'deck' | 'hand' | 'mana' | 'shield' | 'battle' | 'grave' | 'limbo' | 'hyper';
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

/** catch で受けた値(unknown)から、画面・ログに出す文言を取り出す */
export function errorMessage(e: unknown): string {
  const m = (e as { message?: unknown } | null | undefined)?.message;
  return String(m ?? e);
}

// ───────────────────────── カードデータ(ASTは ast.ts) ─────────────────────────

import type { Ability, Cond } from './ast';

/** castle = G城(実行すると、表向きのシールドになるカード。クリーチャーでも呪文でもない) */
export type FaceType = 'creature' | 'spell' | 'evolution' | 'smaxEvolution' | 'castle';

/** クリーチャーとして出る種類か(呪文でも城でもない) */
export const isCreatureType = (t: FaceType): boolean => t === 'creature' || t === 'evolution' || t === 'smaxEvolution';

export interface Face {
  name: string;
  type: FaceType;
  cost: number;
  civs: Civ[];
  power?: number;
  races?: string[];
  abilities: Ability[];
  /** 進化元の条件(type=evolution)。$it = 重ねる対象 */
  evolveFrom?: Cond;
}

export interface CardDef {
  id: string;
  name: string;
  faces: Face[]; // ツインパクトは2面(0=クリーチャー面, 1=呪文面)
  text?: string;
  image?: string | null;
}
export type CardDB = Record<string, CardDef>;

// ───────────────────────── 状態 ─────────────────────────

export interface Card {
  defId: string;
  owner: PlayerId;
  zone: ZoneName;
  /** ゾーンを移動するたびに増える。参照 ObjRef は (uid, ep) の組(E9) */
  ep: number;
  /** マナゾーンでのタップ状態(バトルゾーンは Permanent.tapped) */
  tapped: boolean;
  /** EXライフのシールドか */
  ex: boolean;
  /** 表向きのシールドか(G城。シールドゾーンにある間だけ true。無ければ裏向き) */
  up?: boolean;
  exPid: number;
  /** バトルゾーンでの山の識別子(それ以外は -1) */
  pid: number;
  /** 使用中の面(ツインパクト) */
  face: number;
}

export interface Permanent {
  pid: number;
  /** 先頭が一番上(クリーチャー本体)。2枚目以降は進化元 */
  cards: number[];
  tapped: boolean;
  sick: boolean;
  enteredTurn: number;
}

export interface PlayerZones {
  deck: number[]; // 先頭が山札の上
  hand: number[];
  mana: number[];
  shield: number[];
  grave: number[]; // 末尾が一番上
  hyper: number[]; // 超次元ゾーン
  battle: Permanent[];
}

export interface ObjRef {
  uid: number;
  ep: number;
}

export type Step = 'start' | 'draw' | 'mana' | 'main' | 'attack' | 'end';

export interface GameConfig {
  turnLimit: number; // 暫定100(D6)
  solitaire: boolean; // プレイヤー1は何もしない(spec 6.7)
  autoOrder: [boolean, boolean]; // 同時誘発の順序を自動にする(Q17)
  ackReveals: [boolean, boolean]; // 公開した札の確認を求めるか
  /**
   * L1 待機中の能力の解決順。公式は 'pool'(待機した順番は関係なく、ターン・プレイヤーから自分の効果を好きな順で。R 605.1)。
   * 'newFirst' / 'oldFirst' は公式に反する。「順序が結果に与える影響」を比べる実験と、テスト(tests/ledger.test.ts)のためだけに残す。
   */
  waitingPolicy: 'pool' | 'newFirst' | 'oldFirst';
  /**
   * L2 状況起因処理のタイミング。公式は 'afterEachStep'(効果の解決中でも優先して処理する。R 111.2d / 703.1)。
   * 'afterEffect' は公式に反する。比較実験とテストのためだけに残す。
   */
  sbaTiming: 'afterEachStep' | 'afterEffect';
  /** ジ・ウォッチ等の「ターンの残りをとばす」でターン終了時の誘発を起こすか(L6)。公式Q&A 46393 では起きない(既定 false) */
  skipRunsEndTriggers: boolean;
  maxFrameSteps: number; // L7
}

export const defaultConfig = (): GameConfig => ({
  turnLimit: 100,
  solitaire: false,
  autoOrder: [false, false],
  ackReveals: [false, false],
  waitingPolicy: 'pool',
  sbaTiming: 'afterEachStep',
  skipRunsEndTriggers: false,
  maxFrameSteps: 20000,
});

export interface Snap {
  uid: number;
  defId: string;
  owner: PlayerId;
  face: number;
  zone: ZoneName;
  civs: Civ[];
  cost: number;
  power: number;
  multicolor: boolean;
  pid: number;
}

export interface Ev {
  id: number;
  causedBy: number | null;
  type: string;
  turn: number;
  [k: string]: any;
}

export type AbilityRef = { defId: string; face: number; idx: number };

export interface EffectFrame {
  kind: 'effect';
  id: number;
  causedBy: number | null;
  ability: AbilityRef;
  /** 参照先。ゾーン移動後も lki から読む */
  source: ObjRef;
  lki: Snap;
  controller: PlayerId;
  pc: number;
  vars: Record<string, any>;
  trigger?: Ev | null;
  /** optional 包装を外す(能力のコピー) */
  noOptional?: boolean;
  /** 呪文などで、解決後の処理が要る親(play proc) */
  label?: string;
}

export type ProcName = 'turn' | 'play' | 'attack' | 'break' | 'settle' | 'sba';
export interface ProcFrame {
  kind: 'proc';
  id: number;
  causedBy: number | null;
  name: ProcName;
  stage: number;
  vars: Record<string, any>;
}
export type Frame = EffectFrame | ProcFrame;

export interface PoolEntry {
  id: number;
  batch: number;
  ability: AbilityRef | null;
  /** 'ability' = 誘発型能力 / 'shieldTrigger' = 宣言されたS・トリガー / 'gStrike' */
  kind: 'ability' | 'shieldTrigger' | 'gStrike';
  source: ObjRef;
  lki: Snap;
  controller: PlayerId;
  event: Ev | null;
  /** S・トリガー層で処理されるか */
  stLayer: boolean;
  /** 非公開ゾーンで誘発した「してもよい」の能力を、使用宣言済みか(宣言したものは解決時に取りやめられない。506.3b) */
  declared?: boolean;
}

export type Duration =
  | { kind: 'endOfTurn'; turn: number }
  | { kind: 'untilTurnStart'; player: PlayerId; afterTurn: number }
  | { kind: 'source'; uid: number; ep: number };

export type EffectMod =
  | { kind: 'cannotAttack' }
  | { kind: 'powerAdd'; n: number }
  | { kind: 'grant'; keyword: string }
  | { kind: 'cannotBeChosen' }
  | { kind: 'cannotBeAttacked' }
  /** ブロックを強制する(攻撃された時、ブロッカーとして選ばなければならない。総合ルール 507.1b) */
  | { kind: 'mustBlock' }
  /** プレイヤー単位(ContEffect.pid = -1): 発生源の持ち主の相手は呪文を唱えられない */
  | { kind: 'cannotCast' }
  /** プレイヤー単位: 発生源の持ち主の相手は、コストが n のカードを実行できない */
  | { kind: 'cannotUseCost'; n: number }
  /** プレイヤー単位: 発生源の持ち主の相手は、コストが maxCost 以下のクリーチャーを召喚できない */
  | { kind: 'cannotSummon'; maxCost: number };

export interface ContEffect {
  id: number;
  /** 対象の山(プレイヤー単位の効果は -1) */
  pid: number;
  mod: EffectMod;
  until: Duration;
  controller: PlayerId;
}

export interface GameState {
  v: 1;
  cards: Card[];
  players: [PlayerZones, PlayerZones];
  limbo: number[];
  turn: number; // 通しターン(1始まり)
  active: PlayerId;
  step: Step;
  first: PlayerId;
  cont: Frame[];
  pool: PoolEntry[];
  effects: ContEffect[];
  turnLog: Ev[];
  usage: Record<string, number>;
  pending: Pending | null;
  /** 入力待ちの回答(再実行で消費する) */
  rans: AnswerValue[];
  rng: number;
  seq: number;
  nextPid: number;
  batchNo: number;
  winner: PlayerId | 'draw' | null;
  loseReason: string | null;
  skipTurn: boolean;
  manaCharged: boolean;
  /** 直近のブレイクで割られているシールド(革命2の枚数判定) */
  breaking: number[];
  deckIds: [string[], string[]]; // 初期デッキ(カードID列)。決定化・開示に使う
  cfg: GameConfig;
  dirtySba: boolean;
  /**
   * 山札の中で「中身が公開された札のまとまり」(ヨビニオンで公開して山札の下に戻した札など)。プレイヤーごと。
   * 並び順は伏せられる(シャッフル済み)が、どの札が下にあるかは両者が知っている。推論(ai/determinize)に使う。
   * 札が山札を離れる/山札全体をシャッフルすると、そのまとまりは崩れる(ep で検査)。
   */
  knownDeck?: [KnownGroup[], KnownGroup[]];
  /** PlayerView だけが持つ追加情報(部分開示)。engine は使わない */
  hints?: ViewHints;
}

/** 公開されたまとまり。同じ ep の札だけが「まだ山札のそこにある」 */
export type KnownGroup = { uid: number; ep: number }[];

/** 視点に渡す「山札の中の既知のまとまり」。uids は山札のどこかにある位置、defIds はその中身(順不同) */
export interface DeckGroupHint {
  uids: number[];
  defIds: string[];
}

export interface ViewHints {
  /** 山札の中で中身が公開されているまとまり(プレイヤーごと)。決定化で、その枠に正体を割り当てる */
  deckKnown?: [DeckGroupHint[], DeckGroupHint[]];
  /** 相手の手札のうち、種類ごとの枚数(部分開示) */
  oppHandKinds?: Record<string, number>;
  /** 相手のデッキリストが既知か */
  knowOppDeck?: boolean;
}

// ───────────────────────── 行動・入力 ─────────────────────────

export type AttackTarget = { kind: 'player' } | { kind: 'creature'; pid: number };
export interface PlayExtra {
  /** 進化先の山 */
  onto?: number;
  /** ハイパーエナジーでタップする山 */
  tap?: number[];
  /** 手動支払い(マナのuid) */
  pay?: number[];
}

export type Action =
  | { type: 'CHARGE_MANA'; uid: number }
  | { type: 'SKIP_MANA' }
  | { type: 'PLAY_CARD'; uid: number; from?: ZoneName; face?: number; extra?: PlayExtra }
  | { type: 'ATTACK'; attacker: number; target: AttackTarget }
  | { type: 'END_MAIN' }
  | { type: 'END_TURN' }
  | { type: 'ANSWER'; id: number; value: AnswerValue };

export type AnswerValue = number[] | Record<string, number[]> | boolean | number | true;

export type InputSpec =
  | { shape: 'pick'; candidates: number[]; min: number; max: number }
  | { shape: 'assign'; items: number[]; slots: { id: string; to: ZoneName; count: number; label: string }[] }
  | { shape: 'option'; options: string[]; pick: number; repeat: boolean; allIf: boolean; /** 選ぶ前に見たカード(山札の上など)。選ぶ人には中身が見える */ seen?: number[] }
  | { shape: 'yesno' }
  | { shape: 'order'; candidates: number[]; labels: string[] }
  | { shape: 'payment'; need: number; mana: number[] }
  | { shape: 'ack'; shown: number[] };

export type PendingReason =
  | 'turnAction'
  | 'block'
  | 'triggerDeclare'
  | 'pickNext'
  | 'select'
  | 'modes'
  | 'may'
  | 'assign'
  | 'replaceChoice'
  | 'ack'
  | 'keepOne';

export interface Pending {
  id: number;
  player: PlayerId;
  why: PendingReason;
  input: InputSpec | null;
  source?: ObjRef | null;
  prompt?: string;
}

/**
 * 入力待ちを drive に知らせるための制御用の例外。
 * Error を継承しない(継承するとスタックトレースの生成が高コストで、入力待ちのたびに発生する)。
 */
export class NeedInput {
  constructor(public spec: Omit<Pending, 'id'>) {}
}

export class RuleLoopError extends Error {}
export class IllegalAction extends Error {}
