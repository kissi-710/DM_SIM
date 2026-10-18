// 履歴ベンチ: 現在の探索 AI と、過去のコミットから取り出した探索 AI(scripts/legacy/*)を、複製対局で戦わせる。
//   npx tsx scripts/history-bench.ts --a cur --b v0 [--mode iter|time] [--n 300] [--games 30] [--seed 1] [--aextra infer=0] [--bextra ...] [--name 保存名]
// 版: cur(現在) / v0(最初期 1987996) / v1(ペア比較・調整済み 71db838) / v2(ptree 導入 c326a74) / v3(軌跡平均 8e230b3) / vmain(直近の main 4b9ee70)
// 条件: --mode iter = 1手の反復回数を揃える(n 反復) / time = 1手の思考時間を揃える(n ms)
// 4 デッキの全 16 組 × games 組 × 2(席の入れ替え)。同じデッキの並びとシードで、席だけ入れ替える。
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { DECK_PRESETS } from '../src/cards';
import { wilson } from '../src/sim/stats';
import type { AgentDesc, HistoryOut, HistoryTask } from './historyWorker';

function arg(name: string, d: string): string {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : d;
}
const mode = arg('mode', 'iter') as 'iter' | 'time';
const n = Number(arg('n', '300'));
const games = Number(arg('games', '30'));
const seed = Number(arg('seed', '1'));
const a: AgentDesc = { ver: arg('a', 'cur'), mode, n: Number(arg('an', String(n))), extra: arg('aextra', '') || undefined, spec: arg('aspec', '') || undefined };
const b: AgentDesc = { ver: arg('b', 'v0'), mode, n: Number(arg('bn', String(n))), extra: arg('bextra', '') || undefined, spec: arg('bspec', '') || undefined };
const name = arg('name', `${a.ver}-vs-${b.ver}-${mode}${n}`);
const jobs = Math.max(1, Math.min(8, Number(arg('jobs', String(availableParallelism() - 1)))));

const ids = DECK_PRESETS.map((d) => d.id);
const tasks: HistoryTask[] = [];
for (const x of ids) for (const y of ids) tasks.push({ a, b, deckA: x, deckB: y, games, seed });
const outs: HistoryOut[] = new Array(tasks.length);
let next = 0;
let done = 0;
const t0 = Date.now();
await new Promise<void>((resolve, reject) => {
  const start = () => {
    const w = new Worker(new URL('./historyWorker.ts', import.meta.url));
    let cur = -1;
    const feed = () => {
      if (next >= tasks.length) return void w.terminate();
      cur = next++;
      w.postMessage(tasks[cur]);
    };
    w.on('message', (m: { ok: boolean; error?: string } & Partial<HistoryOut>) => {
      if (!m.ok) return reject(new Error(m.error));
      outs[cur] = m as HistoryOut;
      done++;
      process.stderr.write(`\r  ${done}/${tasks.length} (${((Date.now() - t0) / 1000).toFixed(0)}秒)`);
      if (done === tasks.length) resolve();
      else feed();
    });
    w.on('error', reject);
    feed();
  };
  for (let i = 0; i < Math.min(jobs, tasks.length); i++) start();
});
process.stderr.write('\n');

let wins = 0;
let total = 0;
let turns = 0;
const think = { msA: 0, nA: 0, msB: 0, nB: 0 };
const pairs = outs.map((o, i) => {
  wins += o.wins;
  total += o.n;
  turns += o.turns;
  think.msA += o.think.msA;
  think.nA += o.think.nA;
  think.msB += o.think.msB;
  think.nB += o.think.nB;
  return { deckA: tasks[i].deckA, deckB: tasks[i].deckB, rate: o.wins / o.n, n: o.n };
});
const ci = wilson(Math.round(wins), total);
const res = {
  a: a.spec ? `cur(${a.spec})` : `${a.ver}${a.extra ? '(' + a.extra + ')' : ''}`,
  b: b.spec ? `cur(${b.spec})` : `${b.ver}${b.extra ? '(' + b.extra + ')' : ''}`,
  mode,
  n: a.n === b.n ? a.n : `${a.n}/${b.n}`,
  games: total,
  winsA: wins,
  rate: wins / total,
  ci95: ci,
  avgTurns: turns / total,
  msA: think.nA ? think.msA / think.nA : null,
  msB: think.nB ? think.msB / think.nB : null,
  sec: (Date.now() - t0) / 1000,
  seed,
  pairs,
};
mkdirSync('scratch/history', { recursive: true });
writeFileSync(`scratch/history/${name}.json`, JSON.stringify(res, null, 1));
const pct = (x: number) => (x * 100).toFixed(1) + '%';
console.log(
  `■ A=${res.a} 対 B=${res.b}  ${mode === 'iter' ? '反復' : 'ms'}=${res.n}  seed=${seed}  ${total}試合\n` +
    `  A の勝ち ${pct(res.rate)}(95%区間 ${pct(ci[0])}〜${pct(ci[1])})  1手あたり A ${res.msA?.toFixed(1)}ms / B ${res.msB?.toFixed(1)}ms  平均 ${res.avgTurns.toFixed(1)} ターン  ${res.sec.toFixed(0)}秒`,
);
// Worker の後始末が残るとプロセスが終わらず、続けて回すスクリプトが止まるので、ここで終える
process.exit(0);
