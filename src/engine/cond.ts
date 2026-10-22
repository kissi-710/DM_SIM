// 条件・式・セレクタの評価、イベントパターンの照合(effects 6.4 / 4.3)。
import type { Cond, Expr, Pattern, Selector } from './ast';
import { canBeChosen, charsLite, charsOf, costBase, hasKeyword, infoOf, manaCivs } from './derive';
import type { Ctx } from './state';
import { gameHas, opponentOf, permByPid } from './state';
import { type Civ, type Ev, type FaceType, isCreatureType, type Permanent, type PlayerId, type Snap } from './types';

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
  /** 進化元を調べている(シンカライズのタマシードを、クリーチャーとして扱う) */
  evo?: boolean;
}

/** クロスギア(uid)がクロスしているクリーチャーの山。クロスされていなければ(クロス先が場を離れていても)null */
export function crossHostOf(c: Ctx, gearUid: number): Permanent | null {
  const s = c.s;
  const card = s.cards[gearUid];
  if (card.zone !== 'battle') return null;
  const gp = permByPid(s, card.pid);
  if (!gp || gp.perm.crossedOn === undefined) return null;
  const hp = permByPid(s, gp.perm.crossedOn);
  return hp && hp.owner === gp.owner ? hp.perm : null;
}

export function mkCC(c: Ctx, controller: PlayerId, extra: Partial<CC> = {}): CC {
  return { c, controller, self: null, vars: {}, ...extra };
}

// ───────────────────────── 変数 ─────────────────────────

