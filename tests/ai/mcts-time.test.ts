// MCTS の時間主導の探索: ms を最大の思考時間として使い、手の優劣がはっきりしたら早めに打ち切る。
import { describe, expect, it } from 'vitest';
import { isDecided, makeMcts } from '../../src/ai/mcts';
import { createGame, legalActions, step } from '../../src/engine/engine';
import { deckCards } from '../../src/cards';
import type { Action, GameState } from '../../src/engine/types';
import { mulberry } from '../../src/sim/playGame';
import { buildState, reg } from '../scenario';

type Info = { iterations: number; ms: number; timeDriven: boolean; decided: boolean; arms: number };

const advanced = (seed: number, moves: number): GameState => {
  let s = createGame(reg, { decks: [deckCards('maruru'), deckCards('zardy')], seed, first: 0 }).state;
  const rand = mulberry(seed);
  for (let i = 0; i < moves && s.winner === null; i++) {
    const l = legalActions(s, reg);
    s = step(s, l[Math.floor(rand() * l.length)], reg).state;
  }
  return s;
};
const ctx = (seed = 1) => ({ rand: mulberry(seed), reg });

describe('isDecided(早期終了の判定)', () => {
  it('比べる相手がいなければ決着', () => {
    expect(isDecided([30], [20], [14], [0])).toBe(true);
  });
  it('試行数が少ないうちは決着にしない', () => {
    // 平均 0.9 と 0.1 でも、2回ずつでは判断しない
    expect(isDecided([2, 2], [1.8, 0.2], [1.62, 0.02], [0, 0])).toBe(false);
  });
  it('差が誤差より十分に大きければ決着', () => {
    // 平均 0.8 と 0.4(各50回、分散はおよそ 0.02)
    expect(isDecided([50, 50], [40, 20], [32.5, 8.5], [0, 0])).toBe(true);
  });
  it('差が小さく、誤差が大きければ決着にしない', () => {
    // 平均 0.52 と 0.50(各25回、ばらつきが大きい)
    expect(isDecided([25, 25], [13, 12.5], [8, 7.5], [0, 0])).toBe(false);
  });
  it('差は小さいが、十分な試行で精度が足りていれば(これ以上は区別できない)決着', () => {
    // 平均が同じで、各 4000 回(誤差 2.5σ が 1.2pt 未満)
    expect(isDecided([4000, 4000], [2000, 2000], [1100, 1100], [0, 0])).toBe(true);
  });
  it('事前の上乗せ(bonus)を加味して順位を付ける', () => {
    // 生の平均は 0.50 と 0.52 だが、先頭の手に +0.2 → 先頭が明確に上
    expect(isDecided([60, 60], [30, 31.2], [15, 16], [0.2, 0])).toBe(true);
  });
});

describe('makeMcts: ms だけを指定した時は時間主導(反復の上限なし)', () => {
  it('既定の反復数(120)で止まらず、より多く反復できる', () => {
    const s = advanced(11, 14);
    const legal = legalActions(s, reg);
    expect(legal.length).toBeGreaterThan(1);
    const infos: Info[] = [];
    // 決着の早期終了が入らないよう、判定が難しい局面でも、上限は ms になる
    const ag = makeMcts({ ms: 400, onSearch: (i) => infos.push(i) });
    const a = ag.chooseAction(s, legal, ctx(1)) as Action;
    expect(legal).toContainEqual(a);
    const i = infos[0];
    expect(i.timeDriven).toBe(true);
    // 120 を超えて反復するか、早期終了(decided)した
    expect(i.iterations > 120 || i.decided).toBe(true);
    expect(i.ms).toBeLessThan(400 + 1500); // 最大でも ms 程度(プレイアウト1回ぶんの超過は許容)
  }, 30000);
  it('iterations も指定すれば、それが上限になる(反復主導。早期終了しない)', () => {
    const s = advanced(11, 14);
    const legal = legalActions(s, reg);
    const infos: Info[] = [];
    makeMcts({ iterations: 30, ms: 60000, onSearch: (i) => infos.push(i) }).chooseAction(s, legal, ctx(1));
    expect(infos[0].timeDriven).toBe(false);
    expect(infos[0].decided).toBe(false);
    expect(infos[0].iterations).toBe(Math.max(30, legal.length));
  }, 30000);
  it('どちらも未指定なら、再現できる既定(120反復・反復主導)', () => {
    const s = advanced(11, 14);
    const legal = legalActions(s, reg);
    const infos: Info[] = [];
    makeMcts({ onSearch: (i) => infos.push(i) }).chooseAction(s, legal, ctx(1));
    expect(infos[0].timeDriven).toBe(false);
    expect(infos[0].iterations).toBe(Math.max(120, legal.length));
  }, 60000);
  it('実行時の budget の ms だけを渡した場合も時間主導になる', () => {
    const s = advanced(11, 14);
    const legal = legalActions(s, reg);
    const infos: Info[] = [];
    makeMcts({ onSearch: (i) => infos.push(i) }).chooseAction(s, legal, { rand: mulberry(1), reg, budget: { ms: 150 } });
    expect(infos[0].timeDriven).toBe(true);
  }, 30000);
  it('勝ちが確定している局面では、時間を使い切らずに早く終わる', () => {
    const s = buildState({ p0: { battle: ['ヨビニオン・マルル'], hand: [] }, p1: { shield: 0 } });
    s.deckIds = [Array(40).fill('dummy'), Array(40).fill('dummy')];
    const legal = legalActions(s, reg);
    const infos: Info[] = [];
    const t0 = Date.now();
    const a = makeMcts({ ms: 5000, onSearch: (i) => infos.push(i) }).chooseAction(s, legal, ctx(2)) as Extract<Action, { type: 'ATTACK' }>;
    expect(a.type).toBe('ATTACK');
    expect(a.target.kind).toBe('player');
    expect(infos[0].decided).toBe(true);
    expect(Date.now() - t0).toBeLessThan(4000);
  }, 30000);
  it('時間主導でも、試合を合法手だけで最後まで完走できる', async () => {
    const { playGameSync } = await import('../../src/sim/playGame');
    const { randomAgent } = await import('../../src/ai/random');
    const r = playGameSync(reg, [makeMcts({ ms: 20, horizonTurns: 1 }), randomAgent], {
      decks: [deckCards('maruru'), deckCards('zardy')],
      seed: 14,
      first: 0,
    });
    expect(r.winner).not.toBeNull();
  }, 120000);
});
