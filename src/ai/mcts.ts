// L2 モンテカルロ探索AI(design 7.2・7.3)。
// 決定化(隠れたカードの割り当て)+ プレイアウトを繰り返し、各合法手の平均報酬で選ぶ。
// プレイアウトの方針は L1(ルールベース)の手順を使い、L1 の手を事前の候補として扱う
// (方針改善型: L1 より悪い手に動かないようにする)。
// 計算量: ms は「最大の思考時間」。iterations を指定した時はそれも上限になる(再現性が必要なバッチ・テスト用)。
// ms だけを指定した時(CPU戦)は、時間いっぱいまで反復する。ただし、手の優劣がはっきりした時点で早めに打ち切る。
import { legalActions, step } from '../engine/engine';
import type { Registry } from '../engine/registry';
import type { Action, GameState, PlayerId } from '../engine/types';
import { FAIR, type InfoPolicy } from '../engine/view';
import { determinize } from './determinize';
import { evaluate, reward, RULE_WEIGHTS, withWeights, type RewardWeights } from './eval';
import { L1_DEFAULT, withL1, type L1Params } from './l1params';
import { chooseTurnAction, makeRuleBased } from './rulebased';
import type { Agent, AgentCtx } from './types';

/** ターン内の行動列を木にする探索の設定(tree.ts) */
export interface TreeOpts {
  /** UCB の探索定数(報酬は 0〜1) */
  c: number;
  /** 木の深さの上限(これを超えたらプレイアウト) */
  maxDepth: number;
}

export interface MctsOpts {
  policy?: InfoPolicy;
  candidateDecks?: string[][];
  /** 反復回数の上限。指定しなければ時間(ms)だけで打ち切る */
  iterations?: number;
  /** 最大の思考時間(ms) */
  ms?: number;
  /** プレイアウトを何ターン先で打ち切るか */
  horizonTurns?: number;
  /** マナチャージの判断だけの先読みのターン数(未指定なら horizonTurns) */
  chargeHorizon?: number;
  /** L1 の手に与える事前の上乗せ(報酬の単位) */
  priorBonus?: number;
  /** 評価関数の重み(差し替える分だけ指定) */
  weights?: Partial<RewardWeights>;
  /** 指定すると、ラウンドの評価を「根はペア比較・2手目以降は木」にする(tree.ts の PairedTree)。Worker にも env 経由で伝わる */
  tree?: TreeOpts;
  /** 劣る手を外す判定の厳しさ(差が誤差の何倍以上か。既定 2.5) */
  elimZ?: number;
  /** 近い手の比較を打ち切る精度(報酬の単位。小さいほど、僅差の判断に長く考える。既定 0.012) */
  precision?: number;
  /** 時間主導の探索で、早期終了をしない反復数の下限(既定 0) */
  minIterations?: number;
  /** 反復の予算を段階に分け、段階ごとに下位の半分を外す(Sequential Halving。反復回数が決まっている時だけ) */
  halving?: boolean;
  /** 1回の探索が終わるたびに呼ばれる(計測・表示用) */
  onSearch?: (info: SearchInfo) => void;
}

