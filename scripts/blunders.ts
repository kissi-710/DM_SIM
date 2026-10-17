// CPU の悪手の洗い出し: CPU 同士の対局の各判断を教師で評価し、損失の大きい手を集めて保存する。
//   npx tsx scripts/blunders.ts <名前> [試合数=100] [反復=600] [ラウンド=200] [シード=1] [AI設定の追加(例 pm=...)]
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { DECK_PRESETS } from '../src/cards';
import { parseSpec } from '../src/ai/specString';
import type { BlunderTask, Rec } from './blunderWorker';

const [name = 'a', gamesArg = '100', iter = '600', rounds = '200', seed = '1', extra = ''] = process.argv.slice(2);
const ids = DECK_PRESETS.map((d) => d.id);
const spec = parseSpec(`mcts:iter=${iter}${extra ? ',' + extra : ''}`);
const games: BlunderTask['games'] = [];
for (let g = 0; g < Number(gamesArg); g++) {
  const a = ids[g % ids.length];
  const b = ids[Math.floor(g / ids.length) % ids.length];
  games.push({ deckA: a, deckB: b, seed: Number(seed) * 10007 + g });
}
const jobs = Math.max(1, Math.min(8, availableParallelism() - 1));
const per = Math.max(1, Math.ceil(games.length / (jobs * 6)));
const tasks: BlunderTask[] = [];
for (let i = 0; i < games.length; i += per) tasks.push({ games: games.slice(i, i + per), spec, rounds: Number(rounds) });
const recs: Rec[] = [];
let next = 0;
let done = 0;
const t0 = Date.now();
await new Promise<void>((resolve, reject) => {
  const start = () => {
    const w = new Worker(new URL('./blunderWorker.ts', import.meta.url));
    const feed = () => {
      if (next >= tasks.length) return void w.terminate();
      w.postMessage(tasks[next++]);
    };
    w.on('message', (m: { ok: boolean; recs?: Rec[]; error?: string }) => {
      if (!m.ok) return reject(new Error(m.error));
      recs.push(...m.recs!);
      done++;
      console.error(`  ${done}/${tasks.length} (${((Date.now() - t0) / 1000).toFixed(0)}秒) 判断 ${recs.length}`);
      if (done === tasks.length) resolve();
      else feed();
    });
    w.on('error', reject);
    feed();
  };
  for (let i = 0; i < Math.min(jobs, tasks.length); i++) start();
});
mkdirSync('scratch/blunders', { recursive: true });
writeFileSync(`scratch/blunders/${name}.json`, JSON.stringify({ args: process.argv.slice(2), recs }));
console.log(`試合 ${games.length} / 判断 ${recs.length} / ${((Date.now() - t0) / 1000).toFixed(0)}秒`);