export function getVar(cc: CC, name: string): any {
  if (name === '$self') {
    return cc.self == null ? null : { uid: cc.self, ep: cc.c.s.cards[cc.self].ep };
  }
  // 誘発したイベントのカード(いまのゾーンで参照する。呪文を唱えた後に墓地にある、など)
  if (name === '$ev.card') {
    const u = cc.event?.card;
    return typeof u === 'number' ? { uid: u, ep: cc.c.s.cards[u].ep } : null;
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
  if ('evLen' in o) {
    const v = cc.event?.[o.evLen];
    return Array.isArray(v) ? v.length : 0;
  }
  if ('distinct' in o) {
    const set = new Set<number>();
    for (const u of selectCards(cc, o.distinct.sel)) set.add(costBase(cc.c, u));
    return set.size;
  }
  if ('under' in o) {
    const uids = varUids(cc, o.under, { ignoreEp: true });
    if (uids.length === 0) return 0;
    const card = cc.c.s.cards[uids[0]];
    if (card.zone !== 'battle') return 0;
    const pm = permByPid(cc.c.s, card.pid);
    return pm ? Math.max(0, pm.perm.cards.length - 1) : 0;
  }
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
  if ('mul' in o) return o.mul.reduce((a: number, x: Expr) => a * evalExpr(cc, x), 1);
  if ('powerOf' in o) {
    const uids = varUids(cc, o.powerOf, { ignoreEp: true });
    return uids.length === 0 ? 0 : charsOf(cc.c, uids[0], -1).power;
  }
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
    const q = o.shields;
    const who = q.who === 'opponent' ? opponentOf(cc.controller) : cc.controller;
    const n = s.players[who].shield.filter((u) => !broken.includes(u)).length;
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
  if ('some' in o) return varUids(cc, o.some.var, { ignoreEp: true }).some((u) => evalCond({ ...cc, it: u, itFace: -1 }, o.some.where));
  if ('isSelf' in o) return cc.it != null && cc.it === cc.self;
  if ('faceUp' in o) return cc.it != null && !!s.cards[cc.it].up;
  if ('altUsed' in o) return cc.self != null && s.usage['alt:' + cc.self + ':' + o.altUsed] === s.turn;
  if ('nameHas' in o) return cc.it != null && cc.c.reg.defs[s.cards[cc.it].defId].name.includes(o.nameHas);
  if ('onBase' in o) {
    const base = cc.event?.base?.[0];
    return typeof base === 'number' && evalCond({ ...cc, it: base, itFace: -1 }, o.onBase);
  }
  if ('powerRank' in o) {
    if (cc.it == null) return false;
    const powers = selectCards(cc, o.powerRank.of).map((u) => charsOf(cc.c, u, -1).power);
    if (powers.length === 0) return false;
    const want = o.powerRank.which === 'max' ? Math.max(...powers) : Math.min(...powers);
    return charsOf(cc.c, cc.it, -1).power === want;
  }
  if ('allSame' in o) {
    const uids = varUids(cc, o.allSame.var, { ignoreEp: true });
    if (uids.length === 0) return false;
    const cost0 = costBase(cc.c, uids[0]);
    return uids.every((u) => costBase(cc.c, u) === cost0 && (!o.allSame.where || evalCond({ ...cc, it: u, itFace: -1 }, o.allSame.where)));
  }
  if ('eventIs' in o) return !!cc.event && Object.entries(o.eventIs).every(([k, v]) => cc.event![k] === v);
  if ('hasCip' in o) {
    if (cc.it == null) return false;
    const cd = s.cards[cc.it];
    const fi = (cc.itFace ?? -1) >= 0 ? cc.itFace! : cd.zone === 'battle' || cd.zone === 'limbo' ? cd.face : 0;
    return cc.c.reg.getInfo(cd.defId, fi).triggers.some((t) => {
      const sp = t.ability.spec;
      if (t.ability.gen || sp.subject !== 'self') return false;
      const ons = Array.isArray(sp.on) ? sp.on : [sp.on];
      return ons.some((on) => on.type === 'entered' && on.via === undefined);
    });
  }
  if ('hyper' in o) {
    if (cc.self == null || s.cards[cc.self].zone !== 'battle') return false;
    return !!permByPid(s, s.cards[cc.self].pid)?.perm.hyper;
  }
  // S・トリガーとして使って、出た/唱えた(S・トリガー・プラスのP能力の条件)
  if ('stUsed' in o) return !!(cc.event && (cc.event.type === 'cast' || cc.event.type === 'entered') && s.usage['st:' + cc.event.card] === cc.event.id);
  // ゲーム中に1度の能力を、まだ使っていない(markUsed で記録する)
  if ('unused' in o) return cc.self == null || !cc.c.s.usage['once:' + cc.self + ':' + o.unused];
  if ('notInBattle' in o) {
    if (cc.self == null) return true;
    const def = s.cards[cc.self].defId;
    return !s.players[cc.controller].battle.some((p) => s.cards[p.cards[0]].defId === def);
  }
  if ('logged' in o) {
    const min = o.logged.min ?? 1;
    let n = 0;
    let from = 0;
    if (o.logged.since) {
      for (let i = s.turnLog.length - 1; i >= 0; i--) {
        if (s.turnLog[i].type === o.logged.since) {
          from = i + 1;
          break;
        }
      }
    }
    for (let i = from; i < s.turnLog.length; i++) if (matchPattern(cc, o.logged.pattern, s.turnLog[i])) n++;
    return n >= min;
  }
  if ('crossed' in o) {
    if (cc.self == null) return false;
    return (crossHostOf(cc.c, cc.self) !== null) === o.crossed;
  }
  if ('hostIs' in o) {
    if (cc.self == null) return false;
    const host = crossHostOf(cc.c, cc.self);
    return host !== null && evalCond({ ...cc, it: host.cards[0], itFace: s.cards[host.cards[0]].face }, o.hostIs);
  }
  if ('hasGear' in o) {
    if (cc.self == null) return false;
    const sp = permByPid(s, s.cards[cc.self].pid);
    if (!sp) return false;
    return s.players[s.cards[cc.self].owner].battle.some((g) => g.crossedOn === sp.perm.pid);
  }
  if ('ownedBy' in o) {
    if (cc.it == null) return false;
    return (s.cards[cc.it].owner === cc.controller) === (o.ownedBy === 'self');
  }
  if ('baseFor' in o) {
    if (cc.it == null) return false;
    const evoUid = varUids(cc, o.baseFor, { ignoreEp: true })[0];
    if (evoUid === undefined) return false;
    const evoDef = cc.c.reg.defs[s.cards[evoUid].defId];
    const evoFace = evoDef.faces.find((x) => x.evolveFrom);
    if (!evoFace?.evolveFrom) return false;
    return evalCond({ ...cc, self: evoUid, it: cc.it, itFace: s.cards[cc.it].face, evo: true }, evoFace.evolveFrom);
  }
  if ('hasKw' in o) {
    const hk = permByPid(s, s.cards[cc.it ?? -1]?.pid ?? -1);
    return cc.it != null && s.cards[cc.it].zone === 'battle' && hk != null && hasKeyword(cc.c, hk.perm, o.hasKw);
  }
  if ('selfTapped' in o) {
    if (cc.self == null) return false;
    const sp = permByPid(s, s.cards[cc.self].pid);
    return sp !== null && sp !== undefined && s.cards[cc.self].zone === 'battle' && sp.perm.tapped === o.selfTapped;
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
  const ch = 'power' in o ? charsOf(cc.c, it, cc.itFace ?? -1) : charsLite(cc.c, it, cc.itFace ?? -1);
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
    const q = o.power;
    if (q.lte !== undefined && p > evalExpr(cc, q.lte)) return false;
    if (q.gte !== undefined && p < evalExpr(cc, q.gte)) return false;
    if (q.lt !== undefined && !(p < evalExpr(cc, q.lt))) return false;
    if (q.gt !== undefined && !(p > evalExpr(cc, q.gt))) return false;
    return true;
  }
  if ('type' in o) {
    if (cc.evo && o.type === 'creature' && ch.type === 'tamaseed') {
      const cd = s.cards[it];
      if (cd.zone === 'battle' && cc.c.reg.getInfo(cd.defId, cd.face).shinkalize) return true;
    }
    return matchesType(ch.type, o.type);
  }
  if ('evolution' in o) {
    const isEvo = ch.type === 'evolution' || ch.type === 'smaxEvolution';
    return isEvo === o.evolution;
  }
  if ('race' in o) {
    // ツインパクトは、バトルゾーン以外ではどちらの面の種族も持つ
    const card = s.cards[it];
    if ((cc.itFace ?? -1) < 0 && card.zone !== 'battle' && card.zone !== 'limbo') {
      return cc.c.reg.defs[card.defId].faces.some((f) => (f.races ?? []).some((r) => r.includes(o.race)));
    }
    return ch.races.some((r) => r.includes(o.race));
  }
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
        if (sel.of && s.cards[uid].zone !== z) continue; // 変数のカードのうち、そのゾーンに今あるものだけ
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
          if (pm && !canBeChosen(cc.c, pm.perm, cc.controller, cc.self)) continue;
        }
        out.push(uid);
      }
    }
  }
  // 「相手がクリーチャーを選ぶなら、可能ならこのクリーチャーを選ぶ」(同期の妖精)
  if (sel.chooseable && out.length > 1 && gameHas(cc.c, 'mustBeChosen')) {
    const taunt = out.filter((u) => {
      const cd = s.cards[u];
      return cd.zone === 'battle' && cd.owner !== cc.controller && infoOf(cc.c, u).statics.some((st) => st.ability.mod.type === 'mustBeChosen');
    });
    if (taunt.length > 0) return taunt;
  }
  return out;
}

