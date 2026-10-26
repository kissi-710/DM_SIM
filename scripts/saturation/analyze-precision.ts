// 必要試合数の分析: collect.ts の JSONL(duplicate / alternate / random)から、
// 組ごとの勝率 p・1試合あたりの標準偏差・N 試合の推定の標準偏差(重ならない N 試合のブロック間の SD)・±ε を満たす試合数を出す。
//   npx tsx scripts/saturation/analyze-precision.ts <dup.jsonl> <alt.jsonl> [<rand.jsonl>] > out.json
import { readFileSync } from 'node:fs';

type Mode = 'duplicate' | 'alternate' | 'random';
interface Row {
  p: string;
  i: number;
  s: number;
}
const load = (f: string): Map<string, number[]> => {
  const m = new Map<string, number[]>();
  const rows = readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Row);
  for (const r of rows) {
    const a = m.get(r.p) ?? [];
    a[r.i] = r.s;
    m.set(r.p, a);
  }
  return m;
};
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const sd = (x: number[]) => {
  const m = mean(x);
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1));
};

/** 推定量: duplicate は席ごとの平均(番号の偶奇)の 1/2 ずつ。alternate も同じ(席で層化)。random は単純平均 */
function estimate(mode: Mode, s: number[]): number {
  if (mode === 'random') return mean(s);
  const f = s.filter((_, i) => i % 2 === 0);
  const b = s.filter((_, i) => i % 2 === 1);
  return 0.5 * (mean(f) + mean(b));
}

const BLOCKS = [100, 200, 500, 1000, 2000];
const out: Record<string, unknown> = {};
const files = process.argv.slice(2);
const modes: Mode[] = ['duplicate', 'alternate', 'random'];
files.forEach((f, k) => {
  const mode = modes[k];
  const data = load(f);
  const perPair: Record<string, unknown>[] = [];
  for (const [pair, s] of data) {
    const row: Record<string, unknown> = { pair, games: s.length, p: mean(s) };
    row.sdGame = sd(s);
    // 重ならない N 試合のブロックの推定のばらつき。block 長は偶数(duplicate のペアを割らない)
    const sdN: Record<number, number> = {};
    for (const N of BLOCKS) {
      const est: number[] = [];
      for (let a = 0; a + N <= s.length; a += N) est.push(estimate(mode, s.slice(a, a + N)));
      if (est.length >= 3) sdN[N] = sd(est);
    }
    row.sdN = sdN;
    perPair.push(row);
  }
  out[mode] = perPair;
});
console.log(JSON.stringify(out, null, 1));