/** プレイアウト用の素早い方針: ターン中の行動は L1 の手順、効果の選択は軽い規則 */
export function rolloutPick(s: GameState, legal: Action[], reg: Registry, rand: () => number, l1: L1Params = L1_DEFAULT, lookahead = false, eps = 0): Action {
  const p = s.pending!;
  if (p.why === 'turnAction') {
    // ε 乱択: 小さな確率で、L1 の手ではなく一様ランダムな手を指す(続きの方針の偏りをならす)
    if (eps > 0 && rand() < eps) return legal[Math.floor(rand() * legal.length)];
    return chooseTurnAction(s, legal, { reg, rand }, l1);
  }
  if (lookahead && p.why !== 'triggerDeclare') {
    // 1手進めて、評価(L1 と同じ重み)が最も高い選択。同点は並びの先頭
    let best = legal[0];
    let bs = -Infinity;
    for (const a of legal) {
      try {
        const v = evaluate(step(s, a, reg).state, reg, p.player, RULE_WEIGHTS);
        if (v > bs) {
          bs = v;
          best = a;
        }
      } catch {
        // その選択は候補から外す
      }
    }
    return best;
  }
  const pick = (arr: Action[]) => arr[Math.floor(rand() * arr.length)];
  switch (p.why) {
    case 'triggerDeclare': {
      // S・トリガーは宣言できるだけ宣言する
      let best = legal[0];
      let bl = -1;
      for (const a of legal) {
        const n = a.type === 'ANSWER' && Array.isArray(a.value) ? a.value.length : 0;
        if (n > bl) {
          bl = n;
          best = a;
        }
      }
      return best;
    }
    case 'may': {
      const yes = legal.find((a) => a.type === 'ANSWER' && a.value === true);
      if (yes) return rand() < 0.75 ? yes : pick(legal);
      // 「使うか + 対象」を1問にした形(pick。空 = 使わない): 従来の はい/いいえ と同じ、約 7/8 で使う
      const use = legal.filter((a) => a.type === 'ANSWER' && Array.isArray(a.value) && a.value.length > 0);
      if (use.length === 0) return pick(legal);
      return rand() < 0.875 ? pick(use) : legal.find((a) => a.type === 'ANSWER' && Array.isArray(a.value) && a.value.length === 0) ?? pick(use);
    }
    case 'block': {
      // 半分はブロックする
      // 複数体のブロッカーを選ぶと、余分にタップするだけで損なので、1体の選択を優先する(507.1a)
      const blocks = legal.filter((a) => a.type === 'ANSWER' && Array.isArray(a.value) && a.value.length > 0);
      const single = blocks.filter((a) => (a as { value: unknown[] }).value.length === 1);
      const pool = single.length ? single : blocks;
      return pool.length && rand() < 0.5 ? pick(pool) : legal[0];
    }
    default:
      return pick(legal);
  }
}

/** プレイアウト1回の手数の上限(無限ループ防止。ゲーム終了まで進める設定でも足りる値) */
export const MAX_ROLLOUT_STEPS = 4000;

/** 時間主導の探索で、反復(プレイアウト)の絶対上限(無限ループ防止) */
export const HARD_MAX_ITERATIONS = 100000;
/** 手の比較に必要な最低ラウンド数(これ未満では判定しない) */
const MIN_ROUNDS = 8;

/**
 * 同じ世界で比べた報酬の差 d(先頭 − 相手)の統計から、勝負がついたかを判定する。
 * ahead: 差が誤差(約2.5σ)より大きい / precise: 差は判定できないが、これ以上反復しても精度は変わらない(2.5σ < 1.2pt) / open: まだ分からない。
 * 手ごとに別の世界を引くと、手の差より世界のばらつきが大きくなる。同じ世界・同じ乱数で比べる(ペア比較)と、その分が打ち消される。
 */
export function pairedVerdict(n: number, dsum: number, dsq: number, bonusGap: number, z = 2.5, precise = 0.012): 'ahead' | 'precise' | 'open' {
  if (n < MIN_ROUNDS) return 'open';
  const mean = dsum / n;
  const se = Math.sqrt(Math.max(0.0025, dsq / n - mean * mean) / n);
  if (mean + bonusGap > z * se) return 'ahead';
  if (2.5 * se < precise) return 'precise';
  return 'open';
}

/** プレイアウトの乱数(1ラウンド内の全候補手で同じ列にするため、シードから作る) */
export function seededRand(seed: number, anti = false): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const raw = (t ^ (t >>> 14)) >>> 0;
    // 対称(antithetic): 同じ列の反転(1 − u − 2^-32)。0 以上 1 未満
    return (anti ? 4294967295 - raw : raw) / 4294967296;
  };
}

/** 世界の乱数の種と対称の向き。anti の時は、奇数番目のラウンドが、前のラウンドと同じ種の反転列を使う */
export function worldSeed(seed: number, anti: boolean): [number, boolean] {
  return anti ? [(seed & ~1) >>> 0, (seed & 1) === 1] : [seed, false];
}

/** ラウンド r の種(anti の時は、2つ組で同じ種に低位ビットだけ違う値) */
export function seedOfRound(base: number, r: number, anti: boolean): number {
  return anti ? (((roundSeed(base, r >> 1) & ~1) | (r & 1)) >>> 0) : roundSeed(base, r);
}

// 同じ重みでの全プレイアウト(1ラウンドの全候補手・全反復)で、同じ調整値を使い回す(重みは作成後に書き換えない)
const rolloutL1Cache = new WeakMap<RewardWeights, L1Params>();

/** プレイアウトの L1 の調整値(rl1 の指定に、atkTrade の指定を重ねる) */
export function rolloutL1(w: RewardWeights): L1Params {
  let r = rolloutL1Cache.get(w);
  if (!r) {
    r = withL1({ ...w.l1, ...(w.atkTrade === undefined ? {} : { atkTrade: w.atkTrade }), ...(w.playModel ? { playModel: w.playModel } : {}) });
    rolloutL1Cache.set(w, r);
  }
  return r;
}

