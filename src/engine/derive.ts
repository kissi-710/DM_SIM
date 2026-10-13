// 派生ビュー: コスト・パワー・文明・能力・攻撃可否など(effects 7)。状態を書き換えない。
import type { Cond } from './ast';
import { evalCond, mkCC } from './cond';
import type { FaceInfo } from './registry';
import type { Ctx } from './state';
import { opponentOf, permByPid } from './state';
import type { Civ, ContEffect, Face, FaceType, PlayerId, Permanent } from './types';

export interface Chars {
  face: Face;
  faceIdx: number;
  civs: Civ[];
  cost: number;
  power: number;
  type: FaceType;
  races: string[];
}

function unionCivs(faces: Face[]): Civ[] {
  const set = new Set<Civ>();
  for (const f of faces) for (const c of f.civs) set.add(c);
  return [...set];
}

/** カードの特性。hint=-1 のとき、場以外のカードは面0(文明は全面の和集合)で見る。 */
export function charsOf(c: Ctx, uid: number, hint: number = -1): Chars {
  const card = c.s.cards[uid];
  const def = c.reg.defs[card.defId];
  const inPlay = card.zone === 'battle' || card.zone === 'limbo';
  let idx: number;
  if (inPlay) idx = def.faces[card.face] ? card.face : 0;
  else idx = hint >= 0 && def.faces[hint] ? hint : 0;
  const face = def.faces[idx];
  const civs = inPlay || hint >= 0 ? face.civs : unionCivs(def.faces);
  let power = face.power ?? 0;
  if (card.zone === 'battle' && c.s.cards[uid].pid >= 0) {
    const pm = permByPid(c.s, card.pid);
    if (pm && pm.perm.cards[0] === uid) power = powerOf(c, pm.perm);
  }
  return { face, faceIdx: idx, civs, cost: face.cost, power, type: face.type, races: face.races ?? [] };
}

/** 表記コスト(使用中の面。場以外は面0) */
export function costBase(c: Ctx, uid: number): number {
  return charsOf(c, uid, -1).face.cost;
}

export function infoOf(c: Ctx, uid: number): FaceInfo {
  const card = c.s.cards[uid];
  const ch = charsOf(c, uid, -1);
  return c.reg.getInfo(card.defId, ch.faceIdx);
}

export function isCreatureType(t: FaceType): boolean {
  return t !== 'spell';
}

// ───────────────────────── 継続効果 ─────────────────────────

export function effectsOnPerm(c: Ctx, pid: number): ContEffect[] {
  return c.s.effects.filter((e) => e.pid === pid);
}

interface ActiveStatic {
  src: number;
  controller: PlayerId;
  ability: any;
}

/** バトルゾーンの一番上のカードが持つ常在型能力 */
export function activeStatics(c: Ctx): ActiveStatic[] {
  const out: ActiveStatic[] = [];
  for (const p of [0, 1] as PlayerId[]) {
    for (const perm of c.s.players[p].battle) {
      const uid = perm.cards[0];
      const info = infoOf(c, uid);
      for (const st of info.statics) {
        if (st.ability.while) {
          const cc = mkCC(c, p, { self: uid });
          if (!evalCond(cc, st.ability.while)) continue;
        }
        out.push({ src: uid, controller: p, ability: st.ability });
      }
    }
  }
  return out;
}

// ───────────────────────── パワー・能力 ─────────────────────────

export function powerOf(c: Ctx, perm: Permanent): number {
  const uid = perm.cards[0];
  const card = c.s.cards[uid];
  const def = c.reg.defs[card.defId];
  const face = def.faces[card.face] ?? def.faces[0];
  let p = face.power ?? 0;
  const info = c.reg.getInfo(card.defId, card.face);
  for (const st of info.statics) {
    if (st.ability.mod.type !== 'powerAdd') continue;
    if (st.ability.while && !evalCond(mkCC(c, card.owner, { self: uid }), st.ability.while)) continue;
    p += st.ability.mod.n;
  }
  for (const e of c.s.effects) if (e.pid === perm.pid && e.mod.kind === 'powerAdd') p += e.mod.n;
  return p;
}

export type KwName = 'blocker' | 'speedAttacker' | 'machFighter' | 'shieldTrigger' | 'justDiver' | 'exLife';

export function hasKeyword(c: Ctx, perm: Permanent, kw: KwName): boolean {
  const uid = perm.cards[0];
  const info = infoOf(c, uid);
  if (kw === 'shieldTrigger') {
    if (info.shieldTriggers.length > 0) return true;
  } else if ((info as any)[kw]) return true;
  for (const e of c.s.effects) if (e.pid === perm.pid && e.mod.kind === 'grant' && e.mod.keyword === kw) return true;
  return false;
}

