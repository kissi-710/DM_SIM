// ソリティア調査の「目標(Goal)」: 条件ビルダーが組み立てる木構造(spec 6.3 / design 8.2)。
// JSON として保存・再利用できる。追跡器(GoalTracker)が、実行中に各述語の成立を記録する。
import { costOf, defaultPlayFace, manaCivs } from '../engine/derive';
import { legalActions } from '../engine/engine';
import type { Registry } from '../engine/registry';
import { mkCtx } from '../engine/state';
import type { Action, Civ, Ev, GameState } from '../engine/types';

export interface CardMatcher {
  /** カード名(面の名前でも可)のどれか */
  names?: string[];
  cost?: { eq?: number; gte?: number; lte?: number };
  /** 文明のどれかを持つ */
  civs?: Civ[];
  /** クリーチャー / 呪文 */
  type?: 'creature' | 'spell';
  /** ツインパクトの、使う面 */
  face?: 'creature' | 'spell';
  /** コストの数え方: 表記コスト / 軽減後の実コスト(spec Q11) */
  costBasis?: 'printed' | 'effective';
}

export type Predicate =
  | { kind: 'castable'; card: CardMatcher }
  | { kind: 'cast'; card: CardMatcher }
  | { kind: 'manaCount'; min: number; civ?: Civ }
  | { kind: 'zoneHas'; zone: 'hand' | 'mana' | 'grave' | 'battle' | 'shield'; card: CardMatcher; min?: number };

export interface Timing {
  turn: number;
  /** anyMain: Nターン目のメインのどこかで / turnEnd: Nターン目の終了時に / byTurn: Nターン目までに / opening: 初手(ゲーム開始時) */
  at: 'anyMain' | 'turnEnd' | 'byTurn' | 'opening';
}

export type Goal =
  | { op: 'and' | 'or'; args: Goal[] }
  | { op: 'not'; arg: Goal }
  | { op: 'pred'; timing: Timing; pred: Predicate };

/**
 * 目標(Goal)の形が正しいか。保存した設定・JSON の読み込みなど、信用できない入力を、使う前に確かめる。
 * 述語の中身(カードの条件の細部)までは見ないが、実行時に例外になる形(葉が無い・種類が不明・ターンが数でない)は断る。
 */
export function isGoal(x: unknown, depth = 0): x is Goal {
  if (!x || typeof x !== 'object' || depth > 20) return false;
  const g = x as Record<string, unknown>;
  if (g.op === 'and' || g.op === 'or') return Array.isArray(g.args) && g.args.length > 0 && g.args.every((a) => isGoal(a, depth + 1));
  if (g.op === 'not') return isGoal(g.arg, depth + 1);
  if (g.op !== 'pred') return false;
  const t = g.timing as Record<string, unknown> | undefined;
  if (!t || typeof t !== 'object' || typeof t.turn !== 'number' || !Number.isFinite(t.turn) || !['anyMain', 'turnEnd', 'byTurn', 'opening'].includes(t.at as string)) return false;
  const p = g.pred as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object') return false;
  if (p.kind === 'manaCount') return typeof p.min === 'number';
  if (p.kind === 'castable' || p.kind === 'cast') return !!p.card && typeof p.card === 'object';
  if (p.kind === 'zoneHas') return ['hand', 'mana', 'grave', 'battle', 'shield'].includes(p.zone as string) && !!p.card && typeof p.card === 'object';
  return false;
}

// ───────────────────────── 表示用 ─────────────────────────

export function describeMatcher(m: CardMatcher): string {
  const parts: string[] = [];
  if (m.names?.length) parts.push(m.names.join(' / '));
  if (m.cost) {
    const c = m.cost;
    if (c.eq !== undefined) parts.push(`コスト${c.eq}`);
    if (c.gte !== undefined) parts.push(`コスト${c.gte}以上`);
    if (c.lte !== undefined) parts.push(`コスト${c.lte}以下`);
  }
  if (m.civs?.length) parts.push(m.civs.map((c) => ({ light: '光', water: '水', darkness: '闇', fire: '火', nature: '自然' })[c]).join('/') + 'の');
  if (m.type) parts.push(m.type === 'creature' ? 'クリーチャー' : '呪文');
  if (m.face) parts.push(m.face === 'creature' ? '(クリーチャー面)' : '(呪文面)');
  if (m.costBasis === 'effective') parts.push('[実コスト]');
  return parts.length ? parts.join(' ') : '任意のカード';
}

