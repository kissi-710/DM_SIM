// 統計の下請け(勝率の信頼区間・超幾何分布)。

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
