// 学習した価値関数(docs/ai-quality-plan.md §4.2)。盤面 → 「自分が勝つ確率」。
// 特徴量(プレイヤーごと)の差の線形和 + 手番 + カードごとの価値、をロジスティック関数に通す。
// 手作りの評価(eval.ts)の代わりに、プレイアウトの打ち切りの報酬として使う。
// 特徴量の計算は rust/src/ai.rs(side_features / model_score)と同じ式にする(差分テストで固定)。
import { breakerCount, canBlock, charsOf, hasKeyword, isSick, powerOf } from '../engine/derive';
import { mkCtx } from '../engine/state';
import type { Registry } from '../engine/registry';
import type { GameState, PlayerId } from '../engine/types';

/** プレイヤーごとの基本の特徴量(並びは固定。モデルは名前で重みを持つ) */
export const BASE_FEATURES = [
  'creatures', // バトルゾーンのクリーチャーの数
  'power', // パワー(各 15000 まで)の合計 ÷ 1000
  'blockersUp', // ブロックできる(アンタップのブロッカー)数
  'blockersAll', // ブロッカーの数
  'speedAttackers',
  'stacked', // 進化などで重なっているもの
  'tapped',
  'sick', // 召喚酔い
  'breakers', // ブレイク数の合計
  'shields',
  'shieldLow', // max(0, 3 − シールド)
  'hand',
  'handCost', // 手札のコスト(各 8 まで)の合計
  'handPlayable', // 今のマナで払える枚数(コスト ≤ マナの枚数)
  'mana1', // min(マナ, 4)
  'mana2', // min(max(マナ − 4, 0), 3)
  'mana3', // min(max(マナ − 7, 0), 3)
  'manaCivs', // マナにある文明の種類数
  'grave', // 墓地(10 枚まで)
  'deckLow', // max(0, 4 − 山札)
] as const;
export type BaseFeature = (typeof BASE_FEATURES)[number];
export const N_BASE = BASE_FEATURES.length;

/** 価値関数の重み。カードごとの重みは defId をキーにする(無いカードは 0) */
export interface ValueModel {
  v: 1;
  /** 基本の特徴量の重み(差 = 自分 − 相手 にかける) */
  base: Partial<Record<BaseFeature, number>>;
  /** 手番(自分の番なら +1、相手の番なら −1)にかける重み */
  tempo: number;
  /** バトルゾーンのカード1枚あたり(自分の枚数 − 相手の枚数) */
  battle: Record<string, number>;
  /** 手札のカード1枚あたり */
  hand: Record<string, number>;
}

/** プレイヤー p の基本の特徴量を out に書き、カードごとの枚数を battle・hand に足す(± sign) */
export function sideFeatures(s: GameState, reg: Registry, p: PlayerId, out: Float64Array, battle?: Map<string, number>, hand?: Map<string, number>, sign = 1): void {
  const c = mkCtx(s, reg);
  const z = s.players[p];
  const f = (i: number, v: number) => (out[i] += sign * v);
  let blockersUp = 0;
  let blockersAll = 0;
  let sa = 0;
  let stacked = 0;
  let tapped = 0;
  let sick = 0;
  let breakers = 0;
  let power = 0;
  for (const perm of z.battle) {
    power += Math.min(powerOf(c, perm), 15000) / 1000;
    if (canBlock(c, perm)) blockersUp++;
    if (hasKeyword(c, perm, 'blocker')) blockersAll++;
    if (hasKeyword(c, perm, 'speedAttacker')) sa++;
    if (perm.cards.length > 1) stacked++;
    if (perm.tapped) tapped++;
    if (isSick(c, perm)) sick++;
    breakers += breakerCount(c, perm);
    if (battle) {
      const d = s.cards[perm.cards[0]].defId;
      battle.set(d, (battle.get(d) ?? 0) + sign);
    }
  }
  const manaN = z.mana.length;
  let handCost = 0;
  let playable = 0;
  for (const u of z.hand) {
    const cost = charsOf(c, u, -1).cost;
    if (cost < 99) {
      handCost += Math.min(cost, 8);
      if (cost <= manaN) playable++;
    }
    if (hand) {
      const d = s.cards[u].defId;
      hand.set(d, (hand.get(d) ?? 0) + sign);
    }
  }
  const civs = new Set<string>();
  for (const m of z.mana) for (const cv of charsOf(c, m, -1).civs) civs.add(cv);
  f(0, z.battle.length);
  f(1, power);
  f(2, blockersUp);
  f(3, blockersAll);
  f(4, sa);
  f(5, stacked);
  f(6, tapped);
  f(7, sick);
  f(8, breakers);
  f(9, z.shield.length);
  f(10, Math.max(0, 3 - z.shield.length));
  f(11, z.hand.length);
  f(12, handCost);
  f(13, playable);
  f(14, Math.min(manaN, 4));
  f(15, Math.min(Math.max(manaN - 4, 0), 3));
  f(16, Math.min(Math.max(manaN - 7, 0), 3));
  f(17, civs.size);
  f(18, Math.min(z.grave.length, 10));
  f(19, Math.max(0, 4 - z.deck.length));
}

/** me から見た線形和 z(ロジスティック関数に入れる前の値) */
export function modelLogit(m: ValueModel, s: GameState, reg: Registry, me: PlayerId): number {
  const f = new Float64Array(N_BASE);
  const battle = new Map<string, number>();
  const hand = new Map<string, number>();
  sideFeatures(s, reg, me, f, battle, hand, 1);
  sideFeatures(s, reg, (1 - me) as PlayerId, f, battle, hand, -1);
  let z = s.active === me ? m.tempo : -m.tempo;
  for (let i = 0; i < N_BASE; i++) z += (m.base[BASE_FEATURES[i]] ?? 0) * f[i];
  for (const [d, n] of battle) z += (m.battle[d] ?? 0) * n;
  for (const [d, n] of hand) z += (m.hand[d] ?? 0) * n;
  return z;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** me が勝つ確率の見積もり(決着していない盤面) */
export function modelProb(m: ValueModel, s: GameState, reg: Registry, me: PlayerId): number {
  return sigmoid(modelLogit(m, s, reg, me));
}