export function describePredicate(p: Predicate): string {
  switch (p.kind) {
    case 'castable':
      return `${describeMatcher(p.card)} を使える`;
    case 'cast':
      return `${describeMatcher(p.card)} を使った`;
    case 'manaCount':
      return `${p.civ ? p.civ + 'の' : ''}マナが${p.min}枚以上`;
    case 'zoneHas': {
      const z = { hand: '手札', mana: 'マナゾーン', grave: '墓地', battle: 'バトルゾーン', shield: 'シールド' }[p.zone];
      return `${z}に ${describeMatcher(p.card)} が${p.min ?? 1}枚以上`;
    }
  }
}

export function describeTiming(t: Timing): string {
  switch (t.at) {
    case 'anyMain':
      return `${t.turn}ターン目のメインで`;
    case 'turnEnd':
      return `${t.turn}ターン目の終了時に`;
    case 'byTurn':
      return `${t.turn}ターン目までに`;
    case 'opening':
      return '初手に';
  }
}

export function describeGoal(g: Goal): string {
  switch (g.op) {
    case 'and':
      return g.args.map(describeGoal).join(' かつ ');
    case 'or':
      return '(' + g.args.map(describeGoal).join(' または ') + ')';
    case 'not':
      return `(${describeGoal(g.arg)} ではない)`;
    case 'pred':
      return `${describeTiming(g.timing)} ${describePredicate(g.pred)}`;
  }
}

/** 目標に含まれる最大のターン数 */
export function goalMaxTurn(g: Goal): number {
  switch (g.op) {
    case 'and':
    case 'or':
      return Math.max(1, ...g.args.map(goalMaxTurn));
    case 'not':
      return goalMaxTurn(g.arg);
    case 'pred':
      return g.timing.at === 'opening' ? 1 : g.timing.turn;
  }
}

export function goalHasNot(g: Goal): boolean {
  if (g.op === 'not') return true;
  if (g.op === 'and' || g.op === 'or') return g.args.some(goalHasNot);
  return false;
}

// ───────────────────────── カードの照合 ─────────────────────────

/** カード名の照合(完全一致、またはカード名・面の名前に含まれる) */
export function nameMatches(def: { id: string; name: string }, faceName: string, n: string): boolean {
  return n === def.id || n === def.name || n === faceName || def.name.includes(n) || faceName.includes(n);
}

// 面・実コストを指定しない照合は、カード定義(defId)だけで決まるので、(レジストリ, 条件, defId)ごとに結果を使い回す。
// 探索は、子の状態ごとに全カードを照合する(predicateDistance)ので、ここが繰り返し呼ばれる。
const matchCache = new WeakMap<Registry, WeakMap<CardMatcher, Map<string, boolean>>>();

/** カード(uid)の、指定した面(省略時は全面のどれか)が条件に合うか。cost は実コストを渡せる。 */
export function matchCard(reg: Registry, s: GameState, uid: number, m: CardMatcher, faceIdx?: number, effCost?: number): boolean {
  if (faceIdx !== undefined || effCost !== undefined) return matchCardRaw(reg, s, uid, m, faceIdx, effCost);
  const defId = s.cards[uid].defId;
  let byMatcher = matchCache.get(reg);
  if (!byMatcher) matchCache.set(reg, (byMatcher = new WeakMap()));
  let byDef = byMatcher.get(m);
  if (!byDef) byMatcher.set(m, (byDef = new Map()));
  let r = byDef.get(defId);
  if (r === undefined) byDef.set(defId, (r = matchCardRaw(reg, s, uid, m, undefined, undefined)));
  return r;
}

function matchCardRaw(reg: Registry, s: GameState, uid: number, m: CardMatcher, faceIdx?: number, effCost?: number): boolean {
  const def = reg.defs[s.cards[uid].defId];
  const faces = faceIdx === undefined ? def.faces.map((_, i) => i) : [faceIdx];
  return faces.some((fi) => {
    const f = def.faces[fi];
    if (!f) return false;
    if (m.names?.length && !m.names.some((n) => nameMatches(def, f.name, n))) return false;
    if (m.type) {
      const isCreature = f.type !== 'spell';
      if ((m.type === 'creature') !== isCreature) return false;
    }
    if (m.face) {
      const isCreature = f.type !== 'spell';
      if ((m.face === 'creature') !== isCreature) return false;
    }
    if (m.civs?.length && !m.civs.some((c) => f.civs.includes(c))) return false;
    if (m.cost) {
      const cost = m.costBasis === 'effective' && effCost !== undefined && faceIdx !== undefined ? effCost : f.cost;
      if (m.cost.eq !== undefined && cost !== m.cost.eq) return false;
      if (m.cost.gte !== undefined && cost < m.cost.gte) return false;
      if (m.cost.lte !== undefined && cost > m.cost.lte) return false;
    }
    return true;
  });
}

