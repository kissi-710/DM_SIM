// L1 の方針改善の実験: 手の価値(Q)に線形モデルを当てはめ、保留の局面で損失(regret)を測る。
//   npx tsx scripts/l1q-fit.ts <データ名...> [--out <モデルJSON>] [--lambda <数>]
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : null;
const lamIdx = args.indexOf('--lambda');
const fixedLambda = lamIdx >= 0 ? Number(args[lamIdx + 1]) : null;
const catIdx = args.indexOf('--cat');
const catArg = catIdx >= 0 ? args[catIdx + 1] : null;
const names = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out' && args[i - 1] !== '--lambda' && args[i - 1] !== '--cat' && args[i - 1] !== '--frac');

interface P { q: number[]; n: number; l1: number; turn: number; why: string; off: number; cat?: string }
let D = 0;
const pos: P[] = [];
const Xs: Float32Array[] = [];
for (const name of names) {
  const meta = JSON.parse(readFileSync(`scratch/l1q/${name}.json`, 'utf8'));
  const buf = readFileSync(`scratch/l1q/${name}.f32`);
  const X = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  D = meta.D;
  let row = 0;
  for (const p of meta.pos) {
    pos.push({ ...p, off: row });
    row += p.n;
  }
  // 位置の row は、このデータ内の行番号 → 全体の配列に連結するので、後で補正する
  Xs.push(X);
}
// 全体の X に連結し、off を補正
const totalRows = Xs.reduce((s, x) => s + x.length / D, 0);
const X = new Float32Array(totalRows * D);
{
  let o = 0;
  let pi = 0;
  for (let k = 0; k < names.length; k++) {
    const meta = JSON.parse(readFileSync(`scratch/l1q/${names[k]}.json`, 'utf8'));
    X.set(Xs[k], o * D);
    for (let i = 0; i < meta.pos.length; i++) pos[pi + i].off += o;
    pi += meta.pos.length;
    o += Xs[k].length / D;
  }
}
if (catArg) {
  const keep = pos.filter((p) => p.cat === catArg);
  pos.length = 0;
  pos.push(...keep);
}
console.log(`局面 ${pos.length} / 行 ${totalRows} / D=${D}` + (catArg ? `(カテゴリ ${catArg})` : ''));
const by = (rows: P[]) => rows.reduce<Record<string, number>>((m, p) => ((m[p.why] = (m[p.why] ?? 0) + 1), m), {});
console.log('内訳', JSON.stringify(by(pos)));

// 局面の順番を固定してシャッフルし、80% を学習・20% を保留に
const order = pos.map((_, i) => i);
let sd = 12345;
const rnd = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
for (let i = order.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [order[i], order[j]] = [order[j], order[i]];
}
const nTest = Math.floor(pos.length * 0.2);
const test = order.slice(0, nTest).map((i) => pos[i]);
const fracIdx = args.indexOf('--frac');
const frac = fracIdx >= 0 ? Number(args[fracIdx + 1]) : 1;
const trainAll = order.slice(nTest).map((i) => pos[i]);
const train = trainAll.slice(0, Math.floor(trainAll.length * frac));

function solve(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const M = new Float64Array(n * (n + 1));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) M[i * (n + 1) + j] = A[i * n + j];
    M[i * (n + 1) + n] = b[i];
  }
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r * (n + 1) + i]) > Math.abs(M[p * (n + 1) + i])) p = r;
    if (p !== i) for (let c = 0; c <= n; c++) [M[i * (n + 1) + c], M[p * (n + 1) + c]] = [M[p * (n + 1) + c], M[i * (n + 1) + c]];
    const piv = M[i * (n + 1) + i];
    if (Math.abs(piv) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r * (n + 1) + i] / piv;
      if (f === 0) continue;
      for (let c = i; c <= n; c++) M[r * (n + 1) + c] -= f * M[i * (n + 1) + c];
    }
  }
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = Math.abs(M[i * (n + 1) + i]) < 1e-12 ? 0 : M[i * (n + 1) + n] / M[i * (n + 1) + i];
  return w;
}

