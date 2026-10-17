// Rust 版(WASM)と TS 版の、ラウンド評価の一致。src/wasm/dmsim.wasm(npm run build:wasm)が無ければスキップする。
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evalRound, planSearch, roundSeed, setNativeRounds } from '../../src/ai/mcts';
import { makeRuleBased } from '../../src/ai/rulebased';
import { PairedTree, setNativePairedRound, setNativeTree, treeSearch } from '../../src/ai/tree';
import { deckCards } from '../../src/cards';
import { createGame, legalActions, step } from '../../src/engine/engine';
import { FAIR, toPlayerView } from '../../src/engine/view';
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

  it('ヨビニオンで公開された山札の下の札の推論(決定化)が TS 版と一致する', () => {
    const eng = DmEngine.createSync(readFileSync(wasmPath), JSON.stringify(reg.defs));
    const native = eng.asNativeRounds();
    const l1 = makeRuleBased({});
    let s = createGame(reg, { decks: [deckCards('maruru'), deckCards('zardy')], seed: 5, first: 0 }).state;
    const rand = mulberry(5);
    let compared = 0;
    for (let i = 0; i < 40 && s.winner === null; i++) {
      const legal = legalActions(s, reg);
      if (legal.length === 0) break;
      // 両者の山札の下の3枚を、公開済みの札のまとまりにする(ヨビニオンを使った後と同じ形)
      s.knownDeck = [0, 1].map((p) => {
        const deck = s.players[p].deck;
        return deck.length >= 4 ? [deck.slice(-3).map((uid) => ({ uid, ep: s.cards[uid].ep }))] : [];
      }) as typeof s.knownDeck;
      if (i % 4 === 0 && legal.length >= 2 && s.pending) {
        const plan = planSearch(toPlayerView(s, s.pending.player, FAIR, reg), legal, { rand: mulberry(i), reg, budget: { iterations: 20 } }, {}, l1);
        expect(plan.env.view.hints?.deckKnown).toBeDefined();
        const alive = legal.map((_, k) => k);
        for (const r of [0, 1]) {
          const sd = roundSeed(plan.base, r);
          setNativeRounds(null);
          const ts = evalRound(plan.env, reg, sd, alive);
          const got = native(plan.env, sd, alive);
          ts.forEach((v, k) => {
            if (Number.isNaN(v)) expect(Number.isNaN(got[k])).toBe(true);
            else expect(Math.abs(got[k] - v)).toBeLessThan(1e-9);
            compared++;
          });
        }
      }
      s = step(s, legal[Math.floor(rand() * legal.length)], reg).state;
    }
    expect(compared).toBeGreaterThan(10);
  }, 120000);

  it('木の探索(ターン内の行動列)が TS 版と一致する(続きからの反復も同じ)', () => {
    const eng = DmEngine.createSync(readFileSync(wasmPath), JSON.stringify(reg.defs));
    const native = eng.asNativeTree();
    const l1 = makeRuleBased({});
    let s = createGame(reg, { decks: [deckCards('maruru'), deckCards('zardy')], seed: 21, first: 0 }).state;
    const rand = mulberry(21);
    let compared = 0;
    for (let i = 0; i < 60 && s.winner === null; i++) {
      const legal = legalActions(s, reg);
      if (legal.length === 0) break;
      if (i % 6 === 0 && legal.length >= 2 && s.pending) {
        const plan = planSearch(s, legal, { rand: mulberry(i), reg, budget: { iterations: 40 } }, {}, l1);
        const o = { c: 0.3, maxDepth: 24 };
        setNativeTree(null);
        const ts = treeSearch(plan.env, reg, plan.base, 40, o);
        // Rust 版は、20 → 40 と続けて反復する
        native(plan.env, plan.base, 20, o);
        const got = native(plan.env, plan.base, 40, o);
        expect(got.visits).toEqual(ts.visits);
        got.sums.forEach((v, k) => expect(Math.abs(v - ts.sums[k])).toBeLessThan(1e-9));
        compared++;
      }
      s = step(s, legal[Math.floor(rand() * legal.length)], reg).state;
    }
    expect(compared).toBeGreaterThan(3);
  }, 120000);

  it('ペア比較の木(数ラウンドを順に評価)が TS 版と一致する', () => {
    const eng = DmEngine.createSync(readFileSync(wasmPath), JSON.stringify(reg.defs));
    const nativeFn = eng.asNativePairedRound();
    const l1 = makeRuleBased({});
    let s = createGame(reg, { decks: [deckCards('zardy'), deckCards('maruru')], seed: 31, first: 0 }).state;
    const rand = mulberry(31);
    let compared = 0;
    for (let i = 0; i < 60 && s.winner === null; i++) {
      const legal = legalActions(s, reg);
      if (legal.length === 0) break;
      if (i % 7 === 0 && legal.length >= 2 && s.pending) {
        const plan = planSearch(s, legal, { rand: mulberry(i), reg, budget: { iterations: 30 } }, {}, l1);
        const o = { c: 0.3, maxDepth: 24 };
        const alive = legal.map((_, k) => k);
        setNativePairedRound(null);
        const ts = new PairedTree(plan.env, reg, o);
        setNativePairedRound(nativeFn);
        const nat = new PairedTree(plan.env, reg, o);
        for (let r = 0; r < 4; r++) {
          const sd = roundSeed(plan.base, r);
          setNativePairedRound(null);
          const a = ts.round(sd, alive);
          setNativePairedRound(nativeFn);
          const b = nat.round(sd, alive);
          a.forEach((v, k) => {
            if (Number.isNaN(v)) expect(Number.isNaN(b[k])).toBe(true);
            else expect(Math.abs(b[k] - v)).toBeLessThan(1e-9);
          });
        }
        compared++;
      }
      s = step(s, legal[Math.floor(rand() * legal.length)], reg).state;
    }
    setNativePairedRound(null);
    expect(compared).toBeGreaterThan(3);
  }, 120000);
});