// ───────────────────────── 追跡器 ─────────────────────────

/** 自分(席0)の「Nターン目」。自分のターンでなければ null */
export function myTurnNo(s: GameState): number | null {
  if (s.active !== 0) return null;
  return Math.ceil(s.turn / 2);
}

interface Leaf {
  key: string;
  pred: Predicate;
  /** 述語が成立した自分のターン番号(メインのどこかで) */
  any: Set<number>;
  /** ターン終了時に成立したターン番号 */
  end: Set<number>;
}

export function collectLeaves(g: Goal, out: Map<string, Leaf> = new Map()): Map<string, Leaf> {
  if (g.op === 'pred') {
    const key = JSON.stringify(g.pred);
    if (!out.has(key)) out.set(key, { key, pred: g.pred, any: new Set(), end: new Set() });
  } else if (g.op === 'not') collectLeaves(g.arg, out);
  else for (const a of g.args) collectLeaves(a, out);
  return out;
}

export class GoalTracker {
  /** 述語ごとの記録(同じ内容の述語は、同じ記録を共有する) */
  private leaves: Leaf[];
  /** 目標の木にある述語(オブジェクト) → leaves の添字。目標は変わらないので、複製どうしで共有する */
  private index: Map<Predicate, number>;

  constructor(public goal: Goal, private reg: Registry, from?: GoalTracker) {
    if (from) {
      // 複製: 添字の対応は共有し、成立した記録だけをコピーする(JSON 化して葉を引き直さない)
      this.index = from.index;
      this.leaves = from.leaves.map((l) => ({ key: l.key, pred: l.pred, any: new Set(l.any), end: new Set(l.end) }));
      return;
    }
    this.leaves = [...collectLeaves(goal).values()];
    const pos = new Map<string, number>();
    this.leaves.forEach((l, i) => pos.set(l.key, i));
    this.index = new Map();
    const walk = (g: Goal) => {
      if (g.op === 'pred') this.index.set(g.pred, pos.get(JSON.stringify(g.pred))!);
      else if (g.op === 'not') walk(g.arg);
      else g.args.forEach(walk);
    };
    walk(goal);
  }

  private leafOf(p: Predicate): Leaf {
    const i = this.index.get(p);
    if (i === undefined) throw new Error('目標にない述語です');
    return this.leaves[i];
  }

  /** 状態ベースの述語が、この状態で成立しているか */
  private stateHolds(s: GameState, p: Predicate, legal?: Action[]): boolean {
    const reg = this.reg;
    switch (p.kind) {
      case 'manaCount': {
        const c = mkCtx(s, reg);
        const n = s.players[0].mana.filter((u) => !p.civ || manaCivs(c, u).includes(p.civ)).length;
        return n >= p.min;
      }
      case 'zoneHas': {
        const list: number[] = p.zone === 'battle' ? s.players[0].battle.map((x) => x.cards[0]) : s.players[0][p.zone];
        const n = list.filter((u) => matchCard(reg, s, u, p.card)).length;
        return n >= (p.min ?? 1);
      }
      case 'castable': {
        const c = mkCtx(s, reg);
        const acts = legal ?? legalActions(s, reg);
        return acts.some((a) => {
          if (a.type !== 'PLAY_CARD') return false;
          const def = reg.defs[s.cards[a.uid].defId];
          const fi = a.face ?? defaultPlayFace(def);
          const eff = costOf(c, a.uid, fi, { taps: a.extra?.tap });
          return matchCard(reg, s, a.uid, p.card, fi, eff);
        });
      }
      case 'cast':
        return false;
    }
  }

  /** ゲーム開始時(初手)の状態 */
  observeInitial(s: GameState): void {
    for (const l of this.leaves) {
      if (l.pred.kind === 'cast' || l.pred.kind === 'castable') continue;
      if (this.stateHolds(s, l.pred)) l.any.add(0);
    }
  }

  /** 自分のターンの行動待ちの状態を観測する(「メインのどこかで」) */
  observeState(s: GameState, legal?: Action[]): void {
    const n = myTurnNo(s);
    if (n === null || s.step !== 'main') return;
    for (const l of this.leaves) {
      if (l.pred.kind === 'cast') continue;
      if (l.any.has(n)) continue;
      if (this.stateHolds(s, l.pred, legal)) l.any.add(n);
    }
  }