/** 面の種類が、条件・セレクタの type に合うか('element' = 呪文以外のバトルゾーンのカード) */
export function matchesType(t: FaceType, want: string): boolean {
  switch (want) {
    case 'creature': return isCreatureType(t);
    case 'spell': return t === 'spell';
    case 'element': return t !== 'spell';
    case 'card': return true;
    default: return t === want; // tamaseed / field / crossgear
  }
}

/** セレクタの type に合うか。合うなら判定に使う面(-1=面0)を、合わなければ null を返す。 */
function faceHint(cc: CC, uid: number, type: Selector['type']): number | null {
  const s = cc.c.s;
  const card = s.cards[uid];
  const def = cc.c.reg.defs[card.defId];
  if (card.zone === 'battle' || card.zone === 'limbo') {
    const f = def.faces[card.face] ?? def.faces[0];
    if (!type || type === 'card') return card.face;
    return matchesType(f.type, type) ? card.face : null;
  }
  if (!type || type === 'card') return -1;
  const idx = def.faces.findIndex((f) => matchesType(f.type, type));
  return idx < 0 ? null : idx;
}

// ───────────────────────── イベントパターン ─────────────────────────

/**
 * イベントがパターンに合うか。owner/controller/player は cc.controller から見た相対('self'/'opponent'/'any')。
 */
export function matchPattern(cc: CC, pat: Pattern, ev: Ev): boolean {
  const s = cc.c.s;
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
  // beforeBreak など: 攻撃しているのが、この能力の発生源自身
  if (pat.selfAttacker && (cc.self == null || ev.attacker !== s.cards[cc.self].pid)) return false;
  if (pat.notVia !== undefined && ev.via === pat.notVia) return false;
  if (pat.targetKind !== undefined && ev.target?.kind !== pat.targetKind) return false;
  if (pat.ex !== undefined && !!ev.ex !== pat.ex) return false;
  if (pat.step !== undefined && ev.step !== pat.step) return false;
  if (pat.paid !== undefined && ev.paid !== pat.paid) return false;
  if (pat.free !== undefined && !!ev.free !== pat.free) return false;
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
  if (pat.broke !== undefined && !!ev.broke !== pat.broke) return false;
  // クロスギアをクロスしているクリーチャーが攻撃する時
  if (pat.hostAttacker) {
    if (cc.self == null) return false;
    const host = crossHostOf(cc.c, cc.self);
    if (!host || ev.attacker !== host.pid) return false;
  }
  if (pat.attackerCond) {
    const uid: number | undefined = ev.card;
    if (uid === undefined) return false;
    if (!evalCond({ ...cc, it: uid, itFace: -1 }, pat.attackerCond)) return false;
  }
  // イベントのカード(出た・唱えた・離れたカードなど)が満たす条件
  if (pat.cond) {
    const uid: number | undefined = ev.card;
    if (uid === undefined) return false;
    if (!evalCond({ ...cc, it: uid, itFace: typeof ev.face === 'number' ? ev.face : -1 }, pat.cond)) return false;
  }
  return true;
}
