// WASM 版のプレイアウトの速度と、TS 版との一致の確認。
//   npx tsx scripts/bench-wasm.ts rust/fixtures/games.json rust/target/wasm32-unknown-unknown/release/dmsim.wasm 10
import { readFileSync } from 'node:fs';
import { DmEngine } from '../src/wasm/dmEngine';
import type { SearchEnv } from '../src/ai/mcts';

const file = process.argv[2] ?? 'rust/fixtures/games.json';
const wasmPath = process.argv[3] ?? 'rust/target/wasm32-unknown-unknown/release/dmsim.wasm';
const passes = Number(process.argv[4] ?? 10);
const root = JSON.parse(readFileSync(file, 'utf8'));
const rounds: { env: SearchEnv; seeds: number[]; alive: number[]; rows: (number | null)[][] }[] = root.rounds;
const eng = await DmEngine.create(readFileSync(wasmPath), JSON.stringify(root.defs));

// 一致の確認
let maxDiff = 0;
let n = 0;
for (const r of rounds) {
  eng.begin(r.env);
  const rows = eng.rounds(r.seeds, r.alive);
  rows.forEach((row, i) =>
    row.forEach((v, k) => {
      const want = r.rows[i][k];
      if (want === null) {
        if (!Number.isNaN(v)) throw new Error(`NaN のはずが ${v}`);
      } else {
        maxDiff = Math.max(maxDiff, Math.abs(v - want));
        n++;
      }
    }),
  );
}
console.log(`一致: ${n} 個の報酬(最大差 ${maxDiff.toExponential(2)})`);

// 速度(env の登録は1局面につき1回。ラウンドは4シード)
for (const r of rounds) {
  eng.begin(r.env);
  eng.rounds(r.seeds, r.alive);
}
const t0 = performance.now();
let plays = 0;
for (let p = 0; p < passes; p++) {
  for (const r of rounds) {
    eng.begin(r.env); // 1局面につき1回(実際の探索と同じ)
    for (let rep = 0; rep < 10; rep++) {
      eng.rounds(r.seeds, r.alive);
      plays += r.seeds.length * r.alive.length;
    }
  }
}
const dt = (performance.now() - t0) / 1000;
console.log(`WASM: ${plays} プレイアウト / ${dt.toFixed(3)}秒 = ${(plays / dt).toFixed(0)} 回/秒`);
