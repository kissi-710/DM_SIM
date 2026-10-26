// 反復回数の飽和の表を作る: main/dbl_<N>.jsonl(N 対 2N)と main/rule_<N>.jsonl(N 対 ルールベース)と、実行ログの所要時間から、
// docs/data/saturation-2026-10/iterations.json を書く。UI(src/ui/BatchGuide.tsx)が読む。
//   npx tsx scripts/saturation/build-table.ts <データのディレクトリ> <queue2.log> <出力.json>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const [dir, logPath, outPath] = process.argv.slice(2);
interface Row {
  p: string;
  i: number;
  s: number;
}
/** 組(層)ごとに、複製ペア(偶数番号と次の奇数番号)の平均得点を単位として、層の等重み平均と標準誤差を出す */
function estimate(file: string): { rate: number; se: number; games: number } | null {
  if (!existsSync(file)) return null;
  const rows = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Row);
  const strata = new Map<string, number[]>();
  for (const r of rows) {
    const a = strata.get(r.p) ?? [];
    a[r.i] = r.s;
    strata.set(r.p, a);
  }
  let rate = 0;
  let v = 0;
  for (const s of strata.values()) {
    const units: number[] = [];
    for (let i = 0; i + 1 < s.length; i += 2) if (s[i] !== undefined && s[i + 1] !== undefined) units.push((s[i] + s[i + 1]) / 2);
    const m = units.reduce((a, b) => a + b, 0) / units.length;
    const s2 = units.reduce((a, b) => a + (b - m) ** 2, 0) / (units.length - 1);
    rate += m / strata.size;
    v += s2 / units.length / strata.size ** 2;
  }
  return { rate, se: Math.sqrt(v), games: rows.length };
}
// 所要時間: ログの「shard i/K: n 試合 t秒 → …<dbl|rule>_<N>.jsonl.i」から 1 試合あたりの秒(1 コア)
const secs = new Map<string, number[]>();
for (const l of readFileSync(logPath, 'utf8').split('\n')) {
  const m = l.match(/: (\d+) 試合 (\d+)秒 → .*\/(dbl|rule)_(\d+)\.jsonl/);
  if (m) {
    const k = `${m[3]}_${m[4]}`;
    secs.set(k, [...(secs.get(k) ?? []), Number(m[2]) / Number(m[1])]);
  }
}
const sPerGame = (k: string): number | null => {
  const a = secs.get(k);
  return a ? a.reduce((x, y) => x + y, 0) / a.length : null;
};
const levels = [5, 10, 20, 40, 80, 160, 320, 640, 1280];
const out = levels.map((N) => {
  const r = estimate(`${dir}/rule_${N}.jsonl`);
  const d = estimate(`${dir}/dbl_${N}.jsonl`);
  const f = (e: typeof r) => (e ? { rate: e.rate, ci: 1.96 * e.se, games: e.games } : null);
  return { iterations: N, vsRule: f(r), vsDouble: f(d), secPerGameVsRule: sPerGame(`rule_${N}`), secPerGameVsDouble: sPerGame(`dbl_${N}`) };
});
writeFileSync(outPath, JSON.stringify({ generated: '2026-10', levels: out }, null, 1) + '\n');
console.log(out.map((o) => `${String(o.iterations).padStart(5)} vsRule ${o.vsRule ? (o.vsRule.rate * 100).toFixed(1) + '±' + (o.vsRule.ci * 100).toFixed(1) : '-'}  vs2N ${o.vsDouble ? (o.vsDouble.rate * 100).toFixed(1) + '±' + (o.vsDouble.ci * 100).toFixed(1) : '-'}  ${o.secPerGameVsRule?.toFixed(2) ?? '-'}s/${o.secPerGameVsDouble?.toFixed(2) ?? '-'}s`).join('\n'));
