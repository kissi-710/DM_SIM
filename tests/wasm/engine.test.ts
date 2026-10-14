// Rust 版(WASM)と TS 版の、ラウンド評価の一致。src/wasm/dmsim.wasm(npm run build:wasm)が無ければスキップする。
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evalRound, planSearch, roundSeed, setNativeRounds } from '../../src/ai/mcts';
import { makeRuleBased } from '../../src/ai/rulebased';
import { deckCards } from '../../src/cards';
import { createGame, legalActions, step } from '../../src/engine/engine';
import { mulberry } from '../../src/sim/playGame';
import { DmEngine } from '../../src/wasm/dmEngine';
import { reg } from '../scenario';

const wasmPath = new URL('../../src/wasm/dmsim.wasm', import.meta.url);
const has = existsSync(wasmPath);

describe.skipIf(!has)('Rust 版エンジン(WASM)', () => {
  it('ラウンドの評価が TS 版と一致する(複数の局面・シード)', () => {
    const eng = DmEngine.createSync(readFileSync(wasmPath), JSON.stringify(reg.defs));
    const native = eng.asNativeRounds();
    const l1 = makeRuleBased({});
    let compared = 0;
    for (const [deckA, deckB, seed] of [
      ['maruru', 'zardy', 11],
      ['zardy', 'maruru', 12],
    ] as const) {
      let s = createGame(reg, { decks: [deckCards(deckA), deckCards(deckB)], seed, first: 0 }).state;
      const rand = mulberry(seed);
      for (let i = 0; i < 70 && s.winner === null; i++) {
        const legal = legalActions(s, reg);
        if (legal.length === 0) break;
        if (i % 5 === 0 && legal.length >= 2 && s.pending) {
          const plan = planSearch(s, legal, { rand: mulberry(i), reg, budget: { iterations: 20 } }, {}, l1);
          const alive = legal.map((_, k) => k);
          for (const r of [0, 1, 2]) {
            const sd = roundSeed(plan.base, r);
            setNativeRounds(null);
            const ts = evalRound(plan.env, reg, sd, alive);
            const got = native(plan.env, sd, alive);
            expect(got.length).toBe(ts.length);
            ts.forEach((v, k) => {
              if (Number.isNaN(v)) expect(Number.isNaN(got[k])).toBe(true);
              else expect(Math.abs(got[k] - v)).toBeLessThan(1e-9);
              compared++;
            });
          }
        }
        s = step(s, legal[Math.floor(rand() * legal.length)], reg).state;
      }
    }
    expect(compared).toBeGreaterThan(20);
  }, 120000);
});