  /** 行動を適用する直前の状態と、発生したイベントを観測する */
  observeStep(prev: GameState, action: Action, _events: Ev[]): void {
    const n = myTurnNo(prev);
    if (n === null) return;
    if (action.type === 'END_TURN') {
      // ターン終了時の状態
      for (const l of this.leaves) {
        if (l.pred.kind === 'cast') continue;
        if (l.end.has(n)) continue;
        if (l.pred.kind === 'castable') continue;
        if (this.stateHolds(prev, l.pred)) l.end.add(n);
      }
    }
  }

  /** イベントを、そのイベントが起きた後の状態と一緒に観測する(「使った」の判定) */
  observeEvents(s: GameState, events: Ev[], turnNo: number | null): void {
    if (turnNo === null) return;
    for (const ev of events) {
      if (ev.owner !== 0) continue;
      if (ev.type !== 'cast' && !(ev.type === 'entered' && ev.via === 'summon')) continue;
      if (ev.free) continue;
      for (const l of this.leaves) {
        if (l.pred.kind !== 'cast' || l.any.has(turnNo)) continue;
        const fi: number = ev.face ?? 0;
        if (matchCard(this.reg, s, ev.card, l.pred.card, fi, ev.cost)) l.any.add(turnNo);
      }
    }
  }

  /** この述語(目標の葉)が、記録の上で既に成立しているか */
  predSatisfied(g: Extract<Goal, { op: 'pred' }>): boolean {
    return this.leafHolds(g.timing, g.pred, Infinity);
  }

  /** 目標が(cap ターン目までの記録で)成立しているか */
  holds(cap: number = Infinity): boolean {
    return this.evalGoal(this.goal, cap);
  }

  private leafHolds(t: Timing, p: Predicate, cap: number): boolean {
    const l = this.leafOf(p);
    switch (t.at) {
      case 'opening':
        return l.any.has(0);
      case 'anyMain':
        return t.turn <= cap && l.any.has(t.turn);
      case 'turnEnd':
        return t.turn <= cap && l.end.has(t.turn);
      case 'byTurn': {
        const lim = Math.min(t.turn, cap);
        for (const x of l.any) if (x <= lim) return true;
        for (const x of l.end) if (x <= lim) return true;
        return false;
      }
    }
  }

  private evalGoal(g: Goal, cap: number): boolean {
    switch (g.op) {
      case 'and':
        return g.args.every((a) => this.evalGoal(a, cap));
      case 'or':
        return g.args.some((a) => this.evalGoal(a, cap));
      case 'not':
        return !this.evalGoal(g.arg, cap);
      case 'pred':
        return this.leafHolds(g.timing, g.pred, cap);
    }
  }

  /** 何ターン目に初めて成立したか(成立しなければ null) */
  achievedTurn(maxTurn: number): number | null {
    for (let t = 0; t <= maxTurn; t++) if (this.evalGoal(this.goal, t)) return t;
    return null;
  }

  /**
   * 目標が、まだ成立しうるか。期限(ターン数)を過ぎても成立していない述語があれば、その枝は成立しない。
   * now は自分の「いま何ターン目か」。「でない(not)」は判断できないので、成立しうるとみなす。
   */
  possible(now: number): boolean {
    const go = (g: Goal): boolean => {
      switch (g.op) {
        case 'and':
          return g.args.every(go);
        case 'or':
          return g.args.some(go);
        case 'not':
          return true;
        case 'pred': {
          if (this.leafHolds(g.timing, g.pred, Infinity)) return true;
          if (g.timing.at === 'opening') return false; // 初手の判定は、ゲーム開始時に終わっている
          return g.timing.turn >= now;
        }
      }
    };
    return go(this.goal);
  }

  /** 検索用: 記録の状態を文字列にする(状態ハッシュに含める) */
  signature(): string {
    let out = '';
    for (const l of this.leaves) out += `${[...l.any].sort().join('.')}/${[...l.end].sort().join('.')};`;
    return out;
  }

  clone(): GoalTracker {
    return new GoalTracker(this.goal, this.reg, this);
  }
}

// ───────────────────────── 目標までの距離(探索の順序づけ・足切り) ─────────────────────────

/** 手の届かない(必要なカードが、自分のどこにもない)ことを表す距離 */
export const FAR = 100;

