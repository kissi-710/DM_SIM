import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../src/cards';
import { loadRegistry } from '../src/engine/registry';
import { type Goal, GOAL_PRESETS, describeGoal } from '../src/sim/goal';
import {
  arrangeDeck,
  buildGame,
  replayPattern,
  runPatterns,
  runPolicyTrial,
  runProbability,
  searchTrial,
  type SolitaireParams,
} from '../src/sim/solitaire';
import { hypergeomAtLeast, hypergeomPmf, wilson } from '../src/sim/stats';

const reg = loadRegistry(CARD_DB);

const handHas = (name: string, min = 1): Goal => ({
  op: 'pred',
  timing: { turn: 1, at: 'opening' },
  pred: { kind: 'zoneHas', zone: 'hand', card: { names: [name] }, min },
});

describe('統計', () => {
  it('超幾何分布: 全確率の和が1', () => {
    let t = 0;
    for (let k = 0; k <= 5; k++) t += hypergeomPmf(40, 4, 5, k);
    expect(t).toBeCloseTo(1, 10);
  });
  it('超幾何分布: 40枚中4枚、5枚引いて1枚以上 = 1 - C(36,5)/C(40,5)', () => {
    const exact = 1 - (36 * 35 * 34 * 33 * 32) / (40 * 39 * 38 * 37 * 36);
    expect(hypergeomAtLeast(40, 4, 5, 1)).toBeCloseTo(exact, 10);
  });
  it('Wilson区間は推定値を含む', () => {
    const [lo, hi] = wilson(30, 100);
    expect(lo).toBeLessThan(0.3);
    expect(hi).toBeGreaterThan(0.3);
  });
});

describe('初期条件(spec 6.2)', () => {
  it('初手に必ず含める / 含めない', () => {
    const deck = deckCards('maruru');
    for (let i = 0; i < 30; i++) {
      const o = arrangeDeck(reg, deck, i, { mustHand: ['ジ・ウォッチ'], mustNotHand: ['天災 デドダム'] });
      const hand = o.slice(5, 10);
      expect(hand).toContain('dm24rp2-TR03');
      expect(hand).not.toContain('dm23bd1-014');
      expect(o.length).toBe(40);
    }
  });
  it('山札の上を固定できる', () => {
    const o = arrangeDeck(reg, deckCards('maruru'), 3, { topFixed: ['九番龍 ジゴクバンカー'] });
    expect(o[10]).toBe('dm24rp3-008');
  });
  it('並びは、シールド5・手札5が山札の先頭から取られる', () => {
    const s = buildGame(reg, { deck: deckCards('maruru'), first: 0, goal: handHas('天災 デドダム'), trials: 1, seed: 1 }, 7);
    expect(s.players[0].shield.length).toBe(5);
    expect(s.players[0].hand.length).toBe(5);
    expect(s.cfg.solitaire).toBe(true);
  });
});

