// ジョブの分割・統合: 分割して実行した結果を統合すると、直列実行と一致する(並列実行の正しさの根拠)。
import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../../src/cards';
import { loadRegistry } from '../../src/engine/registry';
import type { MatchStats } from '../../src/sim/batch';
import type { Goal } from '../../src/sim/goal';
import { planJob, runJob, splitCounts, type JobResult, type SimJob } from '../../src/sim/jobs';
import type { PatternResult, ProbResult } from '../../src/sim/solitaire';
import type { CardStrength } from '../../src/sim/strength';

const reg = loadRegistry(CARD_DB);
const A = deckCards('maruru');
const B = deckCards('zardy');
const goal: Goal = { op: 'pred', timing: { turn: 5, at: 'byTurn' }, pred: { kind: 'zoneHas', zone: 'battle', card: { names: ['ヨビニオン・マルル'] } } };

/** チャンクを順に実行して統合する(Worker の代わりに同じプロセスで) */
function viaPlan(job: SimJob, parts: number): JobResult {
  const plan = planJob(reg, job, parts);
  expect(plan.chunks.length).toBe(plan.units.length);
  return plan.merge(plan.chunks.map((c) => runJob(reg, c)));
}
const noMs = <T extends { ms: number }>(x: T): T => ({ ...x, ms: 0 });

describe('splitCounts', () => {
  it('合計が保たれ、各片は1以上', () => {
    for (const total of [1, 2, 5, 17, 100]) {
      for (const parts of [1, 2, 3, 8, 50]) {
        const s = splitCounts(total, parts);
        expect(s.reduce((a, b) => a + b, 0)).toBe(total);
        expect(s.every((n) => n >= 1)).toBe(true);
        expect(s.length).toBeLessThanOrEqual(parts);
      }
    }
  });
  it('even: 最後以外は偶数(先攻後攻の交互の位相が保たれる)', () => {
    for (const total of [1, 7, 10, 33, 100]) {
      for (const parts of [1, 2, 3, 7, 40]) {
        const s = splitCounts(total, parts, true);
        expect(s.reduce((a, b) => a + b, 0)).toBe(total);
        for (const n of s.slice(0, -1)) expect(n % 2).toBe(0);
      }
    }
  });
  it('0以下なら空', () => {
    expect(splitCounts(0, 4)).toEqual([]);
  });
});

describe('分割して実行 → 統合 = 直列実行', () => {
  it('batch: 先攻後攻が交互・複数設定・奇数試合でも一致する', () => {
    const job: SimJob = {
      type: 'batch',
      opts: [
        { deckA: A, deckB: B, agentA: { kind: 'rule' }, agentB: { kind: 'random' }, games: 23, seed: 3, first: 'alternate' },
        { deckA: B, deckB: A, agentA: { kind: 'random' }, agentB: { kind: 'random' }, games: 14, seed: 100, first: 'random' },
        { deckA: A, deckB: B, agentA: { kind: 'rule' }, agentB: { kind: 'rule' }, games: 9, seed: 7, first: 'fixed' },
      ],
    };
    const serial = runJob(reg, job) as MatchStats[];
    for (const parts of [2, 5, 12]) {
      const merged = viaPlan(job, parts) as MatchStats[];
      expect(merged.map(noMs)).toEqual(serial.map(noMs));
    }
  });
  it('prob: 方針プレイ + 探索', () => {
    const job: SimJob = { type: 'prob', params: { deck: A, first: 0, goal, trials: 25, seed: 11, maxNodes: 600 } };
    const serial = runJob(reg, job) as ProbResult;
    for (const parts of [2, 4, 9]) {
      expect(noMs(viaPlan(job, parts) as ProbResult)).toEqual(noMs(serial));
    }
  });
  it('prob: 探索なし・後攻', () => {
    const job: SimJob = { type: 'prob', params: { deck: A, first: 1, goal, trials: 31, seed: 2 } };
    expect(noMs(viaPlan(job, 6) as ProbResult)).toEqual(noMs(runJob(reg, job) as ProbResult));
  });
  it('patterns: パターンの件数・代表例・初手の頻度まで一致する', () => {
    const job: SimJob = {
      type: 'patterns',
      params: { deck: A, first: 0, goal, trials: 14, seed: 5, maxNodes: 1500 },
      opts: { granularity: 'set', maxHistoriesPerTrial: 3 },
    };
    const serial = runJob(reg, job) as PatternResult;
    expect(serial.patterns.length).toBeGreaterThan(0);
    for (const parts of [2, 3, 7]) {
      expect(noMs(viaPlan(job, parts) as PatternResult)).toEqual(noMs(serial));
    }
  });
  it('strength: 基準とカードごとの変種を別々に実行しても同じ', () => {
    const deck = A.slice(0, 12).concat(Array(28).fill('dummy'));
    const job: SimJob = { type: 'strength', deck, opponent: B, agent: { kind: 'random' }, games: 6, seed: 1 };
    const serial = runJob(reg, job) as CardStrength[];
    expect(viaPlan(job, 4)).toEqual(serial);
  });
  it('チャンクには元の試行の通し番号の範囲が割り当てられる(重複・欠落がない)。シードは実行のシードのまま', () => {
    const job: SimJob = { type: 'prob', params: { deck: A, first: 0, goal, trials: 10, seed: 100 } };
    const plan = planJob(reg, job, 3);
    const seen: number[] = [];
    for (const c of plan.chunks) {
      if (c.type !== 'prob') throw new Error();
      expect(c.params.seed).toBe(100);
      for (let i = 0; i < c.params.trials; i++) seen.push((c.params.startIndex ?? 0) + i);
    }
    expect(seen).toEqual(Array.from({ length: 10 }, (_, i) => i));
  });
  it('試合(バッチ)の分割も、通し番号の範囲で、シードは実行のシードのまま(複製対局は偶数の開始位置)', () => {
    for (const first of ['alternate', 'duplicate'] as const) {
      const job: SimJob = { type: 'batch', opts: [{ deckA: A, deckB: B, agentA: { kind: 'random' }, agentB: { kind: 'random' }, games: 12, seed: 7, first }] };
      const plan = planJob(reg, job, 4);
      const seen: number[] = [];
      for (const c of plan.chunks) {
        if (c.type !== 'batch') throw new Error();
        const o = c.opts[0];
        expect(o.seed).toBe(7);
        if (first === 'duplicate') expect((o.startIndex ?? 0) % 2).toBe(0);
        for (let i = 0; i < o.games; i++) seen.push((o.startIndex ?? 0) + i);
      }
      expect(seen.sort((x, y) => x - y)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    }
  });
  it('進捗は単位数(試合数・試行数)で報告される', () => {
    const job: SimJob = { type: 'batch', opts: [{ deckA: A, deckB: B, agentA: { kind: 'random' }, agentB: { kind: 'random' }, games: 6, seed: 1 }] };
    const calls: [number, number][] = [];
    runJob(reg, job, (d, t) => calls.push([d, t]));
    expect(calls.at(-1)).toEqual([6, 6]);
  });
});