/** カードを目的のゾーンへ持ってくるまでの手数の目安 */
const MOVE_COST: Record<string, Record<string, number>> = {
  battle: { battle: 0, hand: 1, mana: 2, grave: 3, shield: 3, deck: 4, limbo: 1 },
  hand: { hand: 0, deck: 2, battle: 2, shield: 3, mana: 3, grave: 3, limbo: 2 },
  mana: { mana: 0, hand: 1, deck: 3, battle: 3, shield: 3, grave: 3, limbo: 2 },
  grave: { grave: 0, hand: 1, battle: 1, deck: 3, mana: 3, shield: 3, limbo: 2 },
  shield: { shield: 0, hand: 2, deck: 2, mana: 3, grave: 3, battle: 3, limbo: 2 },
};

/**
 * 述語を満たすまでの距離の目安(0 = 成立済み。FAR 以上 = 自分のカードだけでは不可能)。
 * 実際の手数ではなく、探索の順序づけと足切りに使う近似。
 */
export function predicateDistance(reg: Registry, s: GameState, p: Predicate): number {
  switch (p.kind) {
    case 'manaCount': {
      const c = mkCtx(s, reg);
      const n = s.players[0].mana.filter((u) => !p.civ || manaCivs(c, u).includes(p.civ)).length;
      return Math.max(0, p.min - n);
    }
    case 'zoneHas': {
      const need = p.min ?? 1;
      const costs: number[] = [];
      for (let u = 0; u < s.cards.length; u++) {
        const card = s.cards[u];
        if (card.owner !== 0 || card.zone === 'limbo') continue;
        const z = card.zone === 'battle' && p.zone === 'battle' ? 'battle' : card.zone;
        const m = MOVE_COST[p.zone][z];
        if (m === undefined) continue;
        if (matchCard(reg, s, u, p.card)) costs.push(m);
      }
      if (costs.length < need) return FAR;
      costs.sort((a, b) => a - b);
      let d = 0;
      for (let i = 0; i < need; i++) d += costs[i];
      return d;
    }
    case 'castable':
    case 'cast': {
      const manaN = s.players[0].mana.length;
      let best = FAR;
      for (let u = 0; u < s.cards.length; u++) {
        const card = s.cards[u];
        if (card.owner !== 0) continue;
        if (!matchCard(reg, s, u, p.card)) continue;
        const def = reg.defs[card.defId];
        const cost = Math.min(...def.faces.map((f) => f.cost));
        const gap = Math.max(0, cost - manaN) * 0.5;
        const where = card.zone === 'hand' ? 1 : card.zone === 'mana' || card.zone === 'grave' ? 3 : card.zone === 'deck' ? 4 : card.zone === 'battle' ? 2 : 5;
        best = Math.min(best, where + gap);
      }
      return best;
    }
  }
}

/** 目標までの距離の目安。and は合計、or は最小、not は判断しない(0)。成立済みの述語は 0 */
export function goalDistance(reg: Registry, s: GameState, g: Goal, tracker: GoalTracker): number {
  switch (g.op) {
    case 'and':
      return g.args.reduce((t, a) => t + goalDistance(reg, s, a, tracker), 0);
    case 'or':
      return Math.min(...g.args.map((a) => goalDistance(reg, s, a, tracker)));
    case 'not':
      return 0;
    case 'pred':
      return tracker.predSatisfied(g) ? 0 : predicateDistance(reg, s, g.pred);
  }
}

// ───────────────────────── プリセット(spec 6.3) ─────────────────────────

export interface GoalPreset {
  id: string;
  label: string;
  goal: Goal;
}

export function presetCost7At4(): Goal {
  return {
    op: 'pred',
    timing: { turn: 4, at: 'anyMain' },
    pred: { kind: 'castable', card: { cost: { eq: 7 }, costBasis: 'printed' } },
  };
}

export const GOAL_PRESETS: GoalPreset[] = [
  { id: 'cost7-t4', label: '4ターン目に、コスト7のカードを使える', goal: presetCost7At4() },
  {
    id: 'cost7-t4-cast',
    label: '4ターン目に、コスト7のカードを使った',
    goal: { op: 'pred', timing: { turn: 4, at: 'anyMain' }, pred: { kind: 'cast', card: { cost: { eq: 7 }, costBasis: 'printed' } } },
  },
  {
    id: 'mana5-t3',
    label: '3ターン目までにマナが5枚以上になる',
    goal: { op: 'pred', timing: { turn: 3, at: 'byTurn' }, pred: { kind: 'manaCount', min: 5 } },
  },
  {
    id: 'opening-card',
    label: '初手に特定のカード(例: 天災 デドダム)がある',
    goal: {
      op: 'pred',
      timing: { turn: 1, at: 'opening' },
      pred: { kind: 'zoneHas', zone: 'hand', card: { names: ['天災 デドダム'] }, min: 1 },
    },
  },
];
