// 条件・式・セレクタの評価、イベントパターンの照合(effects 6.4 / 4.3)。
import type { Cond, Expr, Pattern, Selector } from './ast';
import { canBeChosen, charsLite, charsOf, costBase, manaCivs } from './derive';
import type { Ctx } from './state';
import { opponentOf, permByPid } from './state';
import { type Civ, type Ev, isCreatureType, type PlayerId, type Snap } from './types';

export interface CC {
  c: Ctx;
  controller: PlayerId;
  /** 能力の発生源(バトルゾーンのカード等) */
  self: number | null;
  selfSnap?: Snap | null;
  vars: Record<string, any>;
  it?: number | null;
  /** 判定に使う面。-1 = 面0 / 文明は和集合 */
  itFace?: number;
  iter?: PlayerId;
  event?: Ev | null;
}

export function mkCC(c: Ctx, controller: PlayerId, extra: Partial<CC> = {}): CC {
  return { c, controller, self: null, vars: {}, ...extra };
}

// ───────────────────────── 変数 ─────────────────────────

export function getVar(cc: CC, name: string): any {
  if (name === '$self') {
    return cc.self == null ? null : { uid: cc.self, ep: cc.c.s.cards[cc.self].ep };
  }
  if (name === '$eventCard') {
    // 誘発の原因になったイベントのカード(出たクリーチャーなど)。出た後に別の山になっていれば無効
    const ev = cc.event;
    if (!ev || typeof ev.card !== 'number') return null;
    const card = cc.c.s.cards[ev.card];
    if (ev.pid !== undefined && card.pid !== ev.pid) return null;
    return { uid: ev.card, ep: card.ep };
  }
  const parts = name.split('.');
  let v: any = cc.vars[parts[0]];
  for (let i = 1; i < parts.length && v != null; i++) v = v[parts[i]];
  return v;
}

/** 変数の値を uid の配列にする。ep が合わない参照(別のカードになった)は除外する。 */
export function varUids(cc: CC, name: string, opts: { ignoreEp?: boolean } = {}): number[] {
  const v = getVar(cc, name);
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  const out: number[] = [];
  for (const r of arr) {
    if (typeof r === 'number') out.push(r);
    else if (r && typeof r.uid === 'number') {
      const card = cc.c.s.cards[r.uid];
      if (!card) continue;
      if (opts.ignoreEp || card.ep === r.ep) out.push(r.uid);
    }
  }
  return out;
}

// ───────────────────────── 式 ─────────────────────────

export function evalExpr(cc: CC, e: Expr | undefined, dflt = 0): number {
  if (e === undefined) return dflt;
  if (typeof e === 'number') return e;
  const o: any = e;
  if ('var' in o) {
    const v = getVar(cc, o.var);
    return typeof v === 'number' ? v : Array.isArray(v) ? v.length : 0;
  }
  if ('count' in o) return selectCards(cc, o.count).length;
  if ('costOf' in o) {
    if (o.costOf === '$self' && cc.selfSnap) return cc.selfSnap.cost;
    const uids = varUids(cc, o.costOf, { ignoreEp: true });
    if (uids.length === 0) return 0;
    return costBase(cc.c, uids[0]);
  }
  if ('add' in o) return o.add.reduce((a: number, x: Expr) => a + evalExpr(cc, x), 0);
  if ('sub' in o) return evalExpr(cc, o.sub[0]) - evalExpr(cc, o.sub[1]);
  if ('min' in o) return Math.min(...o.min.map((x: Expr) => evalExpr(cc, x)));
  if ('max' in o) return Math.max(...o.max.map((x: Expr) => evalExpr(cc, x)));
  throw new Error('未知の式: ' + JSON.stringify(e));
}

// ───────────────────────── 条件 ─────────────────────────

