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
import { reward, withWeights, type RewardWeights } from './eval';
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
  /** L1 の手に与える事前の上乗せ(報酬の単位) */
  priorBonus?: number;
  /** 評価関数の重み(差し替える分だけ指定) */
  weights?: Partial<RewardWeights>;
  /** 指定すると、ラウンドの評価を「根はペア比較・2手目以降は木」にする(tree.ts の PairedTree)。Worker にも env 経由で伝わる */
  tree?: TreeOpts;
  /** 1回の探索が終わるたびに呼ばれる(計測・表示用) */
  onSearch?: (info: SearchInfo) => void;
}

/** プレイアウト用の素早い方針: ターン中の行動は L1 の手順、効果の選択は軽い規則 */
export function rolloutPick(s: GameState, legal: Action[], reg: Registry, rand: () => number): Action {
  const p = s.pending!;
  if (p.why === 'turnAction') return chooseTurnAction(s, legal, { reg, rand });
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
      return yes && rand() < 0.75 ? yes : pick(legal);
    }
    case 'block': {
      // 半分はブロックする
      const blocks = legal.filter((a) => a.type === 'ANSWER' && Array.isArray(a.value) && a.value.length > 0);
      return blocks.length && rand() < 0.5 ? pick(blocks) : legal[0];
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
export function pairedVerdict(n: number, dsum: number, dsq: number, bonusGap: number): 'ahead' | 'precise' | 'open' {
  if (n < MIN_ROUNDS) return 'open';
  const mean = dsum / n;
  const se = Math.sqrt(Math.max(0.0025, dsq / n - mean * mean) / n);
  if (mean + bonusGap > 2.5 * se) return 'ahead';
  if (2.5 * se < 0.012) return 'precise';
  return 'open';
}

/** プレイアウトの乱数(1ラウンド内の全候補手で同じ列にするため、シードから作る) */
export function seededRand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rollout(start: GameState, reg: Registry, me: PlayerId, rand: () => number, horizon: number, w: RewardWeights): number {
  let s = start;
  const endTurn = s.turn + horizon;
  let guard = 0;
  while (s.winner === null && s.turn < endTurn && guard++ < MAX_ROLLOUT_STEPS) {
    const legal = legalActions(s, reg);
    if (legal.length === 0) break;
    const a = rolloutPick(s, legal, reg, rand);
    s = step(s, a, reg).state;
  }
  return reward(s, reg, me, w);
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

/**
 * 1ラウンド: 種から世界を1つ作り、alive の手を同じ世界・同じ乱数で評価する。
 * 戻り値は手ごとの報酬(alive でない手・例外を出した手は NaN)。純関数なので、どの Worker で評価しても同じ。
 */
export function evalRound(env: SearchEnv, reg: Registry, seed: number, alive: number[]): number[] {
  if (native) {
    try {
      return native(env, seed, alive);
    } catch {
      // 外部の評価器(Rust 版)が使えない入力の時は、TS 版で評価する
    }
  }
  const rr = seededRand(seed);
  const det = determinize(env.view, env.me, { rand: rr, reg, policy: env.policy, candidateDecks: env.candidateDecks });
  const rolloutSeed = Math.floor(rr() * 0x7fffffff);
  const w = withWeights(env.weights);
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

  constructor(
    readonly n: number,
    readonly baseIdx: number,
    readonly prior: number,
    /** プレイアウト回数の上限 */
    readonly maxIt: number,
    /** 時間主導か(true の時だけ、判定できる精度に達したら早期終了する) */
    readonly timeDriven: boolean,
  ) {
    this.alive = Array.from({ length: n }, (_, i) => i);
    this.sum = new Array(n).fill(0);
    this.sq = new Array(n).fill(0);
    this.cross = Array.from({ length: n }, () => new Array(n).fill(0));
    this.bonus = new Array(n).fill(0);
    this.bonus[baseIdx] = prior;
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
    return pairedVerdict(this.rounds, dsum, dsq, this.bonus[a] - this.bonus[b]);
  }

  /** 次のラウンドの結果を反映する(alive でない手の値は無視する) */
  feed(r: number[]): void {
    if (!this.canStart) return;
    this.it += this.alive.length;
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
    // 時間主導の時は、1位と2位が判定できる精度に達していれば打ち切る
    if (this.timeDriven && this.rounds % 4 === 0) {
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
    env: { view, legal, me: view.pending!.player, policy, candidateDecks: o.candidateDecks, horizon: o.horizonTurns ?? 3, weights: o.weights, tree: o.tree },
    baseIdx,
    prior: o.priorBonus ?? 0.005,
    maxIt: timeDriven ? HARD_MAX_ITERATIONS : Math.max(iterations!, n),
    ms,
    timeDriven,
    base: Math.floor(ctx.rand() * 0x7fffffff),
  };
}

const newSearch = (p: SearchPlan) => new MctsSearch(p.env.legal.length, p.baseIdx, p.prior, p.maxIt, p.timeDriven);

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
    const seed = roundSeed(plan.base, search.rounds);
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
    const seeds = Array.from({ length: room }, (_, i) => roundSeed(plan.base, search.rounds + i));
    const rows = await dispatch(seeds, search.alive.slice());
    for (const r of rows) {
      if (!search.canStart) break;
      search.feed(r);
    }
  }
  onSearch?.(infoOf(search, plan, Date.now() - t0, parallelism));
  return plan.env.legal[search.best()];
}

export function makeMcts(o: MctsOpts = {}): Agent {
  const policy = o.policy ?? FAIR;
  const l1 = makeRuleBased({ policy, candidateDecks: o.candidateDecks });
  return {
    name: 'モンテカルロ',
    policy,
    chooseAction(view, legal, ctx: AgentCtx) {
      if (legal.length === 1) return legal[0];
      return runSearch(planSearch(view, legal, ctx, o, l1), ctx.reg, o.onSearch);
    },
  };
}
