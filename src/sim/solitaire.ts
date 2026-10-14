// ソリティア調査(design 8.2): 相手が何もしない1人回しで、カード効果込みでゲームを進める。
//  - 確率調査: 方針プレイ(自動プレイAI)の達成率と、探索による上限(山札の並びと、シャッフル・ランダム選択の結果まで知っていた場合。
//    行動の順序で乱数の進みが変わるので、運のよい順序も選べる。現実の打ち方より楽観的な上限)
//  - パターン調査: 目標を達成する使用履歴を探索で集めてまとめる
import { makeAgent, type AgentSpec } from '../ai';
import { createGame, legalActions, registryOf, step } from '../engine/engine';
import type { Registry } from '../engine/registry';
import { hashSeed } from '../engine/state';
import type { Action, CardDB, Ev, GameState } from '../engine/types';
import { FAIR, toPlayerView } from '../engine/view';
import { FAR, goalDistance, goalHasNot, goalMaxTurn, GoalTracker, myTurnNo, nameMatches, type Goal } from './goal';
import { deriveSeed } from '../engine/prng';
import { mulberry } from './playGame';
import { hypergeomAtLeast, wilson } from './stats';

// ───────────────────────── 入力 ─────────────────────────

export interface InitialCond {
  /** 初手に必ず含めるカード(名前またはID) */
  mustHand?: string[];
  /** 初手に含めないカード */
  mustNotHand?: string[];
  /** 山札の上の固定(先頭が最初に引くカード) */
  topFixed?: string[];
}

export interface SolitaireParams {
  deck: string[];
  /** 0 = 先攻 / 1 = 後攻(先攻の1ターン目はドローしない) */
  first: 0 | 1;
  goal: Goal;
  /** 試行の通し番号の開始位置(範囲を分けて並列に実行する時に、同じ試行が同じシードになるようにする。既定 0) */
  startIndex?: number;
  /** 調べるターン数の上限(省略時は目標に含まれる最大ターン) */
  maxTurns?: number;
  trials: number;
  seed: number;
  initial?: InitialCond;
  /** 方針プレイのAI(既定はルールベース) */
  agent?: AgentSpec;
  /** 探索の上限(ノード数)。0 なら探索しない */
  maxNodes?: number;
  /** 構築制限を検査しない(自由モード) */
  free?: boolean;
}

// ───────────────────────── 並びの作成 ─────────────────────────

function resolveOne(reg: Registry, n: string): string | undefined {
  if (reg.defs[n]) return n;
  const hit =
    Object.values(reg.defs).find((d) => d.name === n || d.faces.some((f) => f.name === n)) ??
    Object.values(reg.defs).find((d) => d.id !== '?' && d.faces.some((f) => nameMatches(d, f.name, n)));
  return hit?.id;
}

function resolveIds(reg: Registry, names: string[] | undefined): string[] {
  const out: string[] = [];
  for (const n of names ?? []) {
    const id = resolveOne(reg, n);
    if (id) out.push(id);
  }
  return out;
}

/**
 * 初期条件のうち、効かないもの(該当するカードがない / このデッキに入っていない)を日本語で返す。
 * arrangeDeck は効かない名前を無視する(落ちない)ので、入力画面・CLI がこれで利用者に知らせる。
 */
export function initialProblems(reg: Registry, deck: string[], init: InitialCond = {}): string[] {
  const out: string[] = [];
  const labels: [keyof InitialCond, string][] = [
    ['mustHand', '初手に含める'],
    ['mustNotHand', '初手に含めない'],
    ['topFixed', '山札の上に固定'],
  ];
  for (const [key, label] of labels) {
    for (const n of init[key] ?? []) {
      const id = resolveOne(reg, n);
      if (!id) out.push(`${label}: 「${n}」に一致するカードがありません`);
      else if (!deck.includes(id)) out.push(`${label}: 「${n}」はこのデッキに入っていません`);
    }
  }
  return out;
}

