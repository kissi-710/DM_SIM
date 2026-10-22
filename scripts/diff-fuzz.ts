// TS 版と Rust 版(WASM)の、ラウンド評価の一致を、ランダムなデッキ(構築制限内)・局面で広く確かめる。
//   npx tsx scripts/diff-fuzz.ts [試合数=60] [シード=1]
// 前提: npm run build:wasm 済み。ずれた局面は scratch/survey/case-<試合>-<手>.json に書き出す(git の管理外)。
// 差分テスト(npm run test:rust)のフィクスチャは固定の少数の試合なので、まれなずれは、これで探す。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CARD_DB, CARD_LIST, DECK_PRESETS, TS_ONLY_CARD_IDS, deckCards } from '../src/cards';
import { loadRegistry } from '../src/engine/registry';
import { createGame, legalActions, step } from '../src/engine/engine';
import { DmEngine, rustRegistryJson } from '../src/wasm/dmEngine';
import { evalRound, setNativeRounds, type SearchEnv } from '../src/ai/mcts';
import { makeAgent } from '../src/ai';
import { mulberry } from '../src/engine/prng';
import { FAIR, toPlayerView } from '../src/engine/view';
import type { Action } from '../src/engine/types';

mkdirSync('scratch/survey', { recursive: true });
const reg = loadRegistry(CARD_DB);
const eng = DmEngine.createSync(readFileSync('src/wasm/dmsim.wasm'), rustRegistryJson(reg.defs));
const native = eng.asNativeRounds();
const pool = CARD_LIST.map((c) => c.id).filter((id) => id !== 'dummy' && id !== '?' && !TS_ONLY_CARD_IDS.includes(id) && !reg.defs[id].faces.some((f) => f.type === 'evolution' || f.type === 'smaxEvolution'));
const rnd = mulberry(Number(process.argv[3] ?? 1));
const randomDeck = (): string[] => {
  const d: string[] = [];
  const cnt = new Map<string, number>();
  while (d.length < 40) {
    const id = pool[Math.floor(rnd() * pool.length)];
    if ((cnt.get(id) ?? 0) >= 4) continue;
    cnt.set(id, (cnt.get(id) ?? 0) + 1);
    d.push(id);
  }
  return d;
};
const presets = DECK_PRESETS.map((p) => deckCards(p.id));
const N = Number(process.argv[2] ?? 60);
const agents = [makeAgent({ kind: 'rule' }), makeAgent({ kind: 'random' })];
let checked = 0, diffs = 0, errs = 0, rustErr = 0;
const bad: string[] = [];
for (let g = 0; g < N; g++) {
  const decks: [string[], string[]] = g % 3 === 0 ? [presets[g % presets.length], presets[(g + 1) % presets.length]] : [randomDeck(), randomDeck()];
  const seed = 9000 + g;
  let s;
  try { s = createGame(reg, { decks, seed, first: g % 2 as 0 | 1 }).state; } catch { errs++; continue; }
  const rand = mulberry(seed);
  for (let i = 0; i < 400 && s.winner === null; i++) {
    const legal = legalActions(s, reg);
    if (legal.length === 0) break;
    const who = s.pending!.player;
    if (legal.length > 1 && i % 7 === 0 && s.pending!.why !== 'ack') {
      const view = toPlayerView(s, who, FAIR, reg);
      const env: SearchEnv = { view, legal, me: who, policy: FAIR, horizon: 3 };
      const alive = legal.map((_, k) => k);
      const rs = (g * 1000 + i) >>> 0;
      setNativeRounds(null);
      const a = evalRound(env, reg, rs, alive);
      let b: number[];
      try { b = native(env, rs, alive); } catch (e) { rustErr++; bad.push(`g${g} i${i}: Rust 例外 ${(e as Error).message.slice(0, 100)}`); continue; }
      checked++;
      const same = a.length === b.length && a.every((x, k) => (Number.isNaN(x) && Number.isNaN(b[k])) || Math.abs(x - b[k]) < 1e-9);
      if (!same) { diffs++; writeFileSync(`scratch/survey/case-${g}-${i}.json`, JSON.stringify({ env, rs, alive, ts: a, rust: b, decks })); if (bad.length < 8) bad.push(`g${g} i${i} turn${s.turn} why=${s.pending!.why} ts=${JSON.stringify(a.map((x) => +x.toFixed(3)))} rs=${JSON.stringify(b.map((x) => +x.toFixed(3)))}`); }
    }
    const act = agents[g % 2].chooseAction(toPlayerView(s, who, FAIR, reg), legal, { rand, reg }) as Action;
    try { s = step(s, act, reg).state; } catch (e) { errs++; bad.push(`g${g} step 例外 ${(e as Error).message.slice(0, 100)}`); break; }
  }
}
console.log({ games: N, checked, diffs, rustErr, tsErrors: errs });
console.log(bad.join('\n'));
