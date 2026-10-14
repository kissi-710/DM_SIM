// TS 版のプレイアウト速度(rust/examples/bench.rs と同じ入力・同じ回数)。
//   npx tsx scripts/bench-rollouts.ts rust/fixtures/games.json 10
import { readFileSync } from 'node:fs';
import { CARD_DB } from '../src/cards';
import { evalRound, type SearchEnv } from '../src/ai/mcts';
import { loadRegistry } from '../src/engine/registry';

const file = process.argv[2] ?? 'rust/fixtures/games.json';
const passes = Number(process.argv[3] ?? 10);
const root = JSON.parse(readFileSync(file, 'utf8'));
const reg = loadRegistry(CARD_DB);
const rounds: { env: SearchEnv; seeds: number[]; alive: number[] }[] = root.rounds;
for (const r of rounds) for (const sd of r.seeds) evalRound(r.env, reg, sd, r.alive); // ウォームアップ
const t0 = performance.now();
let n = 0;
let sum = 0;
for (let p = 0; p < passes; p++) {
  for (const r of rounds) {
    for (const sd of r.seeds) {
      const out = evalRound(r.env, reg, sd, r.alive);
      n += r.alive.length;
      for (const x of out) if (!Number.isNaN(x)) sum += x;
    }
  }
}
const dt = (performance.now() - t0) / 1000;
console.log(`TS:   ${n} プレイアウト / ${dt.toFixed(3)}秒 = ${(n / dt).toFixed(0)} 回/秒 (検算 ${sum.toFixed(3)})`);