export function breakerCount(c: Ctx, perm: Permanent): number {
  const uid = perm.cards[0];
  const info = infoOf(c, uid);
  let n = 1;
  for (const b of info.breakers) {
    if (b.while && !evalCond(mkCC(c, c.s.cards[uid].owner, { self: uid }), b.while)) continue;
    n = Math.max(n, b.n);
  }
  return n;
}

// ───────────────────────── 攻撃・ブロック・選択 ─────────────────────────

/**
 * ジャストダイバー(常在型。誘発しない): 出てから、持ち主の次のターンのはじめまで、
 * 相手に選ばれず、攻撃されない。ターンは交互なので、出たターンの次か次の次のターンが期限。
 */
function justDiverActive(c: Ctx, perm: Permanent): boolean {
  if (!hasKeyword(c, perm, 'justDiver')) return false;
  const s = c.s;
  const owner = s.cards[perm.cards[0]].owner;
  const activeAt = (t: number): PlayerId => ((s.first + t - 1) % 2) as PlayerId;
  const until = activeAt(perm.enteredTurn + 1) === owner ? perm.enteredTurn + 1 : perm.enteredTurn + 2;
  return s.turn < until;
}

export function canBeChosen(c: Ctx, perm: Permanent, by: PlayerId): boolean {
  const owner = c.s.cards[perm.cards[0]].owner;
  if (owner === by) return true;
  if (justDiverActive(c, perm)) return false;
  for (const e of c.s.effects) if (e.pid === perm.pid && e.mod.kind === 'cannotBeChosen') return false;
  return true;
}

export function canBeAttacked(c: Ctx, perm: Permanent): boolean {
  if (justDiverActive(c, perm)) return false;
  for (const e of c.s.effects) if (e.pid === perm.pid && e.mod.kind === 'cannotBeAttacked') return false;
  return true;
}

export function hasEffect(c: Ctx, pid: number, kind: string): boolean {
  return c.s.effects.some((e) => e.pid === pid && e.mod.kind === kind);
}

/** 相手クリーチャーの「出たターンに自分を攻撃できない」(ガイアッシュ・カイザー) */
function playerAttackBlockedByEntry(c: Ctx, perm: Permanent, owner: PlayerId): boolean {
  if (perm.enteredTurn !== c.s.turn) return false;
  for (const st of activeStatics(c)) {
    if (st.ability.mod.type === 'cannotAttackPlayerWhenEntered' && st.controller !== owner) return true;
  }
  return false;
}

export function canAttack(c: Ctx, perm: Permanent, target: { kind: 'player' } | { kind: 'creature'; pid: number }): boolean {
  const s = c.s;
  const uid = perm.cards[0];
  const owner = s.cards[uid].owner;
  if (perm.tapped) return false;
  if (hasEffect(c, perm.pid, 'cannotAttack')) return false;
  const speed = hasKeyword(c, perm, 'speedAttacker');
  const mach = hasKeyword(c, perm, 'machFighter');
  const sick = perm.sick;
  if (sick && !speed && !mach) return false;
  if (target.kind === 'player') {
    if (sick && !speed) return false; // マッハファイターは出たターン、プレイヤーを攻撃できない
    if (playerAttackBlockedByEntry(c, perm, owner)) return false;
    return true;
  }
  const tp = permByPid(s, target.pid);
  if (!tp || tp.owner === owner) return false;
  if (!canBeAttacked(c, tp.perm)) return false;
  if (tp.perm.tapped) return true;
  // アンタップ状態のクリーチャーは、出たターンのマッハファイターだけが攻撃できる
  return sick && mach;
}

export function canBlock(c: Ctx, perm: Permanent): boolean {
  if (perm.tapped) return false;
  return hasKeyword(c, perm, 'blocker');
}

// ───────────────────────── コスト ─────────────────────────

export interface CostOpts {
  taps?: number[];
  free?: boolean;
}

/** 召喚・詠唱するカードの最終コスト(0未満にならない)。 */
export function costOf(c: Ctx, uid: number, faceIdx: number, opts: CostOpts = {}): number {
  const s = c.s;
  const card = s.cards[uid];
  const def = c.reg.defs[card.defId];
  const face = def.faces[faceIdx] ?? def.faces[0];
  if (opts.free) return 0;
  let cost = face.cost;
  const info = c.reg.getInfo(card.defId, faceIdx);
  if (info.sympathy) cost -= s.players[card.owner].mana.length;
  if (info.hyperEnergy && opts.taps?.length) cost -= 2 * opts.taps.length;
  for (const st of activeStatics(c)) {
    if (st.ability.mod.type !== 'costDelta') continue;
    if (st.controller !== card.owner) continue;
    const cc = mkCC(c, st.controller, { self: st.src, it: uid, itFace: faceIdx });
    if (evalCond(cc, st.ability.mod.cond as Cond)) cost += st.ability.mod.delta;
  }
  return Math.max(0, cost);
}