export function evalCond(cc: CC, cond: Cond | undefined): boolean {
  if (!cond) return true;
  const o: any = cond;
  const s = cc.c.s;
  if ('all' in o) return o.all.every((x: Cond) => evalCond(cc, x));
  if ('any' in o) return o.any.some((x: Cond) => evalCond(cc, x));
  if ('not' in o) return !evalCond(cc, o.not);
  if ('true' in o) return true;
  if ('turnOf' in o) {
    const who = o.turnOf === 'self' ? cc.controller : opponentOf(cc.controller);
    return s.active === who;
  }
  if ('shields' in o) {
    const broken = s.breaking;
    const n = s.players[cc.controller].shield.filter((u) => !broken.includes(u)).length;
    const q = o.shields;
    if (q.lte !== undefined && n > q.lte) return false;
    if (q.gte !== undefined && n < q.gte) return false;
    if (q.eq !== undefined && n !== q.eq) return false;
    return true;
  }
  if ('cmp' in o) {
    const l = evalExpr(cc, o.cmp.l);
    const r = evalExpr(cc, o.cmp.r);
    switch (o.cmp.op) {
      case '<': return l < r;
      case '<=': return l <= r;
      case '>': return l > r;
      case '>=': return l >= r;
      case '==': return l === r;
      case '!=': return l !== r;
    }
  }
  if ('count' in o) {
    const n = selectCards(cc, o.count).length;
    if (o.gte !== undefined && n < o.gte) return false;
    if (o.lte !== undefined && n > o.lte) return false;
    if (o.eq !== undefined && n !== o.eq) return false;
    return true;
  }
  if ('fiveCivs' in o) {
    const set = new Set<Civ>();
    for (const u of selectCards(cc, o.fiveCivs)) for (const civ of manaCivs(cc.c, u)) set.add(civ);
    return set.size >= 5;
  }
  if ('civsPresent' in o) {
    const set = new Set<Civ>();
    for (const u of selectCards(cc, o.civsPresent.sel)) for (const civ of manaCivs(cc.c, u)) set.add(civ);
    return (o.civsPresent.civs as Civ[]).every((x) => set.has(x));
  }
  if ('nonEmpty' in o) return varUids(cc, o.nonEmpty, { ignoreEp: true }).length > 0;
  if ('notInBattle' in o) {
    if (cc.self == null) return true;
    const def = s.cards[cc.self].defId;
    return !s.players[cc.controller].battle.some((p) => s.cards[p.cards[0]].defId === def);
  }
  if ('logged' in o) {
    const min = o.logged.min ?? 1;
    let n = 0;
    for (const ev of s.turnLog) if (matchPattern(cc, o.logged.pattern, ev)) n++;
    return n >= min;
  }
  if ('zoneIs' in o) {
    return cc.it != null && s.cards[cc.it].zone === o.zoneIs;
  }
  if ('exShield' in o) {
    if (cc.it == null || cc.self == null) return false;
    const sh = s.cards[cc.it];
    return sh.zone === 'shield' && sh.ex && sh.exPid === s.cards[cc.self].pid;
  }
  // ここから先は「判定対象のカード $it」を使う条件
  if (cc.it == null) throw new Error('$it が無い条件: ' + JSON.stringify(cond));
  const it = cc.it;
  const ch = 'power' in o || 'powerLtSelf' in o ? charsOf(cc.c, it, cc.itFace ?? -1) : charsLite(cc.c, it, cc.itFace ?? -1);
  if ('civ' in o) return ch.civs.includes(o.civ);
  if ('civsAll' in o) return (o.civsAll as Civ[]).every((x) => ch.civs.includes(x));
  if ('multicolor' in o) return (ch.civs.length > 1) === o.multicolor;
  if ('cost' in o) {
    const q = o.cost;
    if (q.eq !== undefined && ch.cost !== evalExpr(cc, q.eq)) return false;
    if (q.lt !== undefined && !(ch.cost < evalExpr(cc, q.lt))) return false;
    if (q.lte !== undefined && !(ch.cost <= evalExpr(cc, q.lte))) return false;
    if (q.gt !== undefined && !(ch.cost > evalExpr(cc, q.gt))) return false;
    if (q.gte !== undefined && !(ch.cost >= evalExpr(cc, q.gte))) return false;
    return true;
  }
  if ('power' in o) {
    const p = ch.power;
    if (o.power.lte !== undefined && p > o.power.lte) return false;
    if (o.power.gte !== undefined && p < o.power.gte) return false;
    return true;
  }
  if ('powerLtSelf' in o) return cc.self != null && ch.power < charsOf(cc.c, cc.self).power;
  if ('type' in o) {
    if (o.type === 'creature') return isCreatureType(ch.type);
    return ch.type === 'spell';
  }
  if ('evolution' in o) {
    const isEvo = ch.type === 'evolution' || ch.type === 'smaxEvolution';
    return isEvo === o.evolution;
  }
  if ('race' in o) return ch.races.some((r) => raceMatches(r, o.race));
  if ('tapped' in o) {
    const card = s.cards[it];
    if (card.zone === 'battle') return (permByPid(s, card.pid)?.perm.tapped ?? false) === o.tapped;
    return card.tapped === o.tapped;
  }
  if ('sameCivAs' in o) {
    const refs = varUids(cc, o.sameCivAs, { ignoreEp: true });
    if (refs.length === 0) return false;
    const civs = manaCivs(cc.c, refs[0]);
    return ch.civs.some((x) => civs.includes(x));
  }
  throw new Error('未知の条件: ' + JSON.stringify(cond));
}

