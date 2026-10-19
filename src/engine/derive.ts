// 派生ビュー: コスト・パワー・文明・能力・攻撃可否など(effects 7)。状態を書き換えない。
import type { Ability, Cond, StaticMod } from './ast';
import { evalCond, mkCC } from './cond';
import type { FaceInfo } from './registry';
import type { Ctx } from './state';
import { opponentOf, permByPid } from './state';
import type { Card, CardDef, Civ, ContEffect, Face, FaceType, PlayerId, Permanent } from './types';

export interface Chars {
  face: Face;
  faceIdx: number;
  civs: Civ[];
  cost: number;
  power: number;
  type: FaceType;
  races: string[];
}

// 全面の文明の和集合(カード定義ごとに不変なのでキャッシュする。戻り値は書き換えない)
const unionCache = new WeakMap<Face[], Civ[]>();
function unionCivs(faces: Face[]): Civ[] {
  let r = unionCache.get(faces);
  if (!r) {
    const set = new Set<Civ>();
    for (const f of faces) for (const c of f.civs) set.add(c);
    r = [...set];
    unionCache.set(faces, r);
  }
  return r;
}

/**
 * 使用中の面の添字(hint なし)。場(battle / limbo)なら card.face(無効なら 0)、それ以外は面0。
 * charsLite(c, uid, -1) の faceIdx と同じ値を、オブジェクトを作らずに求める。
 */
function faceIdxOf(card: Card, def: CardDef): number {
  return (card.zone === 'battle' || card.zone === 'limbo') && def.faces[card.face] ? card.face : 0;
}

/** カードの特性(パワーを計算しない軽量版)。power は面の基本パワー。コスト・面・文明・種類・種族だけを使う呼び出しはこちらを使う */
export function charsLite(c: Ctx, uid: number, hint: number = -1): Chars {
  const card = c.s.cards[uid];
  const def = c.reg.defs[card.defId];
  const inPlay = card.zone === 'battle' || card.zone === 'limbo';
  let idx: number;
  if (inPlay) idx = def.faces[card.face] ? card.face : 0;
  else idx = hint >= 0 && def.faces[hint] ? hint : 0;
  const face = def.faces[idx];
  const civs = inPlay || hint >= 0 ? face.civs : unionCivs(def.faces);
  return { face, faceIdx: idx, civs, cost: face.cost, power: face.power ?? 0, type: face.type, races: face.races ?? [] };
}

/** カードの特性。hint=-1 のとき、場以外のカードは面0(文明は全面の和集合)で見る。power は、バトルゾーンの一番上のカードなら継続効果を含む */
export function charsOf(c: Ctx, uid: number, hint: number = -1): Chars {
  const ch = charsLite(c, uid, hint);
  const card = c.s.cards[uid];
  if (card.zone === 'battle' && card.pid >= 0) {
    const pm = permByPid(c.s, card.pid);
    if (pm && pm.perm.cards[0] === uid) ch.power = powerOf(c, pm.perm);
  }
  return ch;
}

/** PLAY_CARD で面を省いた時に使う面(最初のクリーチャー面。呪文だけなら 0) */
export function defaultPlayFace(def: CardDef): number {
  const k = def.faces.findIndex((f) => f.type !== 'spell');
  return k >= 0 ? k : 0;
}

/** 表記コスト(使用中の面。場以外は面0) */
export function costBase(c: Ctx, uid: number): number {
  const card = c.s.cards[uid];
  const def = c.reg.defs[card.defId];
  return def.faces[faceIdxOf(card, def)].cost;
}

/** 使用中の面の種類(hint なし。charsLite(c, uid, -1).type と同じ) */
export function faceTypeOf(c: Ctx, uid: number): FaceType {
  const card = c.s.cards[uid];
  const def = c.reg.defs[card.defId];
  return def.faces[faceIdxOf(card, def)].type;
}