// 正規方程式(局面内で中心化した特徴量と Q)
const A = new Float64Array(D * D);
const b = new Float64Array(D);
const mean = new Float64Array(D);
for (const p of train) {
  if (p.n < 2) continue;
  mean.fill(0);
  let qm = 0;
  for (let k = 0; k < p.n; k++) {
    for (let d = 0; d < D; d++) mean[d] += X[(p.off + k) * D + d] / p.n;
    qm += p.q[k] / p.n;
  }
  const xc = new Float64Array(D);
  for (let k = 0; k < p.n; k++) {
    for (let d = 0; d < D; d++) xc[d] = X[(p.off + k) * D + d] - mean[d];
    const qc = p.q[k] - qm;
    for (let d = 0; d < D; d++) {
      if (xc[d] === 0) continue;
      b[d] += xc[d] * qc;
      for (let e = 0; e < D; e++) if (xc[e] !== 0) A[d * D + e] += xc[d] * xc[e];
    }
  }
}
const fitW = (lambda: number) => {
  const Ar = A.slice();
  for (let d = 0; d < D; d++) Ar[d * D + d] += lambda;
  return solve(Ar, b, D);
};
const score = (w: Float64Array, p: P, k: number) => {
  let s = 0;
  for (let d = 0; d < D; d++) {
    const x = X[(p.off + k) * D + d];
    if (x !== 0) s += w[d] * x;
  }
  return s;
};
function evaluate(w: Float64Array | null, rows: P[]) {
  let reg = 0;
  let agree = 0;
  let n = 0;
  const byWhy: Record<string, { n: number; reg: number }> = {};
  const perTurn: Record<string, { n: number; reg: number }> = {};
  for (const p of rows) {
    if (p.n < 2) continue;
    const qmax = Math.max(...p.q);
    let pick = p.l1;
    if (w) {
      let bs = -Infinity;
      for (let k = 0; k < p.n; k++) {
        const s = score(w, p, k);
        if (s > bs) {
          bs = s;
          pick = k;
        }
      }
    }
    const r = qmax - p.q[pick];
    reg += r;
    n++;
    if (r < 1e-9) agree++;
    const t = p.turn <= 3 ? '1-3' : p.turn <= 6 ? '4-6' : p.turn <= 9 ? '7-9' : '10+';
    (perTurn[t] ??= { n: 0, reg: 0 }).n++;
    perTurn[t].reg += r;
  }
  return { reg: reg / n, agree: agree / n, n, perTurn };
}
console.log(`\n保留 ${test.length} 局面`);
const base = evaluate(null, test);
console.log(`L1(現行) 損失 ${(base.reg * 100).toFixed(2)}pt 一致 ${(base.agree * 100).toFixed(1)}%`);
// ランダム
{
  let r = 0;
  let n = 0;
  for (const p of test) {
    if (p.n < 2) continue;
    r += Math.max(...p.q) - p.q.reduce((s, v) => s + v, 0) / p.n;
    n++;
  }
  console.log(`ランダム 損失 ${((r / n) * 100).toFixed(2)}pt`);
}
const lambdas = fixedLambda !== null ? [fixedLambda] : [0.3, 1, 3, 10, 30, 100];
let bestW: Float64Array | null = null;
let bestReg = Infinity;
for (const lam of lambdas) {
  const w = fitW(lam);
  const tr = evaluate(w, train);
  const te = evaluate(w, test);
  console.log(`λ=${lam}: 学習 損失 ${(tr.reg * 100).toFixed(2)}pt / 保留 損失 ${(te.reg * 100).toFixed(2)}pt 一致 ${(te.agree * 100).toFixed(1)}%`);
  if (te.reg < bestReg) {
    bestReg = te.reg;
    bestW = w;
  }
}
const te = evaluate(bestW!, test);
console.log('\nターン帯別(保留) 損失 L1 → 学習:');
for (const t of Object.keys(te.perTurn)) console.log(`  ${t}: ${(base.perTurn[t].reg / base.perTurn[t].n * 100).toFixed(2)}pt → ${(te.perTurn[t].reg / te.perTurn[t].n * 100).toFixed(2)}pt (n=${te.perTurn[t].n})`);
if (out) {
  // 全データで学習し直して保存
  for (const p of test) {
    // 保留も含めて再学習
    if (p.n < 2) continue;
    mean.fill(0);
    let qm = 0;
    for (let k = 0; k < p.n; k++) {
      for (let d = 0; d < D; d++) mean[d] += X[(p.off + k) * D + d] / p.n;
      qm += p.q[k] / p.n;
    }
    const xc = new Float64Array(D);
    for (let k = 0; k < p.n; k++) {
      for (let d = 0; d < D; d++) xc[d] = X[(p.off + k) * D + d] - mean[d];
      const qc = p.q[k] - qm;
      for (let d = 0; d < D; d++) {
        if (xc[d] === 0) continue;
        b[d] += xc[d] * qc;
        for (let e = 0; e < D; e++) if (xc[e] !== 0) A[d * D + e] += xc[d] * xc[e];
      }
    }
  }
  const lam = fixedLambda ?? lambdas.find((l) => Math.abs(evaluate(fitW(l), test).reg - bestReg) < 1e-12) ?? 10;
  writeFileSync(out, JSON.stringify({ w: Array.from(fitW(lam)), lambda: lam, D }));
  console.log(`\n全データで学習し直して保存: ${out}(λ=${lam})`);
}