/** 初期条件を満たす山札の並び(先頭から シールド5・手札5・残り)を作る */
export function arrangeDeck(reg: Registry, deck: string[], seed: number, init: InitialCond = {}): string[] {
  const rand = mulberry(hashSeed(seed) ^ 0x51ed270b);
  const pool = deck.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const must = resolveIds(reg, init.mustHand);
  const banned = new Set(resolveIds(reg, init.mustNotHand));
  const hand: string[] = [];
  for (const m of must) {
    const i = pool.indexOf(m);
    if (i >= 0) hand.push(...pool.splice(i, 1));
  }
  // 手札の残りは、除外カード以外から
  for (let i = 0; i < pool.length && hand.length < 5; ) {
    if (banned.has(pool[i])) i++;
    else hand.push(...pool.splice(i, 1));
  }
  while (hand.length < 5 && pool.length) hand.push(pool.shift()!);
  const shield = pool.splice(0, 5);
  const top = resolveIds(reg, init.topFixed);
  const topCards: string[] = [];
  for (const t of top) {
    const i = pool.indexOf(t);
    if (i >= 0) topCards.push(...pool.splice(i, 1));
  }
  // 山札の並び: シールド → 手札 → 固定した上 → 残り
  return [...shield, ...hand, ...topCards, ...pool];
}

export function buildGame(reg: Registry, p: SolitaireParams, trialSeed: number): GameState {
  const order = arrangeDeck(reg, p.deck, trialSeed, p.initial);
  const dummy = Array(40).fill('dummy');
  const { state } = createGame(reg, {
    decks: [order, dummy],
    seed: trialSeed,
    first: p.first,
    shuffle: [false, false],
    cfg: { solitaire: true, turnLimit: 100 },
    strict: false,
  });
  return state;
}

// ───────────────────────── 方針プレイ ─────────────────────────

export interface TrialRun {
  tracker: GoalTracker;
  actions: Action[];
  achievedTurn: number | null;
}

function lastEngineTurn(first: 0 | 1, maxTurns: number): number {
  return first === 0 ? 2 * maxTurns - 1 : 2 * maxTurns;
}

export function runPolicyTrial(reg: Registry, p: SolitaireParams, trialSeed: number): TrialRun {
  const maxTurns = p.maxTurns ?? goalMaxTurn(p.goal);
  let s = buildGame(reg, p, trialSeed);
  const tracker = new GoalTracker(p.goal, reg);
  tracker.observeInitial(s);
  const agent = makeAgent(p.agent ?? { kind: 'rule' });
  const rand = mulberry(hashSeed(trialSeed) ^ 0xabcdef);
  const actions: Action[] = [];
  const endTurn = lastEngineTurn(p.first, maxTurns);
  let guard = 0;
  while (s.winner === null && s.turn <= endTurn && guard++ < 3000) {
    const legal = legalActions(s, reg).filter((a) => a.type !== 'ATTACK');
    if (legal.length === 0) break;
    const mt = myTurnNo(s);
    if (s.pending?.why === 'turnAction' && mt !== null) tracker.observeState(s, legal);
    const who = s.pending!.player;
    const view = agent.needsView === false ? s : toPlayerView(s, who, agent.policy ?? FAIR, reg);
    const a = agent.chooseAction(view, legal, { rand, reg }) as Action;
    const r = step(s, a, reg);
    tracker.observeStep(s, a, r.events);
    tracker.observeEvents(r.state, r.events, mt);
    actions.push(a);
    s = r.state;
  }
  return { tracker, actions, achievedTurn: tracker.achievedTurn(maxTurns) };
}

// ───────────────────────── 探索 ─────────────────────────

export type HistoryStep = { turn: number; kind: 'charge' | 'play' | 'choice'; name: string; detail?: string };

