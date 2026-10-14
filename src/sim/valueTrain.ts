// 価値関数の学習(docs/ai-quality-plan.md §4.2): 自己対戦の「ターン開始時の局面 → 最終の勝敗」から、
// ロジスティック回帰(L2 正則化・ニュートン法)で重みを求める。
import { makeAgent, type Agent, type AgentSpec } from '../ai';
import { evaluate, DEFAULT_WEIGHTS } from '../ai/eval';
import { BASE_FEATURES, N_BASE, sideFeatures, type ValueModel } from '../ai/valueModel';
import { registryOf } from '../engine/engine';
import type { Registry } from '../engine/registry';
import type { Action, CardDB, GameState, PlayerId } from '../engine/types';
import { mulberry, playGameSync } from './playGame';

export interface TrainPair {
  a: string[];
  b: string[];
}

export interface Sample {
  x: Float64Array;
  /** 手番のプレイヤー(特徴量の me)が最終的に勝つなら 1 */
  y: number;
  game: number;
  turn: number;
  /** 手作りの評価(差)。基準の比較に使う */
  hand: number;
}

/** 特徴量の並び: 基本 N_BASE 個 + 手番 + バトルゾーンのカード(defs 順)+ 手札のカード(defs 順) */
export interface FeatureSpace {
  defs: string[];
  index: Map<string, number>;
}
export const featureSpace = (defs: string[]): FeatureSpace => ({ defs, index: new Map(defs.map((d, i) => [d, i])) });
export const dimOf = (sp: FeatureSpace) => N_BASE + 1 + 2 * sp.defs.length;

export function featureVector(s: GameState, reg: Registry, me: PlayerId, sp: FeatureSpace): Float64Array {
  const x = new Float64Array(dimOf(sp));
  const base = new Float64Array(N_BASE);
  const battle = new Map<string, number>();
  const hand = new Map<string, number>();
  sideFeatures(s, reg, me, base, battle, hand, 1);
  sideFeatures(s, reg, (1 - me) as PlayerId, base, battle, hand, -1);
  x.set(base, 0);
  x[N_BASE] = s.active === me ? 1 : -1;
  const nd = sp.defs.length;
  for (const [d, n] of battle) {
    const i = sp.index.get(d);
    if (i !== undefined) x[N_BASE + 1 + i] = n;
  }
  for (const [d, n] of hand) {
    const i = sp.index.get(d);
    if (i !== undefined) x[N_BASE + 1 + nd + i] = n;
  }
  return x;
}

/** 方策にばらつきを入れる: 確率 eps で、合法手から一様に選ぶ */
function noisy(base: Agent, eps: number, rand: () => number): Agent {
  return {
    ...base,
    chooseAction(v, legal, ctx) {
      if (legal.length > 1 && rand() < eps) return legal[Math.floor(rand() * legal.length)] as Action;
      return base.chooseAction(v, legal, ctx);
    },
  };
}

/** ルールベース同士(確率 eps でランダムな手を混ぜる)の対局から、各ターンの開始時点の局面を集め、対局後に勝敗のラベルを付ける */
export function generateSamples(
  db: CardDB | Registry,
  pairs: TrainPair[],
  games: number,
  seed: number,
  sp: FeatureSpace,
  epsList = [0, 0.05, 0.15],
  /** 対局に使う AI(既定はルールベース) */
  spec: AgentSpec = { kind: 'rule' },
  /** 対局の範囲(試合番号 from 以上 to 未満。並列に分けるため)。games は全体の数 */
  range: [number, number] = [0, games],
): Sample[] {
  const reg = registryOf(db);
  const out: Sample[] = [];
  const base = makeAgent(spec);
  for (let g = range[0]; g < range[1]; g++) {
    const pair = pairs[g % pairs.length];
    const eps = epsList[g % epsList.length];
    const r = mulberry((seed + g) ^ 0x2545f491);
    const ag = noisy(base, eps, r);
    const rows: { s: Sample; who: PlayerId }[] = [];
    let lastTurn = 0;
    const res = playGameSync(reg, [ag, ag], {
      decks: [pair.a, pair.b],
      seed: seed + g,
      first: 'random',
      onStep: (s) => {
        if (s.winner !== null || !s.pending) return;
        if (s.turn === lastTurn) return;
        lastTurn = s.turn;
        if (s.turn <= 1) return;
        const me = s.active;
        rows.push({ who: me, s: { x: featureVector(s, reg, me, sp), y: 0, game: g, turn: s.turn, hand: evaluate(s, reg, me, DEFAULT_WEIGHTS) } });
      },
    });
    if (res.winner === null || res.winner === 'draw') continue;
    for (const { s, who } of rows) {
      s.y = who === res.winner ? 1 : 0;
      out.push(s);
    }
  }
  return out;
}

// ───────────────────────── ロジスティック回帰 ─────────────────────────