export function rollout(start: GameState, reg: Registry, me: PlayerId, rand: () => number, horizon: number, w: RewardWeights): number {
  const l1 = rolloutL1(w);
  const lookahead = w.lookahead === true;
  const eps = w.eps ?? 0;
  const traj = w.traj ?? 0;
  const decay = w.trajDecay ?? 1;
  let s = start;
  const endTurn = s.turn + horizon;
  let guard = 0;
  // 軌跡平均: ターンの境目ごとの報酬も平均に入れる(最後の1点のばらつきと、遠い先への偏りを減らす)
  let acc = 0;
  let wsum = 0;
  let wt = 1;
  let cnt = 0;
  let lastTurn = s.turn;
  // 開始時点(根の手を指した直後・木の先)の評価も平均に入れる
  if (traj > 0 && (w.trajStart ?? 0) > 0 && s.winner === null) {
    acc += wt * reward(s, reg, me, w);
    wsum += wt;
    wt *= decay;
    cnt++;
  }
  while (s.winner === null && s.turn < endTurn && guard++ < MAX_ROLLOUT_STEPS) {
    const legal = legalActions(s, reg);
    if (legal.length === 0) break;
    const a = rolloutPick(s, legal, reg, rand, l1, lookahead, eps);
    s = step(s, a, reg).state;
    if (traj > 0 && s.turn !== lastTurn && s.turn < endTurn && s.winner === null) {
      lastTurn = s.turn;
      acc += wt * reward(s, reg, me, w);
      wsum += wt;
      wt *= decay;
      cnt++;
    }
  }
  const fin = reward(s, reg, me, w);
  if (traj > 0 && cnt > 0) return (1 - traj) * fin + traj * ((acc + wt * fin) / (wsum + wt));
  return fin;
}