// ───────────────────────── セレクタ ─────────────────────────

/**
 * 種族の一致。種族名に want を含めば一致とする(「コマンド」は「アーマード・ドラゴン」などの複合名の一部にも当たる)。
 * ただし「ドラゴンギルド」は、ドラゴンとは別の種族なので、「ドラゴン」には当たらない。
 */
export function raceMatches(race: string, want: string): boolean {
  const GUILD = 'ドラゴンギルド';
  return (want.includes(GUILD) ? race : race.split(GUILD).join('')).includes(want);
}

function ownersOf(cc: CC, owner: Selector['owner']): PlayerId[] {
  switch (owner ?? 'self') {
    case 'self': return [cc.controller];
    case 'opponent': return [opponentOf(cc.controller)];
    case 'iter': return [cc.iter ?? cc.controller];
    case 'any': return [cc.controller, opponentOf(cc.controller)];
  }
}

/** セレクタに合うカード(バトルゾーンは山の一番上)の uid を返す。 */
export function selectCards(cc: CC, sel: Selector): number[] {
  const s = cc.c.s;
  const zones = Array.isArray(sel.zone) ? sel.zone : [sel.zone];
  const except = sel.except ? varUids(cc, sel.except, { ignoreEp: true }) : [];
  const out: number[] = [];
  for (const owner of ownersOf(cc, sel.owner)) {
    for (const z of zones) {
      let list: number[];
      if (sel.of) list = varUids(cc, sel.of).filter((u) => s.cards[u].owner === owner);
      else if (z === 'battle') list = s.players[owner].battle.map((p) => p.cards[0]);
      else if (z === 'limbo') list = s.limbo.filter((u) => s.cards[u].owner === owner);
      else list = s.players[owner][z];
      for (const uid of list) {
        if (except.includes(uid)) continue;
        if (sel.notSelf && uid === cc.self) continue;
        const hint = faceHint(cc, uid, sel.type);
        if (hint === null) continue; // 種類が合わない
        if (sel.where) {
          const sub: CC = { ...cc, it: uid, itFace: hint };
          if (!evalCond(sub, sel.where)) continue;
        }
        if (sel.chooseable && z === 'battle' && owner !== cc.controller) {
          const pm = permByPid(s, s.cards[uid].pid);
          if (pm && !canBeChosen(cc.c, pm.perm, cc.controller)) continue;
        }
        out.push(uid);
      }
    }
  }
  return out;
}

