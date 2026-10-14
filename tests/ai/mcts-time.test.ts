// MCTS の時間主導の探索: ms を最大の思考時間として使い、手の優劣がはっきりしたら早めに打ち切る。
import { describe, expect, it } from 'vitest';
import { makeMcts, pairedVerdict } from '../../src/ai/mcts';
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

describe('pairedVerdict(同じ世界での比較による判定)', () => {
  it('ラウンドが少ないうちは判定しない', () => {
    // 毎回 +0.4 の差でも、4ラウンドでは判断しない
    expect(pairedVerdict(4, 1.6, 0.64, 0)).toBe('open');
  });
  it('差が誤差より十分に大きければ ahead', () => {
    // 差の平均 0.2、ほぼ一定(20ラウンド)
    expect(pairedVerdict(20, 4, 0.9, 0)).toBe('ahead');
  });
  it('差が小さく、誤差が大きければ open', () => {
    // 差の平均 0.02、ばらつきが大きい(20ラウンド、分散およそ 0.1)
    expect(pairedVerdict(20, 0.4, 2, 0)).toBe('open');
  });
  it('差は無いが、十分なラウンドで精度が足りていれば precise(これ以上は区別できない)', () => {
    // 差の平均 0、各 4000 ラウンド(2.5σ が 1.2pt 未満)
    expect(pairedVerdict(4000, 0, 4000 * 0.005, 0)).toBe('precise');
  });
  it('事前の上乗せ(bonusGap)を加味する', () => {
    // 生の差は 0 だが、先頭に +0.2 → ahead
    expect(pairedVerdict(30, 0, 1.5, 0.2)).toBe('ahead');
  });
});

describe('makeMcts: ペア比較', () => {
  it('同じ入力なら同じ手(再現できる)', () => {
    const s = advanced(11, 14);
    const legal = legalActions(s, reg);
    const run = () => makeMcts({ iterations: 90 }).chooseAction(s, legal, ctx(5)) as Action;
    expect(run()).toEqual(run());
  });
  it('プレイアウトの回数が iterations を超えない', () => {
    const s = advanced(11, 14);
    const legal = legalActions(s, reg);
    const infos: Info[] = [];
    makeMcts({ iterations: 90, onSearch: (i) => infos.push(i) }).chooseAction(s, legal, ctx(5));
    expect(infos[0].iterations).toBeLessThanOrEqual(Math.max(90, legal.length));
    expect(infos[0].iterations).toBeGreaterThan(0);
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
    // 最大でも ms 程度(プレイアウト1回ぶんの超過は許容)。CPU の負荷が高い環境でも落ちないよう、余裕を大きく取る
    expect(i.ms).toBeLessThan(400 + 10000);
  }, 30000);
  it('iterations も指定すれば、それが上限になる(反復主導)', () => {
    const s = advanced(11, 14);
    const legal = legalActions(s, reg);
    const infos: Info[] = [];
    makeMcts({ iterations: 30, ms: 60000, onSearch: (i) => infos.push(i) }).chooseAction(s, legal, ctx(1));
    expect(infos[0].timeDriven).toBe(false);
    expect(infos[0].iterations).toBeLessThanOrEqual(Math.max(30, legal.length));
  }, 30000);
  it('どちらも未指定なら、再現できる既定(120反復・反復主導)', () => {
    const s = advanced(11, 14);
    const legal = legalActions(s, reg);
    const infos: Info[] = [];
    makeMcts({ onSearch: (i) => infos.push(i) }).chooseAction(s, legal, ctx(1));
    expect(infos[0].timeDriven).toBe(false);
    expect(infos[0].iterations).toBeLessThanOrEqual(Math.max(120, legal.length));
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
    const a = makeMcts({ ms: 5000, onSearch: (i) => infos.push(i) }).chooseAction(s, legal, ctx(2)) as Extract<Action, { type: 'ATTACK' }>;
    expect(a.type).toBe('ATTACK');
    expect(a.target.kind).toBe('player');
    // 時間(5000ms)を使い切らずに、優劣が決まって終わった(壁時計ではなく、探索が報告する値で見る)
    expect(infos[0].decided).toBe(true);
    expect(infos[0].ms).toBeLessThan(5000);
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

describe('iterations だけを指定した時は、時間で打ち切らない(再現できる)', () => {
  it('実行の速さ・負荷に関わらず、同じ反復数・同じ乱数なら同じ手と反復数', () => {
    const s = advanced(11, 14);
    const legal = legalActions(s, reg);
    const infos: Info[] = [];
    const ag = makeMcts({ iterations: 40, onSearch: (i) => infos.push(i) });
    const a = ag.chooseAction(s, legal, ctx(3));
    // 重い処理を挟んで時間をかけても、結果は変わらない
    const t0 = Date.now();
    while (Date.now() - t0 < 50) Math.sqrt(Math.random());
    const b = ag.chooseAction(s, legal, ctx(3));
    expect(a).toEqual(b);
    expect(infos[0].iterations).toBeLessThanOrEqual(Math.max(40, legal.length));
    expect(infos[1].iterations).toBe(infos[0].iterations);
  }, 30000);
});