export interface SearchResult {
  /** 目標に到達できる打ち方が見つかったか */
  found: boolean;
  /** ノード数の上限に達して、判定できなかった */
  unknown: boolean;
  nodes: number;
  /** 見つかった履歴(重複を除いて上限まで) */
  histories: { steps: HistoryStep[]; actions: Action[] }[];
}

function stateKey(s: GameState): string {
  const z = s.players[0];
  const def = (u: number) => s.cards[u].defId;
  const parts: (string | number)[] = [s.turn, s.step, s.manaCharged ? 1 : 0];
  parts.push(z.deck.map(def).join(','));
  parts.push(z.hand.map(def).sort().join(','));
  parts.push(z.mana.map((u) => def(u) + (s.cards[u].tapped ? 't' : '')).sort().join(','));
  parts.push(
    z.battle
      .map((b) => b.cards.map(def).join('+') + (b.tapped ? 'T' : '') + (b.sick ? 's' : ''))
      .sort()
      .join(','),
  );
  parts.push(z.grave.map(def).sort().join(','));
  parts.push(z.shield.map(def).sort().join(','));
  parts.push(s.effects.length);
  if (s.pending && s.pending.why !== 'turnAction') {
    parts.push(JSON.stringify(s.cont.map((f) => (f.kind === 'effect' ? [f.ability, f.pc, f.vars] : [f.name, f.stage, f.vars]))));
    parts.push(JSON.stringify(s.pending.input));
    parts.push(JSON.stringify(s.pool.map((e) => [e.ability, e.kind])));
  }
  return parts.join('|');
}

/** 探索の順序: 先に進む手(マナチャージ → コストの大きい使用)を優先し、パスは最後に試す */
function orderForSearch(reg: Registry, s: GameState, legal: Action[]): Action[] {
  const score = (a: Action): number => {
    switch (a.type) {
      case 'CHARGE_MANA':
        return 100 - reg.defs[s.cards[a.uid].defId].faces[0].cost;
      case 'PLAY_CARD': {
        const f = reg.defs[s.cards[a.uid].defId].faces[a.face ?? 0];
        return 200 + f.cost + (f.type !== 'spell' ? 0.5 : 0);
      }
      case 'ANSWER':
        return 150;
      case 'SKIP_MANA':
        return 10;
      default:
        return 0;
    }
  };
  return legal.slice().sort((a, b) => score(b) - score(a));
}

function describeAction(reg: Registry, s: GameState, a: Action): HistoryStep | null {
  const mt = myTurnNo(s) ?? Math.ceil(s.turn / 2);
  const nameOf = (u: number) => reg.defs[s.cards[u].defId].name;
  switch (a.type) {
    case 'CHARGE_MANA':
      return { turn: mt, kind: 'charge', name: nameOf(a.uid) };
    case 'SKIP_MANA':
      return null;
    case 'PLAY_CARD': {
      const def = reg.defs[s.cards[a.uid].defId];
      const fi = a.face ?? 0;
      const face = def.faces[fi] ?? def.faces[0];
      const from = a.from && a.from !== 'hand' ? `(${a.from === 'mana' ? 'マナから' : '墓地から'})` : '';
      return { turn: mt, kind: 'play', name: face.name + from };
    }
    case 'ANSWER': {
      const p = s.pending;
      if (!p || !p.input) return null;
      const inp = p.input;
      const src = p.source ? nameOf(p.source.uid) : '';
      let detail: string;
      if (inp.shape === 'yesno') detail = a.value ? 'はい' : 'いいえ';
      else if (inp.shape === 'option') detail = (a.value as number[]).map((i) => inp.options[i]).join(' + ');
      else if (inp.shape === 'pick') detail = (a.value as number[]).map(nameOf).join(', ') || 'なし';
      else if (inp.shape === 'assign') {
        const m = a.value as Record<string, number[]>;
        detail = Object.entries(m)
          .map(([k, v]) => `${inp.slots.find((x) => x.id === k)?.label ?? k}:${v.map(nameOf).join(',')}`)
          .join(' / ');
      } else return null;
      return { turn: mt, kind: 'choice', name: src, detail };
    }
    default:
      return null;
  }
}

