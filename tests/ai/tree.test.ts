// ターン内の行動列を木にする探索(src/ai/tree.ts)のテスト。
import { describe, expect, it } from 'vitest';
import { makeAgent } from '../../src/ai';
import { canParallelize, decideParallel } from '../../src/ai/parallel';
import { planSearch } from '../../src/ai/mcts';
import { makeRuleBased } from '../../src/ai/rulebased';
import { bestFromStats, PairedTree, setNativePairedRound, setNativeTree, treeSearch } from '../../src/ai/tree';
import { deckCards } from '../../src/cards';
import { createGame, legalActions, step } from '../../src/engine/engine';
import { mulberry, playGameSync } from '../../src/sim/playGame';
import { reg } from '../scenario';

setNativeTree(null);
setNativePairedRound(null);

function someDecision() {
  let s = createGame(reg, { decks: [deckCards('maruru'), deckCards('zardy')], seed: 5, first: 0 }).state;
  const l1 = makeRuleBased({});
  const rand = mulberry(5);
  for (let i = 0; i < 40; i++) {
    const legal = legalActions(s, reg);
    if (s.turn >= 3 && legal.length >= 3 && s.pending?.why === 'turnAction') {
      return { s, legal, plan: planSearch(s, legal, { rand: mulberry(i), reg, budget: { iterations: 30 } }, {}, l1) };
    }
    s = step(s, legal[Math.floor(rand() * legal.length)], reg).state;
  }
  throw new Error('局面が見つかりません');
}

describe('ターン内の木の探索', () => {
  it('同じ引数なら同じ結果で、訪問回数の合計は反復回数以下', () => {
    const { plan } = someDecision();
    const a = treeSearch(plan.env, reg, plan.base, 30);
    const b = treeSearch(plan.env, reg, plan.base, 30);
    expect(a).toEqual(b);
    expect(a.visits.length).toBe(plan.env.legal.length);
    expect(a.visits.reduce((x, y) => x + y, 0)).toBeLessThanOrEqual(30);
    expect(a.visits.reduce((x, y) => x + y, 0)).toBeGreaterThan(0);
  });
  it('反復を増やすと、先頭の反復は共通(前の結果の続きになる)', () => {
    const { plan } = someDecision();
    const a = treeSearch(plan.env, reg, plan.base, 10);
    const b = treeSearch(plan.env, reg, plan.base, 25);
    a.visits.forEach((v, k) => expect(b.visits[k]).toBeGreaterThanOrEqual(v));
  });
  it('選ぶ手は合法手のどれか', () => {
    const { plan } = someDecision();
    const st = treeSearch(plan.env, reg, plan.base, 30);
    const i = bestFromStats(st, plan.baseIdx);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(plan.env.legal.length);
  });
  it('AI として1試合を最後まで進められる(反復指定は再現できる)', () => {
    const spec = { kind: 'mcts' as const, iterations: 15, tuning: { algo: 'tree' as const } };
    const play = () => playGameSync(reg, [makeAgent(spec), makeAgent({ kind: 'rule' })], { decks: [deckCards('maruru'), deckCards('zardy')], seed: 9, first: 0 });
    const r1 = play();
    const r2 = play();
    expect(r1.winner).not.toBeNull();
    expect(r2.actions).toEqual(r1.actions);
  }, 120000);

  it('ペア比較の木: 同じ種・同じ手順なら同じ報酬。alive でない手は NaN', () => {
    const { plan } = someDecision();
    const alive = plan.env.legal.map((_, k) => k);
    const run = () => {
      const tree = new PairedTree(plan.env, reg);
      return [tree.round(11, alive), tree.round(12, alive.slice(0, 2))];
    };
    const [a1, a2] = run();
    const [b1, b2] = run();
    expect(a1).toEqual(b1);
    expect(a2).toEqual(b2);
    a1.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
    a2.slice(2).forEach((v) => expect(Number.isNaN(v)).toBe(true));
  });
  it('ペア比較の木の AI として1試合を最後まで進められる', () => {
    const spec = { kind: 'mcts' as const, iterations: 20, tuning: { algo: 'ptree' as const } };
    const r = playGameSync(reg, [makeAgent(spec), makeAgent({ kind: 'rule' })], { decks: [deckCards('maruru'), deckCards('zardy')], seed: 4, first: 0 });
    expect(r.winner).not.toBeNull();
  }, 120000);

  it('ptree は並列の決定(Worker に木を保たせるラウンド評価)でも合法手を選ぶ。tree は並列にしない', async () => {
    const { s } = someDecision();
    const req = (algo: 'tree' | 'ptree') => ({ state: s, spec: { kind: 'mcts' as const, iterations: 40, tuning: { algo } }, seed: 3 });
    expect(canParallelize(reg, req('ptree'))).toBe(true);
    expect(canParallelize(reg, req('tree'))).toBe(false);
    let tree: PairedTree | null = null;
    const a = await decideParallel(reg, req('ptree'), {
      begin: (env) => {
        expect(env.tree).toBeDefined();
        tree = new PairedTree(env, reg, env.tree!);
      },
      dispatch: async (seeds, alive) => seeds.map((sd) => tree!.round(sd, alive)),
      parallelism: 2,
    });
    expect(legalActions(s, reg).some((x) => JSON.stringify(x) === JSON.stringify(a))).toBe(true);
  }, 120000);
});
