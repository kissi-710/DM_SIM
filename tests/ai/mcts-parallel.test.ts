// MCTS の並列化: 先のラウンドを投機的に評価して順に反映するので、並列数・分け方によらず、逐次の探索と同じ結果になる。
import { describe, expect, it } from 'vitest';
import { evalRound, planSearch, roundSeed, runSearch, runSearchParallel, type RoundDispatch, type SearchInfo } from '../../src/ai/mcts';
import { makeRuleBased } from '../../src/ai/rulebased';
import { createGame, legalActions, step } from '../../src/engine/engine';
import { deckCards } from '../../src/cards';
import type { GameState } from '../../src/engine/types';
import { mulberry } from '../../src/sim/playGame';
import { reg } from '../scenario';

const advanced = (seed: number, moves: number): GameState => {
  let s = createGame(reg, { decks: [deckCards('maruru'), deckCards('zardy')], seed, first: 0 }).state;
  const rand = mulberry(seed);
  for (let i = 0; i < moves && s.winner === null; i++) {
    const l = legalActions(s, reg);
    s = step(s, l[Math.floor(rand() * l.length)], reg).state;
  }
  return s;
};

const l1 = makeRuleBased({});
const planOf = (s: GameState, iterations: number, seed = 1) => {
  const legal = legalActions(s, reg);
  return planSearch(s, legal, { rand: mulberry(seed), reg, budget: { iterations } }, {}, l1);
};

/** Worker の代わり: seeds を size 個ずつに分け、順不同に(後ろから)評価して、元の順に並べて返す */
const dispatchBy = (plan: ReturnType<typeof planOf>, size: number): RoundDispatch => async (seeds, alive) => {
  const chunks: number[][] = [];
  for (let i = 0; i < seeds.length; i += size) chunks.push(seeds.slice(i, i + size));
  const out: number[][][] = new Array(chunks.length);
  for (let c = chunks.length - 1; c >= 0; c--) out[c] = chunks[c].map((sd) => evalRound(plan.env, reg, sd, alive));
  return out.flat();
};

describe('roundSeed / evalRound', () => {
  it('種が同じなら同じ結果(純関数)', () => {
    const plan = planOf(advanced(11, 14), 60);
    const alive = plan.env.legal.map((_, i) => i);
    const a = evalRound(plan.env, reg, roundSeed(plan.base, 3), alive);
    const b = evalRound(plan.env, reg, roundSeed(plan.base, 3), alive);
    expect(a).toEqual(b);
  });
  it('alive でない手は評価しない(NaN)', () => {
    const plan = planOf(advanced(11, 14), 60);
    const r = evalRound(plan.env, reg, roundSeed(plan.base, 0), [0]);
    expect(Number.isNaN(r[0])).toBe(false);
    expect(r.slice(1).every((x) => Number.isNaN(x))).toBe(true);
  });
  it('他の手の評価の有無に、ある手の結果は左右されない(投機的な評価が使える前提)', () => {
    const plan = planOf(advanced(11, 14), 60);
    const all = plan.env.legal.map((_, i) => i);
    const full = evalRound(plan.env, reg, roundSeed(plan.base, 2), all);
    const part = evalRound(plan.env, reg, roundSeed(plan.base, 2), [all.length - 1]);
    expect(part[all.length - 1]).toBe(full[all.length - 1]);
  });
});

