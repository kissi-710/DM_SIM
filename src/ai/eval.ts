// 盤面の評価関数(AIの先読み・プレイアウトの打ち切りで使う)。
import { hasKeyword, powerOf, charsLite } from '../engine/derive';
import { mkCtx } from '../engine/state';
import type { Registry } from '../engine/registry';
import type { GameState, PlayerId } from '../engine/types';
import type { L1Params } from './l1params';
import { modelProb, type ValueModel } from './valueModel';

/** 評価の重み(自己対戦で調整できるように、外から差し替えられる。JSON 化できる) */
export interface EvalWeights {
  /** クリーチャー1体の基本価値 */
  creature: number;
  /** パワー(÷ powerDiv)の価値 */
  powerDiv: number;
  blocker: number;
  speedAttacker: number;
  /** 進化などで重なっているカード1枚(最大1枚ぶん) */
  stack: number;
  shield: number;
  hand: number;
  /** マナ1枚(10枚まで) */
  mana: number;
  /** 手札のコスト(8まで)の1あたり */
  handCost: number;
  /** 山札が尽きそうな時の不利(1枚不足あたり) */
  deckOut: number;
  /** 評価差を 0〜1 の報酬に写す尺度(tanh(差/scale)) */
  scale: number;
}

/** プレイアウトの報酬に使う設定: 評価の重み + (あれば)学習した価値関数。model があれば、打ち切りの報酬は評価の重みではなく、これが返す勝つ確率になる */
export interface RewardWeights extends EvalWeights {
  model?: ValueModel;
  /** プレイアウトの方針の設定(docs/ai-quality-plan.md §7)。ターン中の行動の優先度・しきい値(既定は L1_DEFAULT) */
  l1?: Partial<L1Params>;
  /** プレイアウトで、効果の選択(対象・任意・ブロックなど)を、1手先読みの評価で選ぶ(既定は軽い乱択) */
  lookahead?: boolean;
  /** プレイアウトで、ターン中の行動を、この確率で一様ランダムに指す(ε 乱択。既定 0) */
  eps?: number;
  /** 報酬を、最後の1点と、途中のターンの境目の報酬の平均とで混ぜる割合(0〜1。既定 0) */
  traj?: number;
  /** 軌跡平均で、後の境目ほど軽くする比(1 = 均等。0.5 = 1つ後ごとに半分) */
  trajDecay?: number;
  /** 軌跡平均に、プレイアウトの開始時点の報酬も入れる(1 で有効) */
  trajStart?: number;
  /** 世界の抽出を対称(antithetic)にする: 2つ組のラウンドで、同じ種の反転列を使う(1 で有効) */
  anti?: number;
  /** プレイアウトの L1: 相打ちでも、相手のコスト − 自分のコスト がこの値以上なら攻撃する(l1.atkTrade と同じ。99 で無効) */
  atkTrade?: number;
  /** 学習した召喚の方針の重み(ai/l1learn.ts。あれば、プレイアウトの召喚・詠唱の選択がこれになる。Rust 版も同じ) */
  playModel?: number[];
}

/**
 * モンテカルロ探索の既定の重み。自己対戦での調整の結果、マナの価値が大きく上がった(手札1枚より高い)。
 * マナは「先の手番の選択肢」なので、3ターン先の評価で手札と同じ重さだと、探索が「溜めない」を選んでしまう。
 * 調整の記録: docs/ai-speed-and-strength.md の §2。
 */
export const DEFAULT_WEIGHTS: RewardWeights = {
  creature: 3,
  powerDiv: 2500,
  blocker: 1.5,
  speedAttacker: 0.5,
  stack: 0.5,
  shield: 4,
  hand: 1.6,
  mana: 3.5,
  handCost: 0.05,
  deckOut: 3,
  scale: 30,
  // 報酬は、先読みの最後の1点ではなく、途中のターンの境目の評価との平均にする(docs/ai-quality-plan.md §8。対 旧 56〜58%)
  traj: 1,
};

/** ルールベース(L1)の1手先の評価で使う重み。L1 は、この重みで調整されている(探索の既定とは別) */
export const RULE_WEIGHTS: EvalWeights = { ...DEFAULT_WEIGHTS, mana: 1.1 };

export const withWeights = (w?: Partial<RewardWeights>): RewardWeights => (w ? { ...DEFAULT_WEIGHTS, ...w } : DEFAULT_WEIGHTS);

/** プレイヤー p の盤面の価値 */
function side(s: GameState, reg: Registry, p: PlayerId, w: EvalWeights): number {
  const c = mkCtx(s, reg);
  const z = s.players[p];
  let v = 0;
  for (const perm of z.battle) {
    const power = powerOf(c, perm);
    v += w.creature + power / w.powerDiv;
    if (hasKeyword(c, perm, 'blocker')) v += w.blocker;
    if (hasKeyword(c, perm, 'speedAttacker')) v += w.speedAttacker;
    v += Math.min(perm.cards.length - 1, 1) * w.stack;
  }
  v += z.shield.length * w.shield;
  v += z.hand.length * w.hand;
  v += Math.min(z.mana.length, 10) * w.mana;
  for (const u of z.hand) {
    const cost = charsLite(c, u, -1).cost;
    if (cost < 99) v += Math.min(cost, 8) * w.handCost;
  }
  // 山札が尽きそうなら不利
  if (z.deck.length < 4) v -= (4 - z.deck.length) * w.deckOut;
  return v;
}

/** me から見た評価。勝ちは +1000、負けは -1000 */
export function evaluate(s: GameState, reg: Registry, me: PlayerId, w: EvalWeights = DEFAULT_WEIGHTS): number {
  if (s.winner !== null) {
    if (s.winner === 'draw') return 0;
    return s.winner === me ? 1000 : -1000;
  }
  const other = (1 - me) as PlayerId;
  return side(s, reg, me, w) - side(s, reg, other, w);
}

/** 評価を 0〜1 の報酬に写す(勝敗は 1/0/0.5) */
export function reward(s: GameState, reg: Registry, me: PlayerId, w: RewardWeights = DEFAULT_WEIGHTS): number {
  if (s.winner !== null) {
    if (s.winner === 'draw') return 0.5;
    return s.winner === me ? 1 : 0;
  }
  if (w.model) return modelProb(w.model, s, reg, me);
  const e = evaluate(s, reg, me, w);
  return 0.5 + 0.5 * Math.tanh(e / w.scale);
}
