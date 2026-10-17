// L1 の方針改善の実験用 Worker: 局面を集め、教師の手の価値(Q)と、手ごとの特徴量を返す。
import { parentPort } from 'node:worker_threads';
import { CARD_DB, deckCards } from '../src/cards';
import { chooseTurnAction } from '../src/ai/rulebased';
import { features, n_features, situationOf } from '../src/ai/l1learn';
import { loadRegistry } from '../src/engine/registry';
import { legalActions } from '../src/engine/engine';
import { collectPositions, teacherValues } from '../src/sim/aiEval';
import { mulberry } from '../src/sim/playGame';
import { installNativeFromEnv } from '../src/wasm/installNode';

installNativeFromEnv();
const reg = loadRegistry(CARD_DB);

export interface L1qTask {
  pairs: [string, string][];
  count: number;
  seed: number;
  rounds: number;
  horizon: number;
}
export interface L1qOut {
  ok: true;
  D: number;
  pos: { q: number[]; n: number; l1: number; turn: number; why: string; cat: string }[];
  X: Float32Array;
}

parentPort!.on('message', (t: L1qTask) => {
  try {
    const pairs = t.pairs.map(([x, y]) => ({ id: `${x}/${y}`, a: deckCards(x), b: deckCards(y) }));
    const positions = collectPositions(reg, pairs, t.count, t.seed).filter((p) => p.state.pending?.why === 'turnAction');
    const D = n_features(reg);
    const pos: L1qOut['pos'] = [];
    const chunks: number[][] = [];
    const rand = mulberry(t.seed);
    for (const p of positions) {
      const legal = legalActions(p.state, reg);
      const te = teacherValues(reg, p, { rounds: t.rounds, horizon: t.horizon, seed: t.seed });
      if (te.means.some((m) => Number.isNaN(m))) continue;
      const view = p.state;
      const sit = situationOf(view, reg);
      const x: number[] = [];
      for (const a of legal) {
        features(view, reg, sit, a, x);
        chunks.push(x.slice());
      }
      const l1a = chooseTurnAction(view, legal, { reg, rand });
      const l1 = legal.findIndex((a) => JSON.stringify(a) === JSON.stringify(l1a));
      const cat = legal.some((a) => a.type === 'CHARGE_MANA') ? 'charge' : legal.some((a) => a.type === 'PLAY_CARD') ? 'play' : 'attack';
      pos.push({ q: te.means, n: legal.length, l1: Math.max(0, l1), turn: p.turn, why: te.why, cat });
    }
    const X = new Float32Array(chunks.length * D);
    chunks.forEach((r, i) => X.set(r, i * D));
    parentPort!.postMessage({ ok: true, D, pos, X } satisfies L1qOut);
  } catch (e) {
    parentPort!.postMessage({ ok: false, error: String(e) });
  }
});
