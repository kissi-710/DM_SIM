// ターン内の行動列を木にする探索(docs/ai-quality-plan.md §4.3)。決定化つき UCT(単一観測者 ISMCTS)。
// 木に入れるのは「自分が答える入力待ち」(ターン中の行動・そのターンの質問)で、ターンが変わった所から先はプレイアウト
// (L1 の方針・ホライズンまで)。合法手が1つの入力待ちは木の段にせず、そのまま進める。
// 2種類の使い方:
//  - treeSearch(algo=tree): 反復ごとに世界を1つ決定化し、根から UCB で木を下る(標準の ISMCTS)。
//  - PairedTree(algo=ptree): 平坦なモンテカルロの「ペア比較」(全候補手を同じ世界・同じ乱数で評価し、劣る手を外す)を
//    根に残し、各候補手の下(2手目以降)だけを木にする。世界のばらつきを根で打ち消しつつ、続きの手を探索で選ぶ。
// Rust 版(rust/src/ai.rs の Tree)と、同じ乱数の使い方・同じ選び方にする(差分テストで固定)。
import { legalActions, step } from '../engine/engine';
import type { Registry } from '../engine/registry';
import type { Action, GameState, PlayerId } from '../engine/types';
import { FAIR } from '../engine/view';
import { determinize } from './determinize';
import { withWeights } from './eval';
import { HARD_MAX_ITERATIONS, nativeUnsupported, planSearch, rollout, roundSeed, runSearch, seededRand, worldSeed, type MctsOpts, type SearchEnv, type TreeOpts } from './mcts';
export type { TreeOpts } from './mcts';
import { chooseTurnAction, makeRuleBased } from './rulebased';
import type { Agent, AgentCtx } from './types';

export const DEFAULT_TREE_OPTS: TreeOpts = { c: 0.1, maxDepth: 24 };

interface TNode {
  keys: string[];
  acts: Action[];
  n: number[];
  w: number[];
  avail: number[];
  kids: (TNode | null)[];
}
const newNode = (): TNode => ({ keys: [], acts: [], n: [], w: [], avail: [], kids: [] });
const keyOf = (a: Action) => JSON.stringify(a);

function rootNode(legal: Action[]): TNode {
  const root = newNode();
  for (const a of legal) {
    root.keys.push(keyOf(a));
    root.acts.push(a);
    root.n.push(0);
    root.w.push(0);
    root.avail.push(0);
    root.kids.push(null);
  }
  return root;
}

/**
 * 木を下る。node は state の入力待ちに対応する節で、depth は根からの段数(根 = 0)。
 * 展開するか、自分の入力待ちでなくなるか、深さの上限で止まる。通った辺を path に積み、止まった時の状態を返す。
 */
function descend(env: SearchEnv, reg: Registry, o: TreeOpts, start: GameState, startNode: TNode, startDepth: number, path: [TNode, number][]): GameState {
  const me: PlayerId = env.me;
  const rootTurn = env.view.turn;
  let state = start;
  let node = startNode;
  let depth = startDepth;
  for (;;) {
    const p = state.pending;
    if (state.winner !== null || !p || p.player !== me || state.turn !== rootTurn || depth >= o.maxDepth) break;
    const legal = depth === 0 ? env.legal : legalActions(state, reg);
    if (legal.length === 0) break;
    if (legal.length === 1) {
      state = step(state, legal[0], reg).state;
      depth++;
      continue;
    }
    // この世界で選べる手のうち、木にあるものは「選べた回数」を数える
    const idxs = legal.map((a) => node.keys.indexOf(keyOf(a)));
    for (const i of idxs) if (i >= 0) node.avail[i]++;
    // 未訪問の手があれば、1つ展開する(L1 の手を先に。無ければ並びの先頭)。無ければ UCB
    const untried: number[] = [];
    legal.forEach((_, j) => {
      if (idxs[j] < 0 || node.n[idxs[j]] === 0) untried.push(j);
    });
    let chosen: number; // legal の添字
    const expand = untried.length > 0;
    if (expand) {
      chosen = untried[0];
      if (p.why === 'turnAction') {
        const l1 = chooseTurnAction(state, legal, { reg, rand: () => 0 });
        const j = legal.findIndex((a) => keyOf(a) === keyOf(l1));
        if (j >= 0 && untried.includes(j)) chosen = j;
      }
    } else {
      // UCB(選べた回数で割る)。同点は並びの先頭
      let best = 0;
      let bs = -Infinity;
      legal.forEach((_, j) => {
        const i = idxs[j];
        const s = node.w[i] / node.n[i] + o.c * Math.sqrt(Math.log(Math.max(1, node.avail[i])) / node.n[i]);
        if (s > bs) {
          bs = s;
          best = j;
        }
      });
      chosen = best;
    }
    let ci = idxs[chosen];
    if (ci < 0) {
      ci = node.keys.length;
      node.keys.push(keyOf(legal[chosen]));
      node.acts.push(legal[chosen]);
      node.n.push(0);
      node.w.push(0);
      node.avail.push(1);
      node.kids.push(null);
    }
    path.push([node, ci]);
    state = step(state, legal[chosen], reg).state;
    depth++;
    if (expand) break;
    node = node.kids[ci] ?? (node.kids[ci] = newNode());
  }
  return state;
}