/** 実際にタップするマナの枚数(文明の数を下回らない) */
export function payNeed(cost: number, civCount: number): number {
  if (cost <= 0) return 0;
  return Math.max(cost, civCount);
}

export function manaCivs(c: Ctx, uid: number): Civ[] {
  return charsOf(c, uid, -1).civs;
}

/**
 * マナの支払いの割り当て。必要な文明ごとに1枚(1枚のマナは1文明)+残りは数値で支払う。
 * 手札の他のカードの文明条件を残しやすいように、価値の低いマナからタップする。
 * 払えなければ null。
 */
export function planPayment(c: Ctx, player: PlayerId, civs: Civ[], need: number, exclude: number[] = [], keepFor: number[] = []): number[] | null {
  const s = c.s;
  if (need <= 0) return [];
  const avail = s.players[player].mana.filter((u) => !s.cards[u].tapped && !exclude.includes(u));
  if (avail.length < need) return null;
  // 価値(残したいほど高い)
  const want: Record<string, number> = {};
  for (const h of keepFor) for (const civ of charsOf(c, h, -1).civs) want[civ] = (want[civ] ?? 0) + 1;
  const mc = new Map<number, Civ[]>();
  const value = new Map<number, number>();
  for (const u of avail) {
    const cs = manaCivs(c, u);
    mc.set(u, cs);
    let v = 0.01 * cs.length;
    for (const cv of cs) v += want[cv] ?? 0;
    value.set(u, v);
  }
  const sorted = avail.slice().sort((a, b) => value.get(a)! - value.get(b)!);
  // 文明ごとの割り当て(マッチング)。1文明につき、その文明を持つ別々のマナ1枚。
  const k = civs.length;
  const cands = civs.map((cv) => sorted.filter((u) => mc.get(u)!.includes(cv)));
  if (cands.some((l) => l.length === 0)) return null;
  // 解の探索(価値の合計が最小になる割り当て。ノード数に上限)
  let best: number[] | null = null;
  let bestScore = Infinity;
  let nodes = 0;
  const order = civs.map((_, i) => i).sort((a, b) => cands[a].length - cands[b].length);
  const chosen: number[] = [];
  const dfs = (i: number, score: number) => {
    if (nodes++ > 3000) return;
    if (score >= bestScore) return;
    if (i === k) {
      best = chosen.slice();
      bestScore = score;
      return;
    }
    for (const u of cands[order[i]]) {
      if (chosen.includes(u)) continue;
      chosen.push(u);
      dfs(i + 1, score + value.get(u)!);
      chosen.pop();
    }
  };
  dfs(0, 0);
  if (!best) {
    // 上限に達して見つからなかった場合の、確実な二部マッチング(増加路)
    const matchOf = new Map<number, number>();
    const tryAug = (ci: number, seen: Set<number>): boolean => {
      for (const u of cands[ci]) {
        if (seen.has(u)) continue;
        seen.add(u);
        const cur = matchOf.get(u);
        if (cur === undefined || tryAug(cur, seen)) {
          matchOf.set(u, ci);
          return true;
        }
      }
      return false;
    };
    for (let i = 0; i < k; i++) if (!tryAug(i, new Set())) return null;
    best = [...matchOf.keys()];
  }
  const result: number[] = best;
  const total = Math.max(need, k);
  if (avail.length < total) return null;
  for (const u of sorted) {
    if (result.length >= total) break;
    if (!result.includes(u)) result.push(u);
  }
  return result;
}

// ───────────────────────── 呪文の制限 ─────────────────────────

/** プレイヤーがこの呪文(面)を唱えられるか(ドルファディロムの制限など) */
export function canCast(c: Ctx, player: PlayerId, uid: number, faceIdx: number): boolean {
  for (const st of activeStatics(c)) {
    if (st.ability.mod.type !== 'cannotCast') continue;
    if (st.controller === player) continue; // 「相手は〜できない」
    const cc = mkCC(c, st.controller, { self: st.src, it: uid, itFace: faceIdx });
    if (evalCond(cc, st.ability.mod.cond as Cond)) return false;
  }
  return true;
}

export { opponentOf };
