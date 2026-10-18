// L1 の方針改善の実験: 教師の手の価値(Q)と特徴量を集めて保存する。
//   npx tsx scripts/l1q-data.ts <名前> [タスク数=16] [タスクあたりの局面=100] [ラウンド=200] [シード=1] [デッキ=maruru,zardy,lost-maruru,...]
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { DECK_PRESETS } from '../src/cards';
import type { L1qOut, L1qTask } from './l1qWorker';

const [name = 'a', nTasks = '16', per = '100', rounds = '200', seed = '1', decks] = process.argv.slice(2);
const ids = decks ? decks.split(',') : DECK_PRESETS.map((d) => d.id);
const pairs: [string, string][] = [];
for (const x of ids) for (const y of ids) pairs.push([x, y]);
const jobs = Math.max(1, Math.min(8, availableParallelism() - 1));
const tasks: L1qTask[] = Array.from({ length: Number(nTasks) }, (_, i) => ({ pairs, count: Number(per), seed: Number(seed) * 1000 + i * 17, rounds: Number(rounds), horizon: 99 }));
const outs: L1qOut[] = new Array(tasks.length);
let next = 0;
let done = 0;
const t0 = Date.now();
await new Promise<void>((resolve, reject) => {
  const start = () => {
    const w = new Worker(new URL('./l1qWorker.ts', import.meta.url));
    let cur = -1;
    const feed = () => {
      if (next >= tasks.length) return void w.terminate();
      cur = next++;
      w.postMessage(tasks[cur]);
    };
    w.on('message', (m: { ok: boolean; error?: string } & Partial<L1qOut>) => {
      if (!m.ok) return reject(new Error(m.error));
      outs[cur] = m as L1qOut;
      done++;
      console.error(`  ${done}/${tasks.length} (${((Date.now() - t0) / 1000).toFixed(0)}秒)`);
      if (done === tasks.length) resolve();
      else feed();
    });
    w.on('error', reject);
    feed();
  };
  for (let i = 0; i < Math.min(jobs, tasks.length); i++) start();
});
const D = outs[0].D;
const pos = outs.flatMap((o) => o.pos);
const total = outs.reduce((s, o) => s + o.X.length, 0);
const X = new Float32Array(total);
let off = 0;
for (const o of outs) {
  X.set(o.X, off);
  off += o.X.length;
}
writeFileSync(`scratch/l1q/${name}.json`, JSON.stringify({ D, pos }));
writeFileSync(`scratch/l1q/${name}.f32`, Buffer.from(X.buffer));
console.log(`局面 ${pos.length} / 行 ${total / D} / D=${D} / ${((Date.now() - t0) / 1000).toFixed(0)}秒`);
