// 盤面の評価関数(AIの先読み・プレイアウトの打ち切りで使う)。
import { hasKeyword, powerOf, charsOf } from '../engine/derive';
import { mkCtx } from '../engine/state';
import type { Registry } from '../engine/registry';
import type { GameState, PlayerId } from '../engine/types';

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

export const DEFAULT_WEIGHTS: EvalWeights = {
  creature: 3,
  powerDiv: 2500,
  blocker: 1.5,
  speedAttacker: 0.5,
  stack: 0.5,
  shield: 4,
  hand: 1.6,
  mana: 1.1,
  handCost: 0.05,
  deckOut: 3,
  scale: 30,
};

export const withWeights = (w?: Partial<EvalWeights>): EvalWeights => (w ? { ...DEFAULT_WEIGHTS, ...w } : DEFAULT_WEIGHTS);

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
    const cost = charsOf(c, u, -1).cost;
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
export function reward(s: GameState, reg: Registry, me: PlayerId, w: EvalWeights = DEFAULT_WEIGHTS): number {
  if (s.winner !== null) {
    if (s.winner === 'draw') return 0.5;
    return s.winner === me ? 1 : 0;
  }
  const e = evaluate(s, reg, me, w);
  return 0.5 + 0.5 * Math.tanh(e / w.scale);
}