describe('確率調査(spec 6.4)', () => {
  it('初手にデドダムがある確率は、超幾何分布の厳密値と一致する', () => {
    const p: SolitaireParams = { deck: deckCards('maruru'), first: 0, goal: handHas('天災 デドダム'), trials: 3000, seed: 10 };
    const r = runProbability(CARD_DB, p);
    const exact = hypergeomAtLeast(40, 4, 5, 1);
    expect(r.exact?.value).toBeCloseTo(exact, 10);
    expect(r.policy.ci95[0]).toBeLessThanOrEqual(exact);
    expect(r.policy.ci95[1]).toBeGreaterThanOrEqual(exact);
  });
  it('マナチャージも使用もしない方針なら、Nターン目までに引く確率が厳密値と一致する', () => {
    const goal: Goal = {
      op: 'pred',
      timing: { turn: 4, at: 'byTurn' },
      pred: { kind: 'zoneHas', zone: 'hand', card: { names: ['九番龍 ジゴクバンカー'] }, min: 1 },
    };
    // ジゴクバンカーは1枚。先攻4ターン目までに 5+3 = 8枚
    const p: SolitaireParams = { deck: deckCards('maruru'), first: 0, goal, trials: 4000, seed: 77, agent: { kind: 'pass' } };
    const r = runProbability(CARD_DB, p);
    const exact = hypergeomAtLeast(40, 1, 8, 1);
    expect(exact).toBeCloseTo(8 / 40, 10);
    expect(r.exact?.value).toBeCloseTo(exact, 10);
    expect(r.policy.ci95[0]).toBeLessThanOrEqual(exact);
    expect(r.policy.ci95[1]).toBeGreaterThanOrEqual(exact);
  });
  it('後攻は先攻より1枚多く引く', () => {
    const goal: Goal = {
      op: 'pred',
      timing: { turn: 4, at: 'byTurn' },
      pred: { kind: 'zoneHas', zone: 'hand', card: { names: ['九番龍 ジゴクバンカー'] }, min: 1 },
    };
    const p: SolitaireParams = { deck: deckCards('maruru'), first: 1, goal, trials: 1, seed: 1 };
    expect(runProbability(CARD_DB, p).exact?.value).toBeCloseTo(9 / 40, 10);
  });
  it('「3ターン目までにマナが5枚以上」: 方針プレイとの比較。探索の上限は方針プレイ以上', () => {
    const goal = GOAL_PRESETS.find((g) => g.id === 'mana5-t3')!.goal;
    const p: SolitaireParams = { deck: deckCards('maruru'), first: 0, goal, trials: 60, seed: 5, maxNodes: 6000 };
    const r = runProbability(CARD_DB, p);
    expect(r.search).toBeDefined();
    // 各試行で、方針プレイが達成できたなら探索も見つける(探索は上限)
    for (let i = 0; i < 20; i++) {
      const run = runPolicyTrial(reg, p, p.seed + i);
      const sr = searchTrial(reg, p, p.seed + i, 1);
      if (run.achievedTurn !== null && !sr.unknown) expect(sr.found).toBe(true);
    }
    expect(r.search!.rate + 1e-9).toBeGreaterThanOrEqual(r.policy.rate - 0.08);
  });
  it('「4ターン目にコスト7のカードを使える」が計算できる(確率・達成ターンの分布)', () => {
    const goal = GOAL_PRESETS.find((g) => g.id === 'cost7-t4')!.goal;
    const p: SolitaireParams = { deck: deckCards('maruru'), first: 0, goal, trials: 40, seed: 21, maxNodes: 3000 };
    const r = runProbability(CARD_DB, p);
    expect(r.maxTurns).toBe(4);
    expect(r.policy.byTurn.length).toBe(5);
    expect(r.policy.rate).toBeGreaterThanOrEqual(0);
    expect(r.policy.rate).toBeLessThanOrEqual(1);
    // 累積は単調増加
    for (let t = 1; t < r.policy.byTurn.length; t++) expect(r.policy.byTurn[t]).toBeGreaterThanOrEqual(r.policy.byTurn[t - 1]);
    expect(describeGoal(goal)).toContain('コスト7');
  });
  it('同じシードなら同じ結果(再現性)', () => {
    const goal = GOAL_PRESETS.find((g) => g.id === 'mana5-t3')!.goal;
    const p: SolitaireParams = { deck: deckCards('zardy'), first: 0, goal, trials: 25, seed: 9 };
    const a = runProbability(CARD_DB, p);
    const b = runProbability(CARD_DB, p);
    expect({ ...a, ms: 0 }).toEqual({ ...b, ms: 0 });
  });
});

describe('パターン調査(spec 6.5)', () => {
  const goal: Goal = {
    op: 'pred',
    timing: { turn: 3, at: 'byTurn' },
    pred: { kind: 'manaCount', min: 5 },
  };
  it('目標を達成する使用履歴をまとめ、出現割合を出す', () => {
    const p: SolitaireParams = { deck: deckCards('maruru'), first: 0, goal, trials: 20, seed: 3, maxNodes: 5000 };
    const r = runPatterns(CARD_DB, p, { granularity: 'ordered', maxHistoriesPerTrial: 10 });
    expect(r.trials).toBe(20);
    expect(r.achievedTrials).toBeGreaterThan(0);
    expect(r.patterns.length).toBeGreaterThan(0);
    const top = r.patterns[0];
    expect(top.count).toBeGreaterThanOrEqual(r.patterns[r.patterns.length - 1].count);
    expect(top.ratioAll).toBeLessThanOrEqual(1);
    expect(top.turns.length).toBeGreaterThan(0);
    expect(Object.keys(top.handFreq).length).toBeGreaterThan(0);
  });
  it('粗くすると(使用カードの集合のみ)パターン数が減る', () => {
    const p: SolitaireParams = { deck: deckCards('maruru'), first: 0, goal, trials: 15, seed: 3, maxNodes: 5000 };
    const fine = runPatterns(CARD_DB, p, { granularity: 'ordered', maxHistoriesPerTrial: 12 });
    const coarse = runPatterns(CARD_DB, p, { granularity: 'cards', maxHistoriesPerTrial: 12 });
    expect(coarse.patterns.length).toBeLessThanOrEqual(fine.patterns.length);
  });
  it('履歴を再生すると、目標の状態に到達する', () => {
    const p: SolitaireParams = { deck: deckCards('maruru'), first: 0, goal, trials: 10, seed: 4, maxNodes: 5000 };
    const r = runPatterns(CARD_DB, p, { maxHistoriesPerTrial: 3 });
    const pat = r.patterns[0];
    const states = replayPattern(CARD_DB, p, pat.sampleSeed, pat.sampleActions);
    expect(states.length).toBe(pat.sampleActions.length + 1);
    // どこかの時点で、マナが5枚以上
    expect(states.some((s) => s.players[0].mana.length >= 5)).toBe(true);
  });
});
