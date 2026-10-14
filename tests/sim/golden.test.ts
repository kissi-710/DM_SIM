// 回帰の固定値(ゴールデン): シードを固定した対戦・調査の結果を記録しておき、
// 高速化などの「挙動を変えない変更」で結果が1つも変わっていないことを確かめる。
// ルール・AI・カードを意図して変えた時だけ、この値を更新する。
import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../../src/cards';
import { makeAgent, type AgentSpec } from '../../src/ai';
import { loadRegistry } from '../../src/engine/registry';
import { runMatches } from '../../src/sim/batch';
import { playGameSync } from '../../src/sim/playGame';
import { runPatterns, runProbability } from '../../src/sim/solitaire';
import type { Goal } from '../../src/sim/goal';

const reg = loadRegistry(CARD_DB);
const A = deckCards('maruru');
const B = deckCards('zardy');

const hash = (s: string) => {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
};

const match = (a: AgentSpec, b: AgentSpec, games: number, seed: number) => {
  const r = runMatches(reg, { deckA: A, deckB: B, agentA: a, agentB: b, games, seed });
  return { winsA: r.winsA, winsB: r.winsB, draws: r.draws, avgTurns: r.avgTurns, reasons: r.reasons };
};

const goal: Goal = { op: 'pred', timing: { turn: 6, at: 'byTurn' }, pred: { kind: 'zoneHas', zone: 'battle', card: { names: ['ヨビニオン・マルル'] } } };

describe('ゴールデン(シード固定の結果が変わらない)', () => {
  it('バッチ対戦: ランダム同士 60試合', () => {
    expect(match({ kind: 'random' }, { kind: 'random' }, 60, 1)).toEqual({
      winsA: 37,
      winsB: 23,
      draws: 0,
      avgTurns: 24.133333333333333,
      reasons: { ダイレクトアタック: 41, 山札切れ: 19 },
    });
  });
  it('バッチ対戦: ルールベース同士 60試合', () => {
    expect(match({ kind: 'rule' }, { kind: 'rule' }, 60, 1)).toEqual({
      winsA: 47,
      winsB: 13,
      draws: 0,
      avgTurns: 12.116666666666667,
      reasons: { ダイレクトアタック: 60 },
    });
  });
  it('バッチ対戦: MCTS(20反復) 対 ルールベース 6試合', () => {
    expect(match({ kind: 'mcts', iterations: 20, ms: 100000 }, { kind: 'rule' }, 6, 1)).toEqual({
      winsA: 6,
      winsB: 0,
      draws: 0,
      avgTurns: 11.166666666666666,
      reasons: { ダイレクトアタック: 6 },
    });
  });
  it('1試合の全手順・最終状態(ルールベース / ランダム)', () => {
    const play = (kind: 'rule' | 'random', seed: number) => {
      const r = playGameSync(reg, [makeAgent({ kind }), makeAgent({ kind })], { decks: [A, B], seed });
      return [r.actions.length, hash(JSON.stringify(r.actions)), r.winner, r.turns, r.state.seq, r.state.rng, hash(JSON.stringify(r.state.cards))];
    };
    expect(play('rule', 5)).toEqual([70, 4240761097, 1, 14, 431, 1376401139, 1526906329]);
    expect(play('random', 9)).toEqual([139, 2008849440, 0, 34, 688, 1568224734, 3288983309]);
  });
  it('確率調査: 方針プレイと探索(40試行)', () => {
    const r = runProbability(reg, { deck: A, first: 0, goal, trials: 40, seed: 1, maxNodes: 3000 });
    expect(r.policy.achieved).toBe(13);
    expect(r.policy.byTurn).toEqual([0, 0, 0, 0.1, 0.175, 0.25, 0.325]);
    expect(r.search?.achieved).toBe(16);
    expect(r.search?.unknown).toBe(24);
    expect(r.search?.avgNodes).toBe(2000.275);
  });
  it('パターン調査(12試行)', () => {
    const r = runPatterns(reg, { deck: A, first: 0, goal, trials: 12, seed: 1, maxNodes: 3000 }, { granularity: 'set', maxHistoriesPerTrial: 2 });
    expect([r.patterns.length, r.achievedTrials, r.unknownTrials]).toEqual([6, 5, 7]);
    expect(hash(JSON.stringify(r.patterns.map((x) => [x.key, x.count, x.sampleSeed])))).toBe(2503898531);
  });
});
