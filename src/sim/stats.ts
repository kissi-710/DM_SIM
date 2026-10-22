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

/** 勝率の推定のための十分統計量(試合の範囲を分けて実行して、足し合わせて統合できる) */
export interface RateAcc {
  /** A が先攻の試合の数と得点(勝ち 1・引分 0.5) */
  nF: number;
  sF: number;
  /** A が後攻の試合の数と得点 */
  nS: number;
  sS: number;
  /** 複製対局のペア(席を入れ替えた2試合)の数と、ペアの得点(2試合の平均)の合計・2乗和 */
  m: number;
  pSum: number;
  pSq: number;
}

export const emptyAcc = (): RateAcc => ({ nF: 0, sF: 0, nS: 0, sS: 0, m: 0, pSum: 0, pSq: 0 });

export function addAcc(a: RateAcc, b: RateAcc): RateAcc {
  return { nF: a.nF + b.nF, sF: a.sF + b.sF, nS: a.nS + b.nS, sS: a.sS + b.sS, m: a.m + b.m, pSum: a.pSum + b.pSum, pSq: a.pSq + b.pSq };
}

/**
 * 有効サンプル数 nEff の Wilson 区間(推定値 p を中心に)。分散 v から nEff = c(1−c)/v。
 * c は、v を求めた時と同じ平滑化(勝ち・負けに 0.5 を足す)をした割合。p そのもの(0 や 1)で nEff を求めると、
 * 分子が 0 に潰れて nEff が 1 になり、全勝(400 試合で 400 勝)の区間が 20.7%〜100% になっていた。
 */
function wilsonEff(p: number, v: number, c: number, n: number): [number, number] {
  // 全勝・全敗に近い時は、ペアにしても、試合数(n)より多くの情報は得られない(全ペアが同じ得点だと、分散の推定が潰れて、
  // 20 ペア全勝でも 97.5% 以上のような過信の区間になる)。試合数で頭打ちにする
  const cap = c * (1 - c) < 0.05 ? n : Infinity;
  const nEff = Math.min(cap, Math.max(1, (c * (1 - c)) / Math.max(v, 1e-12)));
  const pc = Math.min(1, Math.max(0, p));
  return wilson(pc * nEff, nEff);
}

/**
 * 勝率の推定値と95%区間。
 *  - 複製対局(ペアが2組以上): ペア単位の得点の平均と分散(同じ配りの2試合は相関するので、試合を独立と見ない)
 *  - 先攻・後攻の両方がある: 席で層化(各 1/2 の重み)。席の違いによるばらつきを取り除く
 *  - それ以外: 得点(引分は 0.5)の割合と Wilson 区間
 */
export function estimateRate(a: RateAcc): { rate: number; ci: [number, number] } {
  const n = a.nF + a.nS;
  if (n === 0) return { rate: 0, ci: [0, 1] };
  if (a.m >= 2 && a.m * 2 >= n * 0.9) {
    const p = a.pSum / a.m;
    // 事前に、標準偏差 0.25 のペアが 1 つあるとみなして、分散の下限を与える(全ペアが同じ得点でも区間が潰れない)
    const s2 = (a.pSq - a.m * p * p + 0.0625) / a.m;
    return { rate: p, ci: wilsonEff(p, s2 / a.m, (a.pSum + 0.5) / (a.m + 1), n) };
  }
  if (a.nF > 0 && a.nS > 0) {
    const pF = a.sF / a.nF;
    const pS = a.sS / a.nS;
    const p = 0.5 * (pF + pS);
    const sm = (s: number, k: number) => (s + 0.5) / (k + 1);
    const qF = sm(a.sF, a.nF);
    const qS = sm(a.sS, a.nS);
    const v = 0.25 * ((qF * (1 - qF)) / a.nF + (qS * (1 - qS)) / a.nS);
    return { rate: p, ci: wilsonEff(p, v, 0.5 * (qF + qS), n) };
  }
  const s = a.sF + a.sS;
  return { rate: s / n, ci: wilson(s, n) };
}

/** 試合のターン数(往復。対戦画面の「N ターン目」と同じ数え方)ごとの試合数。範囲を分けた実行は、足し合わせて統合できる */
export type TurnHist = Record<number, number>;

export interface TurnSummary {
  n: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  /** 標準偏差(標本。n が 1 以下なら 0) */
  sd: number;
}

/** エンジンの手番の通し番号(先攻 1・後攻 2・先攻 3…)を、往復のターン数(1・1・2…)にする */
export const roundOf = (engineTurn: number): number => Math.ceil(engineTurn / 2);

/** ターン数の分布から、平均・中央値・最小・最大・標準偏差を出す(試合が 0 なら null) */
export function turnSummary(hist: TurnHist): TurnSummary | null {
  const keys = Object.keys(hist)
    .map(Number)
    .sort((a, b) => a - b);
  const n = keys.reduce((t, k) => t + hist[k], 0);
  if (n === 0) return null;
  const mean = keys.reduce((t, k) => t + k * hist[k], 0) / n;
  const ss = keys.reduce((t, k) => t + hist[k] * (k - mean) ** 2, 0);
  /** 小さい方から数えて idx 番目(0 始まり)の値 */
  const nth = (idx: number): number => {
    let c = 0;
    for (const k of keys) {
      c += hist[k];
      if (idx < c) return k;
    }
    return keys[keys.length - 1];
  };
  const median = n % 2 === 1 ? nth((n - 1) / 2) : (nth(n / 2 - 1) + nth(n / 2)) / 2;
  return { n, mean, median, min: keys[0], max: keys[keys.length - 1], sd: n > 1 ? Math.sqrt(ss / (n - 1)) : 0 };
}

/** 分布を足し合わせる */
export function addTurnHist(a: TurnHist, b: TurnHist): TurnHist {
  const out: TurnHist = { ...a };
  for (const [k, v] of Object.entries(b)) out[Number(k)] = (out[Number(k)] ?? 0) + v;
  return out;
}