export function searchTrial(reg: Registry, p: SolitaireParams, trialSeed: number, maxHistories = 1): SearchResult {
  const maxTurns = p.maxTurns ?? goalMaxTurn(p.goal);
  const maxNodes = p.maxNodes ?? 8000;
  const endTurn = lastEngineTurn(p.first, maxTurns);
  const hasNot = goalHasNot(p.goal);
  const s0 = buildGame(reg, p, trialSeed);
  const t0 = new GoalTracker(p.goal, reg);
  t0.observeInitial(s0);
  const visited = new Set<string>();
  const result: SearchResult = { found: false, unknown: false, nodes: 0, histories: [] };
  const seenKeys = new Set<string>();
  const path: Action[] = [];
  const steps: HistoryStep[] = [];

  const record = () => {
    const key = steps.map((x) => `${x.turn}:${x.kind}:${x.name}`).join('>');
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    result.histories.push({ steps: steps.slice(), actions: path.slice() });
  };

  // 限定食い違い探索(LDS): 目標に近い順の第1候補から外れる回数(disc)の上限を 0, 1, 2… と増やして探索する。
  // 少ない食い違いで届く解を先に見つけられ、上限で枝を切らずに終われば全探索(= 届かないと確定)になる。
  let prunedByDisc: boolean;

  const explore = (s: GameState, tr: GoalTracker, disc: number): boolean => {
    // true を返したら、探索を打ち切る(必要な履歴が集まった)
    if (result.nodes++ > maxNodes) {
      result.unknown = true;
      return true;
    }
    if (s.winner !== null || s.turn > endTurn) {
      if (tr.holds()) {
        result.found = true;
        record();
        return result.histories.length >= maxHistories;
      }
      return false;
    }
    const legalAll = legalActions(s, reg).filter((a) => a.type !== 'ATTACK');
    if (legalAll.length === 0) return false;
    if (s.pending?.why === 'turnAction') tr.observeState(s, legalAll);
    // メインの終わりは END_TURN に一本化(攻撃しないので END_MAIN は同じ結果)
    const legal = orderForSearch(reg, s, legalAll.filter((a) => a.type !== 'END_MAIN'));
    // 単調な目標なら、成立した時点で成功
    if (!hasNot && tr.holds()) {
      result.found = true;
      record();
      return result.histories.length >= maxHistories;
    }
    const key = stateKey(s) + '#' + tr.signature() + '@' + disc;
    if (visited.has(key)) return false;
    visited.add(key);
    const mt = myTurnNo(s);
    // 子の状態を先に作り、目標に近い順に探索する。期限切れ・必要なカードが無い枝は探索しない(足切り)
    type Child = { a: Action; r: { state: GameState; events: Ev[] }; t2: GoalTracker; h: number; i: number };
    const children: Child[] = [];
    legal.forEach((a, i) => {
      const r = step(s, a, reg);
      const t2 = tr.clone();
      t2.observeStep(s, a, r.events);
      t2.observeEvents(r.state, r.events, mt);
      if (r.state.winner === null && r.state.turn <= endTurn) {
        if (!t2.possible(Math.ceil(r.state.turn / 2))) return;
        const h = goalDistance(reg, r.state, p.goal, t2);
        if (h >= FAR) return;
        children.push({ a, r, t2, h, i });
      } else children.push({ a, r, t2, h: 0, i });
    });
    children.sort((x, y) => x.h - y.h || x.i - y.i);
    for (let j = 0; j < children.length; j++) {
      const { a, r, t2 } = children[j];
      const cost = j === 0 ? 0 : 1;
      if (disc < cost) {
        prunedByDisc = true;
        continue;
      }
      const d = describeAction(reg, s, a);
      path.push(a);
      if (d) steps.push(d);
      const stop = explore(r.state, t2, disc - cost);
      path.pop();
      if (d) steps.pop();
      if (stop) return true;
    }
    return false;
  };
  for (let limit = 0; ; limit++) {
    visited.clear();
    prunedByDisc = false;
    if (explore(s0, t0, limit)) break; // 履歴が集まった、またはノード数の上限
    if (!prunedByDisc) break; // 枝を切らずに終わった = 全探索
  }
  return result;
}

