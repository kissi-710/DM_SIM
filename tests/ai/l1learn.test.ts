// 実験: 学習した線形の方針(ai/l1learn.ts)の部品
import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../../src/cards';
import { chooseConservative, chooseLearned, choosePlayLearned, features, n_features, situationOf } from '../../src/ai/l1learn';
import { makeRuleBased } from '../../src/ai/rulebased';
import playModel from '../../src/ai/models/play-v1.json';
import { chooseTurnAction } from '../../src/ai/rulebased';
import { createGame, legalActions, step } from '../../src/engine/engine';
import { mulberry } from '../../src/sim/playGame';
import { reg } from '../scenario';

const start = () => createGame(CARD_DB, { decks: [deckCards('maruru'), deckCards('zardy')], seed: 4, first: 0 }).state;

describe('学習した方針の部品', () => {
  it('特徴量は有限で、手の種類ごとに別のブロックに入る', () => {
    const s = start();
    const legal = legalActions(s, reg);
    const sit = situationOf(s, reg);
    const D = n_features(reg);
    const rows = legal.map((a) => {
      const x: number[] = [];
      features(s, reg, sit, a, x);
      return x;
    });
    for (const x of rows) {
      expect(x).toHaveLength(D);
      expect(x.every((v) => Number.isFinite(v))).toBe(true);
    }
    // 最初の局面はマナチャージ(と SKIP)。どれも何かの特徴量が立つ
    expect(rows.every((x) => x.some((v) => v !== 0))).toBe(true);
  });
  it('重みがゼロなら先頭の手、選んだ手は合法手の中にある。大きな差を求めると L1 の手のまま', () => {
    const s = start();
    const legal = legalActions(s, reg);
    const D = n_features(reg);
    const zero = { w: new Array(D).fill(0) };
    expect(chooseLearned(s, legal, reg, zero)).toEqual(legal[0]);
    const rand = mulberry(1);
    const l1 = chooseTurnAction(s, legal, { reg, rand });
    const noisy = { w: Array.from({ length: D }, (_, i) => Math.sin(i)) };
    expect(legal.some((a) => JSON.stringify(a) === JSON.stringify(chooseLearned(s, legal, reg, noisy)))).toBe(true);
    expect(chooseConservative(s, legal, reg, noisy, l1, 1e9)).toEqual(l1);
  });
  it('学習した方針で最後まで進められる(非合法手を選ばない)', () => {
    let s = start();
    const D = n_features(reg);
    const model = { w: Array.from({ length: D }, (_, i) => Math.cos(i * 1.7) * 0.1) };
    const rand = mulberry(3);
    for (let i = 0; i < 400 && s.winner === null; i++) {
      const legal = legalActions(s, reg);
      const a = s.pending!.why === 'turnAction' ? chooseLearned(s, legal, reg, model) : legal[Math.floor(rand() * legal.length)];
      s = step(s, a, reg).state;
    }
    expect(s.turn).toBeGreaterThan(2);
    });
  it('召喚だけを選ぶ方針: 召喚の手が無ければ -1、重みの長さが合わなければ使わない', () => {
    const s = start();
    const legal = legalActions(s, reg); // 最初はマナチャージ(召喚の手は無い)
    expect(choosePlayLearned(s, legal, reg, playModel.w)).toBe(-1);
    expect(choosePlayLearned(s, legal, reg, [1, 2, 3])).toBe(-1);
  });
  it('学習した召喚の方針を入れたルールベースで、最後まで進められ、選ぶ手は合法', () => {
    const agent = makeRuleBased({ params: { playModel: playModel.w } });
    let s = start();
    const rand = mulberry(7);
    for (let i = 0; i < 600 && s.winner === null; i++) {
      const legal = legalActions(s, reg);
      const a = agent.chooseAction(s, legal, { reg, rand }) as (typeof legal)[number];
      expect(legal.some((x) => JSON.stringify(x) === JSON.stringify(a))).toBe(true);
      s = step(s, a, reg).state;
    }
    expect(s.turn).toBeGreaterThan(4);
  });
});
