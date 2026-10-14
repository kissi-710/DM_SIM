// 統計の下請け(勝率の信頼区間・超幾何分布)。

/**
 * 標準正規分布の分位点(下側確率 p の z)。Acklam の近似(相対誤差 1.2e-9 程度)。
 * 例: normalQuantile(0.975) ≈ 1.96
 */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) return p <= 0 ? -Infinity : Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** k 個の区間を同時に(全体で 1 - alpha の確率で)成り立たせるための、両側の z(Bonferroni の補正) */
export function zFamily(k: number, alpha = 0.05): number {
  return normalQuantile(1 - alpha / (2 * Math.max(1, k)));
}

/** Wilson の95%信頼区間 */
export function wilson(successes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}

function lchoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  let r = 0;
  for (let i = 1; i <= k; i++) r += Math.log(n - k + i) - Math.log(i);
  return r;
}

/** 超幾何分布 P(X = k): N枚の山札に当たりがK枚、n枚引いて k枚当たる確率 */
export function hypergeomPmf(N: number, K: number, n: number, k: number): number {
  if (k < Math.max(0, n - (N - K)) || k > Math.min(K, n)) return 0;
  return Math.exp(lchoose(K, k) + lchoose(N - K, n - k) - lchoose(N, n));
}

/** n枚引いて、当たりが min 枚以上ある確率 */
export function hypergeomAtLeast(N: number, K: number, n: number, min: number): number {
  let p = 0;
  for (let k = min; k <= Math.min(K, n); k++) p += hypergeomPmf(N, K, n, k);
  return Math.min(1, p);
}