// ───────────────────────── 確率調査 ─────────────────────────

export interface ProbResult {
  trials: number;
  maxTurns: number;
  policy: { achieved: number; rate: number; ci95: [number, number]; byTurn: number[]; turnDist: number[] };
  search?: {
    achieved: number;
    unknown: number;
    judged: number;
    rate: number;
    ci95: [number, number];
    avgNodes: number;
    /** 未判定を含めた最大値((達成 + 未判定) / 試行)。真の上限はこの範囲にある */
    maxRate: number;
  };
  /** 超幾何分布の厳密値(目標が「カードを引く」だけで書けるとき) */
  exact?: { value: number; note: string };
  ms: number;
}

/** 目標が「N枚以上引く」だけで書ける場合の厳密値 */
export function exactDrawProbability(reg: Registry, p: Pick<SolitaireParams, 'deck' | 'goal' | 'first' | 'initial'>): ProbResult['exact'] | undefined {
  // 初手の固定・除外・山札の上の固定があると、無作為な引きではなくなる(超幾何分布は当てはまらない)
  const init = p.initial;
  if (init && (init.mustHand?.length || init.mustNotHand?.length || init.topFixed?.length)) return undefined;
  const g = p.goal;
  if (g.op !== 'pred' || g.pred.kind !== 'zoneHas' || g.pred.zone !== 'hand') return undefined;
  // 「そのターンのメインで」「そのターンの終了時に」は、その時点で手札にあるかの判定。
  // マナチャージ・使用で手札から離れるので、「引いたかどうか」の超幾何分布は当てはまらない(大きく上にずれる)。
  if (g.timing.at !== 'opening' && g.timing.at !== 'byTurn') return undefined;
  const m = g.pred.card;
  const K = p.deck.filter((id) => {
    const def = reg.defs[id];
    const c = m;
    if (c.names?.length && !c.names.some((n) => def.faces.some((f) => nameMatches(def, f.name, n)))) return false;
    const f = def.faces[0];
    if (c.type && (c.type === 'creature') !== (f.type !== 'spell')) return false;
    if (c.civs?.length && !c.civs.some((x) => f.civs.includes(x))) return false;
    if (c.cost) {
      if (c.cost.eq !== undefined && f.cost !== c.cost.eq) return false;
      if (c.cost.gte !== undefined && f.cost < c.cost.gte) return false;
      if (c.cost.lte !== undefined && f.cost > c.cost.lte) return false;
    }
    return true;
  }).length;
  const N = p.deck.length;
  const T = g.timing.at === 'opening' ? 0 : g.timing.turn;
  const draws = g.timing.at === 'opening' ? 0 : p.first === 0 ? T - 1 : T;
  // シールド5枚が山札の上から取られる。手札は次の5枚+ドロー(山札全体からの無作為なので同じ分布)
  const n = 5 + Math.max(0, draws);
  const value = hypergeomAtLeast(N, K, n, g.pred.min ?? 1);
  const note =
    g.timing.at === 'opening'
      ? `初手${n}枚に ${K}/${N} 枚中 ${g.pred.min ?? 1} 枚以上`
      : `${T}ターン目までに ${n} 枚引いて、${K}/${N} 枚中 ${g.pred.min ?? 1} 枚以上(マナチャージ・使用で手札から離れない前提)`;
  return { value, note };
}