export function infoOf(c: Ctx, uid: number): FaceInfo {
  const card = c.s.cards[uid];
  return c.reg.getInfo(card.defId, faceIdxOf(card, c.reg.defs[card.defId]));
}

// ───────────────────────── 継続効果 ─────────────────────────

export function effectsOnPerm(c: Ctx, pid: number): ContEffect[] {
  return c.s.effects.filter((e) => e.pid === pid);
}

interface ActiveStatic {
  src: number;
  controller: PlayerId;
  ability: Extract<Ability, { kind: 'static' }>;
}

/**
 * バトルゾーンの一番上のカードが持つ常在型能力。modType を渡すと、その種類だけを返す。
 * 種類で先に絞ってから `while` を評価する(評価は状態を書き換えないので、返る内容は絞らない場合の部分集合と同じ)。
 */
export function activeStatics(c: Ctx, modType?: StaticMod['type']): ActiveStatic[] {
  const out: ActiveStatic[] = [];
  for (const p of [0, 1] as PlayerId[]) {
    for (const perm of c.s.players[p].battle) {
      const uid = perm.cards[0];
      const info = infoOf(c, uid);
      for (const st of info.statics) {
        if (modType !== undefined && st.ability.mod.type !== modType) continue;
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

export type KwName = 'blocker' | 'speedAttacker' | 'machFighter' | 'shieldTrigger' | 'justDiver' | 'exLife' | 'slayer' | 'unblockable';

export function hasKeyword(c: Ctx, perm: Permanent, kw: KwName): boolean {
  const uid = perm.cards[0];
  const info = infoOf(c, uid);
  if (kw === 'shieldTrigger') {
    if (info.shieldTriggers.length > 0) return true;
  } else if ((info as unknown as Record<string, unknown>)[kw]) return true;
  for (const e of c.s.effects) if (e.pid === perm.pid && e.mod.kind === 'grant' && e.mod.keyword === kw) return true;
  return grantedByStatic(c, perm, kw);
}

/** 場の常在型能力(grantKeyword)でキーワードを与えられているか */
function grantedByStatic(c: Ctx, perm: Permanent, kw: KwName): boolean {
  const uid = perm.cards[0];
  const owner = c.s.cards[uid].owner;
  for (const src of c.s.players[owner].battle) {
    const su = src.cards[0];
    const info = infoOf(c, su);
    for (const st of info.statics) {
      const m = st.ability.mod;
      if (m.type !== 'grantKeyword' || m.keyword !== kw) continue;
      if (st.ability.while && !evalCond(mkCC(c, owner, { self: su }), st.ability.while)) continue;
      if (evalCond(mkCC(c, owner, { self: su, it: uid, itFace: c.s.cards[uid].face }), m.cond as Cond)) return true;
    }
  }
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

export function canBeChosen(c: Ctx, perm: Permanent, by: PlayerId): boolean {
  const owner = c.s.cards[perm.cards[0]].owner;
  if (owner === by) return true;
  for (const e of c.s.effects) if (e.pid === perm.pid && e.mod.kind === 'cannotBeChosen') return false;
  return true;
}

export function canBeAttacked(c: Ctx, perm: Permanent): boolean {
  for (const e of c.s.effects) if (e.pid === perm.pid && e.mod.kind === 'cannotBeAttacked') return false;
  return true;
}

export function hasEffect(c: Ctx, pid: number, kind: string): boolean {
  return c.s.effects.some((e) => e.pid === pid && e.mod.kind === kind);
}

/** 相手クリーチャーの「出たターンに自分を攻撃できない」(ガイアッシュ・カイザー) */
function playerAttackBlockedByEntry(c: Ctx, perm: Permanent, owner: PlayerId): boolean {
  if (perm.enteredTurn !== c.s.turn) return false;
  for (const st of activeStatics(c, 'cannotAttackPlayerWhenEntered')) {
    if (st.controller !== owner) return true;
  }
  return false;
}

/**
 * 召喚酔いか(総合ルール 301.5 / 801.3)。進化クリーチャー(S-MAX進化を含む)は召喚酔いしない。
 * `perm.sick` は「そのターンの開始時からバトルゾーンにいない」ことの記録で、進化クリーチャーの下の
 * カードが再構築で残った時(801.4c)のために、進化中も保持する。
 */
export function isSick(c: Ctx, perm: Permanent): boolean {
  if (!perm.sick) return false;
  const t = faceTypeOf(c, perm.cards[0]);
  return t !== 'evolution' && t !== 'smaxEvolution';
}

export function canAttack(c: Ctx, perm: Permanent, target: { kind: 'player' } | { kind: 'creature'; pid: number }): boolean {
  const s = c.s;
  const uid = perm.cards[0];
  const owner = s.cards[uid].owner;
  if (perm.tapped) return false;
  if (hasEffect(c, perm.pid, 'cannotAttack')) return false;
  const speed = hasKeyword(c, perm, 'speedAttacker');
  const mach = hasKeyword(c, perm, 'machFighter');
  const sick = isSick(c, perm);
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

/** 攻撃クリーチャーが「ブロックされない」か(レッドギラゾーン) */
export function isUnblockable(c: Ctx, attacker: Permanent): boolean {
  return hasKeyword(c, attacker, 'unblockable');
}

export function canBlock(c: Ctx, perm: Permanent): boolean {
  if (perm.tapped) return false;
  return hasKeyword(c, perm, 'blocker');
}

/** ブロックを強制する効果を受けているか(総合ルール 507.1b: ブロックできるなら、必ず選ぶ) */
export function mustBlock(c: Ctx, perm: Permanent): boolean {
  return hasEffect(c, perm.pid, 'mustBlock');
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
  for (const st of activeStatics(c, 'costDelta')) {
    if (st.controller !== card.owner) continue;
    const mod = st.ability.mod;
    if (mod.type !== 'costDelta') continue;
    const cc = mkCC(c, st.controller, { self: st.src, it: uid, itFace: faceIdx });
    if (evalCond(cc, mod.cond as Cond)) cost += mod.delta;
  }
  return Math.max(0, cost);
}

/**
 * 実際にタップするマナの枚数(文明の数を下回らない。spec 3.4.1 M-3・M-4)。
 * 文明を持つカードは、コストが0に下がっても各文明のマナを1枚は払う。
 * コストを払わずに使う場合は、呼び出し側が need を 0 にする。
 */
export function payNeed(cost: number, civCount: number): number {
  return Math.max(cost, civCount, 0);
}

export function manaCivs(c: Ctx, uid: number): Civ[] {
  const card = c.s.cards[uid];
  const def = c.reg.defs[card.defId];
  return card.zone === 'battle' || card.zone === 'limbo' ? def.faces[faceIdxOf(card, def)].civs : unionCivs(def.faces);
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
  for (const h of keepFor) for (const civ of charsLite(c, h, -1).civs) want[civ] = (want[civ] ?? 0) + 1;
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
  // 「次の自分のターンのはじめまで、相手は呪文を唱えられない」(XXDDZ)
  for (const e of c.s.effects) if (e.mod.kind === 'cannotCast' && e.controller !== player) return false;
  for (const st of activeStatics(c, 'cannotCast')) {
    if (st.controller === player) continue; // 「相手は〜できない」
    const mod = st.ability.mod;
    if (mod.type !== 'cannotCast') continue;
    const cc = mkCC(c, st.controller, { self: st.src, it: uid, itFace: faceIdx });
    if (evalCond(cc, mod.cond as Cond)) return false;
  }
  return true;
}

/** 「相手はそのコストのカードを実行できない」(オーパーツ銃のファイナル革命)に当たらないか */
export function canUseCost(c: Ctx, player: PlayerId, cost: number): boolean {
  for (const e of c.s.effects) {
    if (e.mod.kind === 'cannotUseCost' && e.controller !== player && e.mod.n === cost) return false;
  }
  return true;
}

export { opponentOf };
