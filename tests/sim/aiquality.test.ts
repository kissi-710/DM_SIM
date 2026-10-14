// AI の質の測定の道具(docs/ai-quality-plan.md §3)のテスト。
import { describe, expect, it } from 'vitest';
import { parseSpec, specLabel } from '../../src/ai/specString';
import { CARD_DB, deckCards } from '../../src/cards';
import { loadRegistry } from '../../src/engine/registry';
import { collectPositions, judgeAgent, summarize, teacherValues } from '../../src/sim/aiEval';
import { runMatches } from '../../src/sim/batch';
import { mergeMatches, planJob, runJob } from '../../src/sim/jobs';

const reg = loadRegistry(CARD_DB);
const A = deckCards('maruru');
const B = deckCards('zardy');

describe('設定文字列', () => {
  it('種類とキー=値を読む', () => {
    const s = parseSpec('mcts:iter=120,horizon=99,prior=0.01,w.mana=2.5');
    expect(s).toEqual({ kind: 'mcts', iterations: 120, tuning: { horizonTurns: 99, priorBonus: 0.01, weights: { mana: 2.5 } } });
    expect(specLabel(s)).toBe('mcts:iter=120,horizon=99,prior=0.01,w.mana=2.5');
    expect(parseSpec('rule')).toEqual({ kind: 'rule' });
  });
  it('不正な設定は止める', () => {
    expect(() => parseSpec('foo')).toThrow();
    expect(() => parseSpec('mcts:iter=abc')).toThrow();
    expect(() => parseSpec('mcts:bogus=1')).toThrow();
  });
});

describe('複製対局(duplicate)', () => {
  it('同じシードで席を入れ替える: 同じデッキ同士なら、同じ AI 同士の勝敗は A と B で対称になる', () => {
    const r = runMatches(reg, { deckA: A, deckB: A, agentA: { kind: 'rule' }, agentB: { kind: 'rule' }, games: 10, seed: 5, first: 'duplicate' });
    // 同じ AI・同じデッキ・同じ手札: 席を入れ替えても、同じ席(先攻/後攻)が勝つ
    expect(r.winsA).toBe(5);
    expect(r.winsB).toBe(5);
  });
  it('分割しても、直列と同じ結果になる(シードの進みは半分)', () => {
    const opts = { deckA: A, deckB: B, agentA: { kind: 'rule' as const }, agentB: { kind: 'random' as const }, games: 18, seed: 3, first: 'duplicate' as const };
    const serial = runMatches(reg, opts);
    const plan = planJob(reg, { type: 'batch', opts: [opts] }, 4);
    expect(plan.chunks.length).toBeGreaterThan(1);
    const merged = mergeMatches(plan.chunks.flatMap((c) => runJob(reg, c) as ReturnType<typeof runMatches>[]));
    expect([merged.winsA, merged.winsB, merged.draws]).toEqual([serial.winsA, serial.winsB, serial.draws]);
  });
  it('timing を付けると思考時間が数えられる', () => {
    const r = runMatches(reg, { deckA: A, deckB: B, agentA: { kind: 'mcts', iterations: 20 }, agentB: { kind: 'rule' }, games: 2, seed: 1, timing: true });
    expect(r.think!.nA).toBeGreaterThan(0);
    expect(r.think!.nB).toBeGreaterThan(0);
  });
});

describe('局面・教師・判定', () => {
  const pairs = [{ id: 'm/z', a: A, b: B }];
  it('局面の集合は引数が同じなら同じ', () => {
    const p1 = collectPositions(reg, pairs, 8, 1);
    const p2 = collectPositions(reg, pairs, 8, 1);
    expect(p1.length).toBe(8);
    expect(p1.map((p) => [p.turn, p.state.rng])).toEqual(p2.map((p) => [p.turn, p.state.rng]));
  });
  it('教師の値と判定: 教師の最善手を選べば損失 0', () => {
    const [pos] = collectPositions(reg, pairs, 1, 2);
    const t = teacherValues(reg, pos, { rounds: 8, horizon: 3, seed: 1 });
    expect(t.legal.length).toBeGreaterThan(1);
    expect(t.means.length).toBe(t.legal.length);
    const j = judgeAgent(reg, pos, t, { kind: 'rule' }, 1);
    expect(j.regret).toBeGreaterThanOrEqual(0);
    expect(j.arms).toBe(t.legal.length);
    const sm = summarize([j, { ...j, regret: 0, agree: true }]);
    expect(sm.n).toBe(2);
    expect(sm.regret).toBeCloseTo(j.regret / 2, 12);
  });
});