export function runProbability(
  db: CardDB | Registry,
  p: SolitaireParams,
  hooks: { onProgress?: (done: number, total: number) => void; shouldCancel?: () => boolean } = {},
): ProbResult {
  const reg = registryOf(db);
  const t0 = Date.now();
  const maxTurns = p.maxTurns ?? goalMaxTurn(p.goal);
  const byTurnHits = new Array(maxTurns + 1).fill(0);
  let achieved = 0;
  let sAchieved = 0;
  let sUnknown = 0;
  let sNodes = 0;
  let done = 0;
  const doSearch = (p.maxNodes ?? 0) > 0;
  for (let i = 0; i < p.trials; i++) {
    if (hooks.shouldCancel?.()) break;
    const seed = deriveSeed(p.seed, (p.startIndex ?? 0) + i);
    const run = runPolicyTrial(reg, p, seed);
    if (run.achievedTurn !== null) {
      achieved++;
      for (let t = run.achievedTurn; t <= maxTurns; t++) byTurnHits[t]++;
    }
    if (doSearch) {
      const sr = searchTrial(reg, p, seed, 1);
      sNodes += sr.nodes;
      if (sr.found) sAchieved++;
      else if (sr.unknown) sUnknown++;
    }
    done++;
    hooks.onProgress?.(done, p.trials);
  }
  const n = Math.max(1, done);
  const turnDist = byTurnHits.map((c, t) => (t === 0 ? c / n : (c - byTurnHits[t - 1]) / n));
  const judged = done - sUnknown;
  return {
    trials: done,
    maxTurns,
    policy: {
      achieved,
      rate: achieved / n,
      ci95: wilson(achieved, done),
      byTurn: byTurnHits.map((c) => c / n),
      turnDist,
    },
    search: doSearch
      ? {
          achieved: sAchieved,
          unknown: sUnknown,
          judged,
          rate: judged > 0 ? sAchieved / judged : 0,
          ci95: wilson(sAchieved, Math.max(1, judged)),
          avgNodes: sNodes / n,
          maxRate: (sAchieved + sUnknown) / n,
        }
      : undefined,
    exact: exactDrawProbability(reg, p),
    ms: Date.now() - t0,
  };
}

// ───────────────────────── パターン調査 ─────────────────────────

export type PatternGranularity = 'ordered' | 'set' | 'cards' | 'choices';

export interface Pattern {
  key: string;
  /** ターンごとの履歴(表示用) */
  turns: { turn: number; charge: string | null; plays: string[]; choices: string[] }[];
  /** そのパターンが(探索で)作れた試行の数 */
  count: number;
  ratioAll: number;
  ratioAchieved: number;
  /** 代表例(再生用) */
  sampleSeed: number;
  sampleActions: Action[];
  /** そのパターンが作れた試行で、初手に含まれていたカードの頻度 */
  handFreq: Record<string, number>;
}

export interface PatternResult {
  trials: number;
  achievedTrials: number;
  unknownTrials: number;
  patterns: Pattern[];
  ms: number;
}

function keyOf(steps: HistoryStep[], g: PatternGranularity): string {
  const byTurn = new Map<number, HistoryStep[]>();
  for (const s of steps) {
    const l = byTurn.get(s.turn) ?? [];
    l.push(s);
    byTurn.set(s.turn, l);
  }
  const turns = [...byTurn.keys()].sort((a, b) => a - b);
  if (g === 'cards') {
    const all = steps.filter((x) => x.kind === 'play').map((x) => x.name);
    return [...new Set(all)].sort().join(' + ');
  }
  return turns
    .map((t) => {
      const l = byTurn.get(t)!;
      const charge = l.find((x) => x.kind === 'charge')?.name ?? '-';
      let plays = l.filter((x) => x.kind === 'play').map((x) => x.name);
      if (g === 'set') plays = plays.slice().sort();
      let s = `T${t} マナ:${charge} 使用:${plays.join(',') || '-'}`;
      if (g === 'choices') {
        const ch = l.filter((x) => x.kind === 'choice').map((x) => `${x.name}[${x.detail}]`);
        if (ch.length) s += ` 選択:${ch.join(';')}`;
      }
      return s;
    })
    .join(' / ');
}

