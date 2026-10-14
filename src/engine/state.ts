// 状態の複製・乱数・ゾーン操作の下請け。
import type { Registry } from './registry';
import type { Card, Ev, Frame, GameState, Permanent, PlayerId, PlayerZones, Snap, ZoneName } from './types';

// ───────────────────────── 実行コンテキスト ─────────────────────────

export interface Ctx {
  s: GameState;
  reg: Registry;
  /** この step で発生したイベント */
  out: Ev[];
  /** 入力待ちの回答を消費する位置 */
  askIdx: number;
  /** 「質問は変更の前に行う」規約の検査用 */
  rng0: number;
  seq0: number;
  /** 現在の因果の元(イベントID or フレームID) */
  cause: number | null;
}

export function mkCtx(s: GameState, reg: Registry, out: Ev[] = []): Ctx {
  return { s, reg, out, askIdx: 0, rng0: s.rng, seq0: s.seq, cause: null };
}

// ───────────────────────── 乱数(mulberry32。状態に内包) ─────────────────────────

export function rngNext(s: GameState): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rngInt(s: GameState, n: number): number {
  return Math.floor(rngNext(s) * n);
}

export function shuffleInPlace<T>(s: GameState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rngInt(s, i + 1);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/** 文字列やシードから32bit整数を作る */
export function hashSeed(seed: number | string): number {
  if (typeof seed === 'number') return seed | 0;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

// ───────────────────────── 複製 ─────────────────────────

export function cloneJson<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(cloneJson) as any;
  const o: any = {};
  for (const k in v as any) o[k] = cloneJson((v as any)[k]);
  return o;
}

function clonePlayer(p: PlayerZones): PlayerZones {
  return {
    deck: p.deck.slice(),
    hand: p.hand.slice(),
    mana: p.mana.slice(),
    shield: p.shield.slice(),
    grave: p.grave.slice(),
    hyper: p.hyper.slice(),
    battle: p.battle.map((b) => ({ ...b, cards: b.cards.slice() })),
  };
}

function cloneFrame(f: Frame): Frame {
  return { ...f, vars: cloneJson(f.vars) } as Frame;
}

/** 状態の複製。イベント・LKI・Pending は作成後に変更しないので共有する。 */
export function cloneState(s: GameState): GameState {
  return {
    ...s,
    cards: s.cards.map((c) => ({ ...c })),
    players: [clonePlayer(s.players[0]), clonePlayer(s.players[1])],
    limbo: s.limbo.slice(),
    cont: s.cont.map(cloneFrame),
    pool: s.pool.slice(),
    effects: s.effects.map((e) => ({ ...e })),
    turnLog: s.turnLog.slice(),
    usage: { ...s.usage },
    rans: s.rans.slice(),
    breaking: s.breaking.slice(),
    deckIds: s.deckIds,
    cfg: s.cfg,
  };
}

// ───────────────────────── ゾーン・参照 ─────────────────────────

export function zoneList(s: GameState, owner: PlayerId, zone: Exclude<ZoneName, 'battle' | 'limbo'>): number[] {
  return s.players[owner][zone];
}

export function permByPid(s: GameState, pid: number): { perm: Permanent; owner: PlayerId } | null {
  for (const p of [0, 1] as PlayerId[]) {
    for (const perm of s.players[p].battle) if (perm.pid === pid) return { perm, owner: p };
  }
  return null;
}

export function permTop(perm: Permanent): number {
  return perm.cards[0];
}

/** カードがバトルゾーンの山の一番上(クリーチャー)か */
export function isTopOfPile(s: GameState, uid: number): boolean {
  const c = s.cards[uid];
  if (c.zone !== 'battle') return false;
  const r = permByPid(s, c.pid);
  return !!r && r.perm.cards[0] === uid;
}

export function opponentOf(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

export function nextId(s: GameState): number {
  return ++s.seq;
}

export function snapOf(c: Ctx, uid: number): Snap {
  const s = c.s;
  const card = s.cards[uid];
  const reg = c.reg;
  const inPlay = card.zone === 'battle' || card.zone === 'limbo';
  const def = reg.defs[card.defId];
  const face = inPlay ? def.faces[card.face] ?? def.faces[0] : def.faces[0];
  const civs = inPlay ? face.civs : unionCivs(def.faces);
  return {
    uid,
    defId: card.defId,
    owner: card.owner,
    face: card.face,
    zone: card.zone,
    civs,
    cost: face.cost,
    power: face.power ?? 0,
    multicolor: civs.length > 1,
    pid: card.pid,
  };
}

// 全面の文明の和集合(カード定義ごとに不変なのでキャッシュする。戻り値は書き換えない)
const unionCache = new WeakMap<object, any[]>();
function unionCivs(faces: { civs: string[] }[]): any[] {
  let r = unionCache.get(faces);
  if (!r) {
    const set = new Set<string>();
    for (const f of faces) for (const c of f.civs) set.add(c);
    r = [...set];
    unionCache.set(faces, r);
  }
  return r;
}

export function cardsOwnedBy(s: GameState, p: PlayerId): number[] {
  const r: number[] = [];
  for (let i = 0; i < s.cards.length; i++) if (s.cards[i].owner === p) r.push(i);
  return r;
}

export function getCard(s: GameState, uid: number): Card {
  return s.cards[uid];
}