export interface FitOpts {
  /** 基本の特徴量・手番の正則化(標準化した列に対する L2) */
  lambdaBase: number;
  /** カードごとの重みの正則化 */
  lambdaCard: number;
  iters?: number;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** 連立方程式 A x = b(A は対称正定値。破壊的)を、ガウスの消去法で解く */
function solve(A: Float64Array, b: Float64Array, n: number): Float64Array {
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r * n + i]) > Math.abs(A[piv * n + i])) piv = r;
    if (piv !== i) {
      for (let c = 0; c < n; c++) {
        const t = A[i * n + c];
        A[i * n + c] = A[piv * n + c];
        A[piv * n + c] = t;
      }
      const t = b[i];
      b[i] = b[piv];
      b[piv] = t;
    }
    const d = A[i * n + i] || 1e-12;
    for (let r = i + 1; r < n; r++) {
      const f = A[r * n + i] / d;
      if (f === 0) continue;
      for (let c = i; c < n; c++) A[r * n + c] -= f * A[i * n + c];
      b[r] -= f * b[i];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let v = b[i];
    for (let c = i + 1; c < n; c++) v -= A[i * n + c] * x[c];
    x[i] = v / (A[i * n + i] || 1e-12);
  }
  return x;
}

/** 重み(元の尺度)を返す。標準化して学習し、戻す */
export function fitLogistic(samples: Sample[], dim: number, nBase1: number, o: FitOpts): Float64Array {
  const n = samples.length;
  const scale = new Float64Array(dim).fill(1);
  for (let j = 0; j < dim; j++) {
    let ss = 0;
    for (const s of samples) ss += s.x[j] * s.x[j];
    const sd = Math.sqrt(ss / Math.max(1, n));
    scale[j] = sd > 1e-9 ? sd : 1;
  }
  const w = new Float64Array(dim);
  const lam = (j: number) => (j < nBase1 ? o.lambdaBase : o.lambdaCard);
  const xs = samples.map((s) => {
    const z = new Float64Array(dim);
    for (let j = 0; j < dim; j++) z[j] = s.x[j] / scale[j];
    return z;
  });
  for (let it = 0; it < (o.iters ?? 12); it++) {
    const g = new Float64Array(dim);
    const H = new Float64Array(dim * dim);
    for (let i = 0; i < n; i++) {
      const x = xs[i];
      let z = 0;
      for (let j = 0; j < dim; j++) z += w[j] * x[j];
      const p = sigmoid(z);
      const r = p - samples[i].y;
      const hw = Math.max(p * (1 - p), 1e-6);
      for (let j = 0; j < dim; j++) {
        const xj = x[j];
        if (xj === 0) continue;
        g[j] += r * xj;
        const row = j * dim;
        const hj = hw * xj;
        for (let k = j; k < dim; k++) H[row + k] += hj * x[k];
      }
    }
    for (let j = 0; j < dim; j++) {
      g[j] += lam(j) * w[j];
      H[j * dim + j] += lam(j);
      for (let k = 0; k < j; k++) H[j * dim + k] = H[k * dim + j];
    }
    const step = solve(H, g, dim);
    let mx = 0;
    for (let j = 0; j < dim; j++) {
      w[j] -= step[j];
      mx = Math.max(mx, Math.abs(step[j]));
    }
    if (mx < 1e-6) break;
  }
  const out = new Float64Array(dim);
  for (let j = 0; j < dim; j++) out[j] = w[j] / scale[j];
  return out;
}

export function weightsToModel(w: Float64Array, sp: FeatureSpace): ValueModel {
  const nd = sp.defs.length;
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
  const base: ValueModel['base'] = {};
  BASE_FEATURES.forEach((n, i) => (base[n] = r6(w[i])));
  const battle: Record<string, number> = {};
  const hand: Record<string, number> = {};
  sp.defs.forEach((d, i) => {
    if (Math.abs(w[N_BASE + 1 + i]) > 1e-9) battle[d] = r6(w[N_BASE + 1 + i]);
    if (Math.abs(w[N_BASE + 1 + nd + i]) > 1e-9) hand[d] = r6(w[N_BASE + 1 + nd + i]);
  });
  return { v: 1, base, tempo: r6(w[N_BASE]), battle, hand };
}

export interface Fit {
  logLoss: number;
  accuracy: number;
  n: number;
}

export function evaluateFit(samples: Sample[], w: Float64Array): Fit {
  let ll = 0;
  let ok = 0;
  for (const s of samples) {
    let z = 0;
    for (let j = 0; j < w.length; j++) z += w[j] * s.x[j];
    const p = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(z)));
    ll -= s.y * Math.log(p) + (1 - s.y) * Math.log(1 - p);
    if ((p > 0.5 ? 1 : 0) === s.y) ok++;
  }
  return { logLoss: ll / Math.max(1, samples.length), accuracy: ok / Math.max(1, samples.length), n: samples.length };
}

/** 手作りの評価 e に対して、P = σ(a·e) の a を学習する(1次元。基準の比較用) */
export function fitHandScale(samples: Sample[]): number {
  let a = 0.05;
  for (let it = 0; it < 30; it++) {
    let g = 0;
    let h = 1e-9;
    for (const s of samples) {
      const p = sigmoid(a * s.hand);
      g += (p - s.y) * s.hand;
      h += Math.max(p * (1 - p), 1e-9) * s.hand * s.hand;
    }
    const d = g / h;
    a -= d;
    if (Math.abs(d) < 1e-9) break;
  }
  return a;
}

export function evaluateHand(samples: Sample[], a: number): Fit {
  let ll = 0;
  let ok = 0;
  for (const s of samples) {
    const p = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(a * s.hand)));
    ll -= s.y * Math.log(p) + (1 - s.y) * Math.log(1 - p);
    if ((p > 0.5 ? 1 : 0) === s.y) ok++;
  }
  return { logLoss: ll / Math.max(1, samples.length), accuracy: ok / Math.max(1, samples.length), n: samples.length };
}