function turnsOf(steps: HistoryStep[]): Pattern['turns'] {
  const out = new Map<number, Pattern['turns'][number]>();
  for (const s of steps) {
    const t = out.get(s.turn) ?? { turn: s.turn, charge: null, plays: [], choices: [] };
    if (s.kind === 'charge') t.charge = s.name;
    else if (s.kind === 'play') t.plays.push(s.name);
    else t.choices.push(`${s.name}: ${s.detail}`);
    out.set(s.turn, t);
  }
  return [...out.values()].sort((a, b) => a.turn - b.turn);
}

export function runPatterns(
  db: CardDB | Registry,
  p: SolitaireParams,
  opts: { granularity?: PatternGranularity; maxHistoriesPerTrial?: number } = {},
  hooks: { onProgress?: (done: number, total: number) => void; shouldCancel?: () => boolean } = {},
): PatternResult {
  const reg = registryOf(db);
  const t0 = Date.now();
  const gran = opts.granularity ?? 'ordered';
  const per = opts.maxHistoriesPerTrial ?? 24;
  const map = new Map<string, Pattern & { hands: Map<string, number> }>();
  let achieved = 0;
  let unknown = 0;
  let done = 0;
  for (let i = 0; i < p.trials; i++) {
    if (hooks.shouldCancel?.()) break;
    const seed = deriveSeed(p.seed, (p.startIndex ?? 0) + i);
    const sr = searchTrial(reg, { ...p, maxNodes: p.maxNodes ?? 4000 }, seed, per);
    if (sr.found) achieved++;
    else if (sr.unknown) unknown++;
    if (sr.found) {
      const s0 = buildGame(reg, p, seed);
      const handNames = s0.players[0].hand.map((u) => reg.defs[s0.cards[u].defId].name);
      const seenInTrial = new Set<string>();
      for (const h of sr.histories) {
        const key = keyOf(h.steps, gran);
        if (seenInTrial.has(key)) continue;
        seenInTrial.add(key);
        let pat = map.get(key);
        if (!pat) {
          pat = {
            key,
            turns: turnsOf(h.steps),
            count: 0,
            ratioAll: 0,
            ratioAchieved: 0,
            sampleSeed: seed,
            sampleActions: h.actions,
            handFreq: {},
            hands: new Map(),
          };
          map.set(key, pat);
        }
        pat.count++;
        for (const n of new Set(handNames)) pat.hands.set(n, (pat.hands.get(n) ?? 0) + 1);
      }
    }
    done++;
    hooks.onProgress?.(done, p.trials);
  }
  const n = Math.max(1, done);
  const patterns: Pattern[] = [...map.values()]
    .map((x) => {
      const handFreq: Record<string, number> = {};
      for (const [k, v] of x.hands) handFreq[k] = v / x.count;
      return {
        key: x.key,
        turns: x.turns,
        count: x.count,
        ratioAll: x.count / n,
        ratioAchieved: achieved ? x.count / achieved : 0,
        sampleSeed: x.sampleSeed,
        sampleActions: x.sampleActions,
        handFreq,
      };
    })
    .sort((a, b) => b.count - a.count);
  return { trials: done, achievedTrials: achieved, unknownTrials: unknown, patterns, ms: Date.now() - t0 };
}

/** 代表例の再生: 各手のあとの状態を返す */
export function replayPattern(
  db: CardDB | Registry,
  p: SolitaireParams,
  seed: number,
  actions: Action[],
): { states: GameState[]; events: Ev[][] } {
  const reg = registryOf(db);
  let s = buildGame(reg, p, seed);
  const states: GameState[] = [s];
  const events: Ev[][] = [[]];
  for (const a of actions) {
    const r = step(s, a, reg);
    s = r.state;
    states.push(s);
    events.push(r.events);
  }
  return { states, events };
}