describe('runSearchParallel(逐次と同じ結果)', () => {
  for (const [seed, moves] of [
    [11, 14],
    [5, 22],
    [9, 30],
  ] as const) {
    it(`反復指定: 並列数 1・3・8、分け方を変えても、選ぶ手と集計が同じ(seed ${seed}, ${moves}手)`, async () => {
      const s = advanced(seed, moves);
      if (s.winner !== null || legalActions(s, reg).length < 2) return;
      const plan = planOf(s, 90);
      const infoSeq: SearchInfo[] = [];
      const seq = runSearch(plan, reg, (i) => infoSeq.push(i));
      for (const [par, size] of [
        [1, 1],
        [3, 2],
        [8, 3],
        [8, 100],
      ] as const) {
        const info: SearchInfo[] = [];
        const act = await runSearchParallel(plan, dispatchBy(plan, size), par, (i) => info.push(i));
        expect(act).toEqual(seq);
        expect(info[0].iterations).toBe(infoSeq[0].iterations);
        expect(info[0].rounds).toBe(infoSeq[0].rounds);
        expect(info[0].decided).toBe(infoSeq[0].decided);
        expect(info[0].errors).toBe(infoSeq[0].errors);
      }
    }, 120000);
  }
  it('反復の上限を超えない', async () => {
    const plan = planOf(advanced(11, 14), 40);
    const info: SearchInfo[] = [];
    await runSearchParallel(plan, dispatchBy(plan, 2), 4, (i) => info.push(i));
    expect(info[0].iterations).toBeLessThanOrEqual(Math.max(40, plan.env.legal.length));
  }, 60000);
  it('時間主導でも、合法手を返して終わる', async () => {
    const s = advanced(11, 14);
    const legal = legalActions(s, reg);
    const plan = planSearch(s, legal, { rand: mulberry(1), reg, budget: { ms: 150 } }, {}, l1);
    expect(plan.timeDriven).toBe(true);
    const a = await runSearchParallel(plan, dispatchBy(plan, 2), 4);
    expect(legal).toContainEqual(a);
  }, 60000);
});

describe('decideParallel(decide と同じ手)', () => {
  it('同じ要求なら、並列に決めても decide と同じ手になる(反復指定)', async () => {
    const { decide } = await import('../../src/ai/decide');
    const { decideParallel } = await import('../../src/ai/parallel');
    const { evalRound: ev } = await import('../../src/ai/mcts');
    for (const [seed, moves] of [
      [11, 14],
      [5, 22],
    ] as const) {
      const s = advanced(seed, moves);
      if (s.winner !== null || !s.pending) continue;
      const req = { state: s, spec: { kind: 'mcts' as const, iterations: 60 }, seed: 7 };
      const seq = decide(reg, req);
      let env: import('../../src/ai/mcts').SearchEnv | null = null;
      const act = await decideParallel(reg, req, {
        begin: (e) => (env = e),
        dispatch: async (seeds, alive) => seeds.map((sd) => ev(env!, reg, sd, alive)),
        parallelism: 4,
      });
      expect(act).toEqual(seq);
    }
  }, 120000);
  it('並列にできない要求(ルールベース)は、そのまま decide で決める', async () => {
    const { decide } = await import('../../src/ai/decide');
    const { decideParallel, canParallelize } = await import('../../src/ai/parallel');
    const s = advanced(11, 14);
    const req = { state: s, spec: { kind: 'rule' as const }, seed: 3 };
    expect(canParallelize(reg, req)).toBe(false);
    const act = await decideParallel(reg, req, { begin: () => {}, dispatch: async () => [], parallelism: 4 });
    expect(act).toEqual(decide(reg, req));
  });
});

describe('poolDispatch(空いた評価器から順に取る)', () => {
  it('塊の大きさ・評価器の数・速さがばらばらでも、元の順に並べて返す', async () => {
    const { poolDispatch } = await import('../../src/ai/parallel');
    const seeds = Array.from({ length: 23 }, (_, i) => i);
    const slow = (ms: number): RoundDispatch => async (sd) => {
      await new Promise((r) => setTimeout(r, ms));
      return sd.map((x) => [x * 2]);
    };
    for (const [runners, chunk] of [
      [[slow(0)], 1],
      [[slow(5), slow(0), slow(2)], 2],
      [[slow(1), slow(1), slow(1), slow(1)], 5],
    ] as const) {
      const rows = await poolDispatch([...runners], chunk)(seeds, [0]);
      expect(rows).toEqual(seeds.map((x) => [x * 2]));
    }
  });
});
