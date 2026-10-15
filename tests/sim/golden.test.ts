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
      winsA: 31,
      winsB: 29,
      draws: 0,
      avgTurns: 23.266666666666666,
      reasons: { ダイレクトアタック: 45, 山札切れ: 15 },
    });
  });
  it('バッチ対戦: ルールベース同士 60試合', () => {
    expect(match({ kind: 'rule' }, { kind: 'rule' }, 60, 1)).toEqual({
      winsA: 47, // ワクムテラスのパワーを公式の 4000 に訂正(旧 3000)して、1試合変わった
      winsB: 13,
      draws: 0,
      avgTurns: 11.816666666666666,
      reasons: { ダイレクトアタック: 60 },
    });
  });
  // 探索の既定を、根はペア比較・2手目以降は木(ptree。docs/ai-quality-plan.md §6.4)にした時と、
  // 報酬を軌跡平均(traj=1。§8)にした時に更新した固定値
  it('バッチ対戦: MCTS(20反復) 対 ルールベース 6試合', () => {
    expect(match({ kind: 'mcts', iterations: 20, ms: 100000 }, { kind: 'rule' }, 6, 1)).toEqual({
      winsA: 5,
      winsB: 1,
      draws: 0,
      avgTurns: 13,
      reasons: { ダイレクトアタック: 6 },
    });
  });
  it('1試合の全手順・最終状態(ルールベース / ランダム)', () => {
    const play = (kind: 'rule' | 'random', seed: number) => {
      const r = playGameSync(reg, [makeAgent({ kind }), makeAgent({ kind })], { decks: [A, B], seed });
      return [r.actions.length, hash(JSON.stringify(r.actions)), r.winner, r.turns, r.state.seq, r.state.rng, hash(JSON.stringify(r.state.cards))];
    };
    expect(play('rule', 5)).toEqual([51, 3895777216, 0, 11, 297, -1527012423, 257919613]);
    expect(play('random', 9)).toEqual([96, 1152920333, 0, 25, 470, 1504283537, 3871052353]);
  });
  it('確率調査: 方針プレイと探索(40試行)', () => {
    const r = runProbability(reg, { deck: A, first: 0, goal, trials: 40, seed: 1, maxNodes: 3000 });
    expect(r.policy.achieved).toBe(13);
    expect(r.policy.byTurn).toEqual([0, 0, 0, 0.075, 0.25, 0.3, 0.325]);
    // 限定食い違い探索 + 目標までの距離の順序づけ(旧: 到達 16 / 不明 24 / 平均 2000 ノード)。
    // 予算の 2/3 を LDS に、残りを 1 回の全探索に使う(到達不可の確定を速くする。到達 32 / 不明 8 → 31 / 9)
    expect(r.search?.achieved).toBe(31);
    expect(r.search?.unknown).toBe(9);
    expect(r.search?.avgNodes).toBe(855.15);
  });
  it('パターン調査(12試行)', () => {
    const r = runPatterns(reg, { deck: A, first: 0, goal, trials: 12, seed: 1, maxNodes: 3000 }, { granularity: 'set', maxHistoriesPerTrial: 2 });
    // 旧: パターン 6 / 達成 5 / 不明 7
    expect([r.patterns.length, r.achievedTrials, r.unknownTrials]).toEqual([17, 11, 1]);
    expect(hash(JSON.stringify(r.patterns.map((x) => [x.key, x.count, x.sampleSeed])))).toBe(2396495186);
  });
});
