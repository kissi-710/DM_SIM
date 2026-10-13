// 盤面の評価関数(AIの先読み・プレイアウトの打ち切りで使う)。
import { hasKeyword, powerOf, charsOf } from '../engine/derive';
import { mkCtx } from '../engine/state';
import type { Registry } from '../engine/registry';
import type { GameState, PlayerId } from '../engine/types';

/** プレイヤー p の盤面の価値 */
function side(s: GameState, reg: Registry, p: PlayerId): number {
  const c = mkCtx(s, reg);
  const z = s.players[p];
  let v = 0;
  for (const perm of z.battle) {
    const power = powerOf(c, perm);
    v += 3 + power / 2500;
    if (hasKeyword(c, perm, 'blocker')) v += 1.5;
    if (hasKeyword(c, perm, 'speedAttacker')) v += 0.5;
    v += Math.min(perm.cards.length - 1, 1) * 0.5;
  }
  v += z.shield.length * 4;
  v += z.hand.length * 1.6;
  v += Math.min(z.mana.length, 10) * 1.1;
  for (const u of z.hand) {
    const cost = charsOf(c, u, -1).cost;
    if (cost < 99) v += Math.min(cost, 8) * 0.05;
  }
  // 山札が尽きそうなら不利
  if (z.deck.length < 4) v -= (4 - z.deck.length) * 3;
  return v;
}

/** me から見た評価。勝ちは +1000、負けは -1000 */
export function evaluate(s: GameState, reg: Registry, me: PlayerId): number {
  if (s.winner !== null) {
    if (s.winner === 'draw') return 0;
    return s.winner === me ? 1000 : -1000;
  }
  const other = (1 - me) as PlayerId;
  return side(s, reg, me) - side(s, reg, other);
}

/** 評価を 0〜1 の報酬に写す(勝敗は 1/0/0.5) */
export function reward(s: GameState, reg: Registry, me: PlayerId): number {
  if (s.winner !== null) {
    if (s.winner === 'draw') return 0.5;
    return s.winner === me ? 1 : 0;
  }
  const e = evaluate(s, reg, me);
  return 0.5 + 0.5 * Math.tanh(e / 30);
}