/** 木の統計: 根の手(env.legal の添字)ごとの訪問回数と報酬の合計 */
export interface TreeStats {
  visits: number[];
  sums: number[];
}

/** 外部の実装(Rust 版)に差し替える関数。同じ入力・同じ結果を返す。同じ env・種・設定の間は、木を保って続きから反復する */
export type NativeTree = (env: SearchEnv, base: number, iterations: number, o: TreeOpts) => TreeStats;
let native: NativeTree | null = null;
export function setNativeTree(f: NativeTree | null): void {
  native = f;
}

/** ペア比較の木の1ラウンドを行う関数(Rust 版)。同じ env・設定の間は、木を保つ。手ごとの報酬(評価できない手は NaN) */
export type NativePairedRound = (env: SearchEnv, seed: number, alive: number[], o: TreeOpts) => number[];
let nativePaired: NativePairedRound | null = null;
export function setNativePairedRound(f: NativePairedRound | null): void {
  nativePaired = f;
}

/** 標準の ISMCTS: 反復 [0, iterations) を行い、根の統計を返す(TS 基準)。木は呼び出しごとに作り直す(同じ引数なら同じ結果) */
export function treeSearch(env: SearchEnv, reg: Registry, base: number, iterations: number, o: TreeOpts = DEFAULT_TREE_OPTS): TreeStats {
  if (native && !nativeUnsupported(env.weights)) {
    try {
      return native(env, base, iterations, o);
    } catch {
      // Rust 版が使えない入力の時は TS 版で行う
    }
  }
  const w = withWeights(env.weights);
  const root = rootNode(env.legal);
  const endTurn = env.view.turn + env.horizon;
  for (let it = 0; it < iterations; it++) {
    const rr = seededRand(roundSeed(base, it));
    const det = determinize(env.view, env.me, { rand: rr, reg, policy: env.policy, candidateDecks: env.candidateDecks });
    const rolloutSeed = Math.floor(rr() * 0x7fffffff);
    const path: [TNode, number][] = [];
    try {
      const state = descend(env, reg, o, det, root, 0, path);
      const r = rollout(state, reg, env.me, seededRand(rolloutSeed), Math.max(0, endTurn - state.turn), w);
      for (const [nd, i] of path) {
        nd.n[i]++;
        nd.w[i] += r;
      }
    } catch {
      // エンジンの例外は、その反復を捨てる(経路の統計は更新しない)
    }
  }
  return { visits: env.legal.map((_, i) => root.n[i]), sums: env.legal.map((_, i) => root.w[i]) };
}

/** 根の統計から選ぶ手: 訪問回数が最多(同数なら平均の高い方、さらに L1 の手(baseIdx)を優先) */
export function bestFromStats(st: TreeStats, baseIdx: number): number {
  let best = -1;
  for (let i = 0; i < st.visits.length; i++) {
    if (best < 0) {
      best = i;
      continue;
    }
    const vi = st.visits[i];
    const vb = st.visits[best];
    if (vi > vb) best = i;
    else if (vi === vb && vi > 0) {
      const mi = st.sums[i] / vi;
      const mb = st.sums[best] / vb;
      if (mi > mb || (mi === mb && i === baseIdx)) best = i;
    }
  }
  return best < 0 ? baseIdx : best;
}

/**
 * ペア比較の木: ラウンドごとに世界を1つ決定化し、alive の根の手それぞれについて、その手を指した後の木(2手目以降)を
 * 1回下ってプレイアウトする。全候補手が同じ世界・同じプレイアウトの乱数で評価されるので、手の差が世界のばらつきに埋もれない。
 */