/** 世界(決定化)と乱数を作るための種から、そのラウンドの種を作る。ラウンドの結果は「環境・種・評価する手」だけで決まる。 */
export function roundSeed(base: number, r: number): number {
  let x = (base ^ Math.imul(r + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/** ラウンドの評価に必要な入力(JSON 化できる。Worker に渡す) */
export interface SearchEnv {
  view: GameState;
  legal: Action[];
  me: PlayerId;
  policy: InfoPolicy;
  candidateDecks?: string[][];
  horizon: number;
  /** 評価関数の重み(既定との差分) */
  weights?: Partial<RewardWeights>;
  /** あれば、ラウンドは木のペア比較(tree.ts)で評価する。木は評価する側が(探索の入力ごとに)保つ */
  tree?: TreeOpts;
}

/** ラウンドの評価を差し替える関数(Rust 版エンジン(WASM)など)。TS 版と同じ入力・同じ結果を返す */
export type NativeRounds = (env: SearchEnv, seed: number, alive: number[]) => number[];
let native: NativeRounds | null = null;
export function setNativeRounds(f: NativeRounds | null): void {
  native = f;
}

/** Rust 版が持たないカード(25の王道の新規カード)。これらが対局に含まれる時は、TS 版で評価する */
let nativeSkip: ReadonlySet<string> = new Set();
let nativeSkipCache = new WeakMap<object, boolean>();
export function setNativeSkipCards(ids: Iterable<string>): void {
  nativeSkip = new Set(ids);
  nativeSkipCache = new WeakMap();
}

/**
 * Rust 版が持たない設定(プレイアウトの L1 の調整値・効果選択の先読み)や、Rust 版が持たないカードを含む対局は、TS 版で評価する
 * (黙って無視しない)。env を渡すと、後者も調べる
 */
export function nativeUnsupported(w?: Partial<RewardWeights>, env?: SearchEnv): boolean {
  if (w && (w.l1 !== undefined || w.lookahead === true)) return true;
  if (env && nativeSkip.size > 0) {
    let hit = nativeSkipCache.get(env);
    if (hit === undefined) {
      hit = env.view.cards.some((c) => nativeSkip.has(c.defId)) || (env.candidateDecks ?? []).some((d) => d.some((id) => nativeSkip.has(id)));
      nativeSkipCache.set(env, hit);
    }
    return hit;
  }
  return false;
}

/**
 * 1ラウンド: 種から世界を1つ作り、alive の手を同じ世界・同じ乱数で評価する。
 * 戻り値は手ごとの報酬(alive でない手・例外を出した手は NaN)。純関数なので、どの Worker で評価しても同じ。
 */
export function evalRound(env: SearchEnv, reg: Registry, seed: number, alive: number[]): number[] {
  if (native && !nativeUnsupported(env.weights, env)) {
    try {
      return native(env, seed, alive);
    } catch {
      // 外部の評価器(Rust 版)が使えない入力の時は、TS 版で評価する
    }
  }
  const w = withWeights(env.weights);
  const [ws, wa] = worldSeed(seed, (w.anti ?? 0) > 0);
  const rr = seededRand(ws, wa);
  const det = determinize(env.view, env.me, { rand: rr, reg, policy: env.policy, candidateDecks: env.candidateDecks });
  const rolloutSeed = Math.floor(rr() * 0x7fffffff);
  const r = new Array<number>(env.legal.length).fill(NaN);
  for (const k of alive) {
    try {
      r[k] = rollout(step(det, env.legal[k], reg).state, reg, env.me, seededRand(rolloutSeed), env.horizon, w);
    } catch {
      // エンジンの例外は「負け」にせず、その手を候補から外す(feed が NaN を見て外す)
    }
  }
  return r;
}

/**
 * ペア比較の探索の状態。ラウンドの結果を順に feed する(どこで評価した結果でも、順に与えれば同じ結果になる)。
 * 全候補手を同じ世界で比べ、明らかに劣る手を途中で外す。残った手は全ラウンドで評価されているので、平均を公平に比べられる。
 */
export class MctsSearch {
  alive: number[];
  rounds = 0;
  /** プレイアウトの回数 */
  it = 0;
  errors = 0;
  decided = false;
  finished = false;
  private sum: number[];
  private sq: number[];
  private cross: number[][];
  private bonus: number[];
  /** Sequential Halving: 段の数・1段の反復数・今の段で使った反復数 */
  private stages: number;
  private stageBudget: number;
  private stageIt = 0;

  constructor(
    readonly n: number,
    readonly baseIdx: number,
    readonly prior: number,
    /** プレイアウト回数の上限 */
    readonly maxIt: number,
    /** 時間主導か(true の時だけ、判定できる精度に達したら早期終了する) */
    readonly timeDriven: boolean,
    /** 劣る手を外す判定の厳しさ */
    readonly z = 2.5,
    /** 段階ごとに下位の半分を外す(予算が決まっている時だけ) */
    readonly halving = false,
    /** 「これ以上反復しても精度は変わらない」とみなす誤差(報酬の単位。2.5σ がこれ未満になるまで、近い手の比較を続ける。既定 0.012) */
    readonly precise = 0.012,
    /** 時間主導の探索で、1位と2位の判定による早期終了をしない反復数の下限(僅差の判断に、最低限これだけは考えさせる。既定 0) */
    readonly minIt = 0,
  ) {
    this.alive = Array.from({ length: n }, (_, i) => i);
    this.sum = new Array(n).fill(0);
    this.sq = new Array(n).fill(0);
    this.cross = Array.from({ length: n }, () => new Array(n).fill(0));
    this.bonus = new Array(n).fill(0);
    this.bonus[baseIdx] = prior;
    this.stages = Math.max(1, Math.ceil(Math.log2(Math.max(1, n))));
    this.stageBudget = maxIt / this.stages;
  }

  /** 次のラウンドを始められるか(反復の上限) */
  get canStart(): boolean {
    return !this.finished && (this.rounds === 0 || this.it + this.alive.length <= this.maxIt);
  }

  private mean(k: number): number {
    return this.sum[k] / this.rounds + this.bonus[k];
  }

  private verdict(a: number, b: number) {
    const dsum = this.sum[a] - this.sum[b];
    const dsq = this.sq[a] + this.sq[b] - 2 * this.cross[a][b];
    return pairedVerdict(this.rounds, dsum, dsq, this.bonus[a] - this.bonus[b], this.z, this.precise);
  }

  /** 次のラウンドの結果を反映する(alive でない手の値は無視する) */
  feed(r: number[]): void {
    if (!this.canStart) return;
    this.it += this.alive.length;
    this.stageIt += this.alive.length;
    const ok = this.alive.filter((k) => !Number.isNaN(r[k]));
    this.errors += this.alive.length - ok.length;
    this.alive = ok;
    if (ok.length === 0) {
      this.finished = true;
      return;
    }
    this.rounds++;
    for (const i of ok) {
      this.sum[i] += r[i];
      this.sq[i] += r[i] * r[i];
      for (const j of ok) this.cross[i][j] += r[i] * r[j];
    }
    if (ok.length < 2) {
      this.finished = true;
      return;
    }
    // 先頭の手と比べて、明らかに劣る手を外す
    let lead = ok[0];
    for (const k of ok) if (this.mean(k) > this.mean(lead)) lead = k;
    this.alive = ok.filter((k) => k === lead || this.verdict(lead, k) !== 'ahead');
    if (this.alive.length === 1) {
      this.decided = true;
      this.finished = true;
      return;
    }
    // Sequential Halving: 段の予算を使い切ったら、平均の下位の半分を外す
    if (this.halving && !this.timeDriven && this.alive.length > 2 && this.stageIt >= this.stageBudget) {
      const ranked = this.alive.slice().sort((x, y) => this.mean(y) - this.mean(x));
      this.alive = ranked.slice(0, Math.max(2, Math.ceil(ranked.length / 2)));
      this.stageIt = 0;
    }
    // 時間主導の時は、1位と2位が判定できる精度に達していれば打ち切る
    if (this.timeDriven && this.rounds % 4 === 0 && this.it >= this.minIt) {
      let second = -1;
      for (const k of this.alive) if (k !== lead && (second < 0 || this.mean(k) > this.mean(second))) second = k;
      if (second >= 0 && this.verdict(lead, second) !== 'open') {
        this.decided = true;
        this.finished = true;
        return;
      }
    }
    if (!this.canStart) this.finished = true;
  }

  /** 選ぶ手の添字 */
  best(): number {
    if (this.alive.length === 0 || this.rounds === 0) return this.baseIdx;
    let b = this.alive[0];
    for (const k of this.alive) if (this.mean(k) > this.mean(b)) b = k;
    return b;
  }
}

export interface SearchInfo {
  iterations: number;
  ms: number;
  timeDriven: boolean;
  decided: boolean;
  arms: number;
  rounds?: number;
  errors?: number;
  /** 並列に評価した Worker の数(逐次なら 1) */
  workers?: number;
}

/** 探索の計画: 入力(env)・L1 の手・予算。逐次・並列のどちらの駆動でも同じ結果になる */
export interface SearchPlan {
  env: SearchEnv;
  baseIdx: number;
  prior: number;
  maxIt: number;
  /** 最大の思考時間(ms) */
  ms: number;
  timeDriven: boolean;
  /** ラウンドの種の元 */
  base: number;
  elimZ?: number;
  halving?: boolean;
  precision?: number;
  minIterations?: number;
}

export function planSearch(
  view: GameState,
  legal: Action[],
  ctx: { rand: () => number; reg: Registry; budget?: { iterations?: number; ms?: number } },
  o: MctsOpts,
  l1: Agent,
): SearchPlan {
  const policy = o.policy ?? FAIR;
  const n = legal.length;
  let iterations = ctx.budget?.iterations ?? o.iterations;
  let ms = ctx.budget?.ms ?? o.ms;
  // どちらも未指定なら、再現できる既定(120反復)。ms だけなら時間主導(反復の上限なし)
  if (iterations === undefined && ms === undefined) iterations = 120;
  const timeDriven = iterations === undefined;
  // 反復回数だけを指定した時は、時間では打ち切らない(マシンの速さ・負荷に結果が左右されない)
  if (ms === undefined) ms = timeDriven ? 1500 : Infinity;
  // L1 が選ぶ手(事前の候補)
  const baseAct = l1.chooseAction(view, legal, ctx as AgentCtx) as Action;
  let baseIdx = legal.findIndex((a) => JSON.stringify(a) === JSON.stringify(baseAct));
  if (baseIdx < 0) baseIdx = 0;
  return {
    env: { view, legal, me: view.pending!.player, policy, candidateDecks: o.candidateDecks, horizon: legal.some((a) => a.type === 'CHARGE_MANA') ? (o.chargeHorizon ?? o.horizonTurns ?? 3) : (o.horizonTurns ?? 3), weights: o.weights, tree: o.tree },
    baseIdx,
    prior: o.priorBonus ?? 0.005,
    maxIt: timeDriven ? HARD_MAX_ITERATIONS : Math.max(iterations!, n),
    ms,
    timeDriven,
    base: Math.floor(ctx.rand() * 0x7fffffff),
    elimZ: o.elimZ,
    halving: o.halving,
    precision: o.precision,
    minIterations: o.minIterations,
  };
}

const newSearch = (p: SearchPlan) => new MctsSearch(p.env.legal.length, p.baseIdx, p.prior, p.maxIt, p.timeDriven, p.elimZ ?? 2.5, p.halving ?? false, p.precision ?? 0.012, p.minIterations ?? 0);

function infoOf(s: MctsSearch, plan: SearchPlan, ms: number, workers: number): SearchInfo {
  return { iterations: s.it, ms, timeDriven: plan.timeDriven, decided: s.decided, arms: s.n, rounds: s.rounds, errors: s.errors, workers };
}

/** 逐次に探索する */
export function runSearch(
  plan: SearchPlan,
  reg: Registry,
  onSearch?: (i: SearchInfo) => void,
  /** ラウンドの評価(既定は evalRound。木のペア比較などに差し替える) */
  round?: (seed: number, alive: number[]) => number[],
): Action {
  const t0 = Date.now();
  const search = newSearch(plan);
  while (!search.finished && !(search.rounds > 0 && Date.now() - t0 >= plan.ms)) {
    const seed = seedOfRound(plan.base, search.rounds, (plan.env.weights?.anti ?? 0) > 0);
    search.feed(round ? round(seed, search.alive) : evalRound(plan.env, reg, seed, search.alive));
  }
  onSearch?.(infoOf(search, plan, Date.now() - t0, 1));
  return plan.env.legal[search.best()];
}

/** 複数ラウンドをまとめて(別の Worker などで)評価して返す関数。rows[i] は seeds[i] のラウンドの結果 */
export type RoundDispatch = (seeds: number[], alive: number[]) => Promise<number[][]>;

/**
 * 並列に探索する。先のラウンドを投機的にまとめて評価し、結果は元の順に反映する。
 * 結果(選ぶ手・集計)は、並列数や分け方によらず逐次の探索と同じになる(投機で余分に評価したぶんは捨てる)。
 */
export async function runSearchParallel(
  plan: SearchPlan,
  dispatch: RoundDispatch,
  parallelism: number,
  onSearch?: (i: SearchInfo) => void,
  /** 1回に投機的に評価するラウンド数 = parallelism × waveFactor */
  waveFactor = 8,
): Promise<Action> {
  const t0 = Date.now();
  const search = newSearch(plan);
  const wave = Math.max(2, parallelism * waveFactor);
  while (!search.finished && !(search.rounds > 0 && Date.now() - t0 >= plan.ms)) {
    const room = plan.timeDriven ? wave : Math.max(1, Math.min(wave, Math.floor((plan.maxIt - search.it) / search.alive.length)));
    const anti = (plan.env.weights?.anti ?? 0) > 0;
    const seeds = Array.from({ length: room }, (_, i) => seedOfRound(plan.base, search.rounds + i, anti));
    const rows = await dispatch(seeds, search.alive.slice());
    for (const r of rows) {
      if (!search.canStart) break;
      search.feed(r);
    }
  }
  onSearch?.(infoOf(search, plan, Date.now() - t0, parallelism));
  return plan.env.legal[search.best()];
}

/**
 * クロス済みのクロスギアを、別のクリーチャーにクロスし直す手を、探索の候補から外す(L19: 再クロスは規則上できるが、
 * 「クロスのコストが 0」になるカード(freeCross)があると、評価が同じ手を毎回選び続けて、ターンが終わらず試合が止まらなくなる)。
 * ルールベースは、最初のクロスしかしない(rulebased.ts)。
 */
export function dropRecross(view: { pending?: { player: number } | null; players: { battle: { pid: number; crossedOn?: number }[] }[] }, legal: Action[]): Action[] {
  const me = view.pending?.player;
  if (me === undefined) return legal;
  const crossed = new Set(view.players[me].battle.filter((x) => x.crossedOn !== undefined).map((x) => x.pid));
  if (crossed.size === 0) return legal;
  const out = legal.filter((a) => !(a.type === 'CROSS' && crossed.has(a.gear)));
  return out.length > 0 ? out : legal;
}

export function makeMcts(o: MctsOpts = {}): Agent {
  const policy = o.policy ?? FAIR;
  const l1 = makeRuleBased({ policy, candidateDecks: o.candidateDecks });
  return {
    name: 'モンテカルロ',
    policy,
    chooseAction(view, legal, ctx: AgentCtx) {
      legal = dropRecross(view, legal);
      if (legal.length === 1) return legal[0];
      return runSearch(planSearch(view, legal, ctx, o, l1), ctx.reg, o.onSearch);
    },
  };
}