/** セレクタの type に合うか。合うなら判定に使う面(-1=面0)を、合わなければ null を返す。 */
function faceHint(cc: CC, uid: number, type: Selector['type']): number | null {
  const s = cc.c.s;
  const card = s.cards[uid];
  const def = cc.c.reg.defs[card.defId];
  if (card.zone === 'battle' || card.zone === 'limbo') {
    const f = def.faces[card.face] ?? def.faces[0];
    if (type === 'spell') return f.type === 'spell' ? card.face : null;
    if (type === 'creature') return isCreatureType(f.type) ? card.face : null;
    return card.face;
  }
  if (!type || type === 'card') return -1;
  const idx = def.faces.findIndex((f) => (type === 'spell' ? f.type === 'spell' : isCreatureType(f.type)));
  return idx < 0 ? null : idx;
}

// ───────────────────────── イベントパターン ─────────────────────────

/**
 * イベントがパターンに合うか。owner/controller/player は cc.controller から見た相対('self'/'opponent'/'any')。
 */
export function matchPattern(cc: CC, pat: Pattern, ev: Ev): boolean {
  if (pat.type !== ev.type) return false;
  if (pat.self && ev.card !== cc.self) return false;
  if (pat.role) {
    // blocked: attacker / blocker、battleEnded: winner / loser(その能力の発生源がその役割か)
    // battleStarted / afterBattle: attacker / defender(バトルの攻撃側 / 攻撃された側)
    const want =
      ev.type === 'blocked'
        ? pat.role === 'attacker'
          ? ev.attackerCard
          : ev.card
        : ev.type === 'battleStarted' || ev.type === 'afterBattle'
          ? pat.role === 'attacker'
            ? ev.attackerCard
            : ev.defenderCard
          : pat.role === 'winner'
            ? ev.winnerCard
            : ev.loserCard;
    if (want === null || want === undefined || want !== cc.self) return false;
  }
  const rel = (want: any, actual: PlayerId | undefined): boolean => {
    if (want === undefined || want === 'any') return true;
    if (actual === undefined) return false;
    return want === 'self' ? actual === cc.controller : actual !== cc.controller;
  };
  if (pat.via !== undefined && ev.via !== pat.via) return false;
  if (pat.cause !== undefined && ev.cause !== pat.cause) return false;
  if (pat.from !== undefined && ev.from !== pat.from) return false;
  if (pat.to !== undefined && ev.to !== pat.to) return false;
  if (pat.kind !== undefined && ev.kind !== pat.kind) return false;
  if (pat.ex !== undefined && !!ev.ex !== pat.ex) return false;
  if (pat.step !== undefined && ev.step !== pat.step) return false;
  if (pat.paid !== undefined && ev.paid !== pat.paid) return false;
  if (pat.free !== undefined && !!ev.free !== pat.free) return false;
  if (pat.up !== undefined && !!ev.up !== pat.up) return false;
  if (pat.causeType !== undefined && ev.cause?.type !== pat.causeType) return false;
  // abilityTriggered: その能力の持ち主が、トリガーの原因のイベントのカード自身(出たクリーチャー自身の能力)か。
  // 他のクリーチャーが出たことでトリガーした能力は含めない(オルゲイト: 公式 Q&A 46068。キーナリーの抑制と同じ範囲)
  if (pat.causeSelf && (ev.cause?.card === undefined || ev.cause.card !== ev.source)) return false;
  if (!rel(pat.owner, ev.owner)) return false;
  if (!rel(pat.player, ev.player)) return false;
  if (!rel(pat.controller, ev.controller)) return false;
  if (pat.winner !== undefined) {
    if (ev.winnerOwner === undefined) return false;
    if (!rel(pat.winner, ev.winnerOwner)) return false;
  }
  if (pat.attackerCond) {
    const uid: number | undefined = ev.card;
    if (uid === undefined) return false;
    if (!evalCond({ ...cc, it: uid, itFace: -1 }, pat.attackerCond)) return false;
  }
  return true;
}