export class PairedTree {
  private root: TNode;
  private w: ReturnType<typeof withWeights>;
  private endTurn: number;
  constructor(
    readonly env: SearchEnv,
    readonly reg: Registry,
    readonly o: TreeOpts = DEFAULT_TREE_OPTS,
  ) {
    this.root = rootNode(env.legal);
    this.w = withWeights(env.weights);
    this.endTurn = env.view.turn + env.horizon;
  }

  /** 1ラウンド。手ごとの報酬(alive でない手・例外を出した手は NaN) */
  round(seed: number, alive: number[]): number[] {
    if (nativePaired && !nativeUnsupported(this.env.weights)) {
      try {
        return nativePaired(this.env, seed, alive, this.o);
      } catch {
        // Rust 版が使えない入力の時は TS 版で行う
      }
    }
    const { env, reg, o } = this;
    const [ws, wa] = worldSeed(seed, (this.w.anti ?? 0) > 0);
    const rr = seededRand(ws, wa);
    const det = determinize(env.view, env.me, { rand: rr, reg, policy: env.policy, candidateDecks: env.candidateDecks });
    const rolloutSeed = Math.floor(rr() * 0x7fffffff);
    const out = new Array<number>(env.legal.length).fill(NaN);
    for (const k of alive) {
      try {
        const child = this.root.kids[k] ?? (this.root.kids[k] = newNode());
        let state = step(det, env.legal[k], reg).state;
        const path: [TNode, number][] = [];
        state = descend(env, reg, o, state, child, 1, path);
        const r = rollout(state, reg, env.me, seededRand(rolloutSeed), Math.max(0, this.endTurn - state.turn), this.w);
        for (const [nd, i] of path) {
          nd.n[i]++;
          nd.w[i] += r;
        }
        this.root.n[k]++;
        this.root.w[k] += r;
        out[k] = r;
      } catch {
        // エンジンの例外は、その手を候補から外す(MctsSearch が NaN を見て外す)
      }
    }
    return out;
  }
}

/** ターン内の行動列を木にする探索の AI(makeMcts の木版)。反復回数が決まっていれば、それだけ行う(時間に左右されない) */
export function makeTreeMcts(o: MctsOpts & Partial<TreeOpts> & { paired?: boolean } = {}): Agent {
  const policy = o.policy ?? FAIR;
  const l1 = makeRuleBased({ policy, candidateDecks: o.candidateDecks });
  const topts: TreeOpts = { c: o.c ?? DEFAULT_TREE_OPTS.c, maxDepth: o.maxDepth ?? DEFAULT_TREE_OPTS.maxDepth };
  // 木のペア比較は、env に設定を載せて評価側(Worker など)にも伝える
  if (o.paired) o = { ...o, tree: topts };
  return {
    name: o.paired ? 'モンテカルロ(木・ペア比較)' : 'モンテカルロ(木)',
    policy,
    chooseAction(view, legal, ctx: AgentCtx) {
      if (legal.length === 1) return legal[0];
      const plan = planSearch(view, legal, ctx, o, l1);
      if (o.paired) {
        const tree = new PairedTree(plan.env, ctx.reg, topts);
        return runSearch(plan, ctx.reg, o.onSearch, (seed, alive) => tree.round(seed, alive));
      }
      const t0 = Date.now();
      let st: TreeStats;
      if (!plan.timeDriven) {
        st = treeSearch(plan.env, ctx.reg, plan.base, plan.maxIt, topts);
      } else {
        // 時間主導: 反復を倍々にして、時間が半分を超えるまで続ける(同じ種の列の先頭が共通なので、結果は前の続き)
        let n = 64;
        st = treeSearch(plan.env, ctx.reg, plan.base, n, topts);
        while (Date.now() - t0 < plan.ms / 2 && n < HARD_MAX_ITERATIONS) {
          n *= 2;
          st = treeSearch(plan.env, ctx.reg, plan.base, n, topts);
        }
      }
      o.onSearch?.({ iterations: st.visits.reduce((a, b) => a + b, 0), ms: Date.now() - t0, timeDriven: plan.timeDriven, decided: false, arms: legal.length });
      return legal[bestFromStats(st, plan.baseIdx)];
    },
  };
}
