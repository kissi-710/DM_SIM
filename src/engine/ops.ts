// 原始操作(effects 6.3 / 8): イベント発行・誘発の収集・ゾーン移動・置換パイプライン。
// 規約: 入力待ち(ask)は、状態を変更する前に行う。再実行しても二重に変更されない。
import type { Ability, Pattern, TriggerSpec } from './ast';
import { evalCond, matchPattern, mkCC } from './cond';
import { activeStatics, cannotLeave, charsLite, deckLocked, infoOf, isIgnored, manaCivs, payNeed } from './derive';
import type { Ctx } from './state';
import { gameHas, nextId, opponentOf, permByPid, shuffleInPlace, snapOf } from './state';
import {
  type AbilityRef,
  type Ev,
  type InputSpec,
  NeedInput,
  type Pending,
  type Permanent,
  type PlayerId,
  type PoolEntry,
  type ZoneName,
} from './types';
import { kindOfType } from './types';

// ───────────────────────── 質問(ask) ─────────────────────────

/**
 * 入力を求める。回答が揃っていれば返し、無ければ NeedInput を投げて drive に止めさせる。
 * 状態を変更した後に呼ぶとバグになるので検査する。
 */
export function ask<T = any>(c: Ctx, spec: Omit<Pending, 'id'>): T {
  const s = c.s;
  if (c.askIdx < s.rans.length) return s.rans[c.askIdx++] as T;
  if (s.rng !== c.rng0 || s.seq !== c.seq0) {
    throw new Error(`内部エラー: 状態を変更した後に入力を求めました(${spec.why})`);
  }
  throw new NeedInput(spec);
}

// ───────────────────────── 聞き手のいるイベント ─────────────────────────

const listenCache = new WeakMap<object, Map<string, boolean>>();

/**
 * この対局のデッキに、そのイベント(battleStarted / afterBattle / beforeBreak など)を聞く誘発型能力があるか。
 * 聞き手がいる時だけイベントを発行する(段階を増やさず、聞き手のいない対戦の記録を変えない)ために使う。
 * カードDB全体ではなく、対局のデッキで調べる(デッキが分からない状態では、カードDB全体で調べる)。
 */
export function listens(c: Ctx, type: string): boolean {
  const byDef = c.reg.trigByDef.get(type);
  if (!byDef) return false;
  const ids = c.s.deckIds;
  if (ids[0].length === 0 || ids[1].length === 0) return true;
  let m = listenCache.get(ids);
  if (!m) {
    m = new Map();
    listenCache.set(ids, m);
  }
  let hit = m.get(type);
  if (hit === undefined) {
    hit = ids.some((list) => list.some((d) => byDef.has(d)));
    m.set(type, hit);
  }
  return hit;
}

// ───────────────────────── イベント ─────────────────────────

export function emit(c: Ctx, type: string, payload: Record<string, any> = {}): Ev {
  const s = c.s;
  const ev: Ev = { id: nextId(s), causedBy: c.cause, type, turn: s.turn, ...payload };
  c.out.push(ev);
  s.turnLog.push(ev);
  return ev;
}

// ───────────────────────── 誘発の収集(effects 5.1) ─────────────────────────

const WATCH_DEFAULT: ZoneName[] = ['battle'];

/** イベントを監視している能力を探して、待機プールに入れる。 */
export function collect(c: Ctx, ev: Ev): void {
  const byDef = c.reg.trigByDef.get(ev.type);
  if (!byDef) return;
  const s = c.s;
  // 定義IDごとに、そのカードがどこにあるかを走査
  const batch = s.batchNo;
  for (let uid = 0; uid < s.cards.length; uid++) {
    const card = s.cards[uid];
    const refs = byDef.get(card.defId);
    if (!refs) continue;
    // バトルゾーンでは山の一番上だけが能力を持つ
    if (card.zone === 'battle') {
      const pm = permByPid(s, card.pid);
      if (!pm || pm.perm.cards[0] !== uid) continue;
      if (s.effects.length > 0 && isIgnored(c, uid)) continue; // 能力を無視されている
    }
    for (const r of refs) {
      const spec = r.ability.spec;
      const watch = spec.watch ?? WATCH_DEFAULT;
      if (!watch.includes(card.zone)) continue;
      // 使用中の面(バトルゾーン)。場以外では面0の能力だけが働く
      if (card.zone === 'battle' ? r.face !== card.face : r.face !== 0) continue;
      tryTrigger(c, ev, uid, r.face, r.idx, r.ability.spec, batch);
    }
  }
  // バトルゾーンを離れたカード自身の、離れた時の能力(lookBack)。離れる直前の面の能力を使う
  if (ev.type === 'moved' && ev.from === 'battle' && !ev.underneath && ev.lki) {
    const uid: number = ev.card;
    const card = s.cards[uid];
    const refs = card && card.zone !== 'battle' ? byDef.get(card.defId) : undefined;
    if (refs) {
      for (const r of refs) {
        if (!r.ability.spec.lookBack || r.face !== ev.lki.face) continue;
        tryTrigger(c, ev, uid, r.face, r.idx, r.ability.spec, batch);
      }
    }
  }
}

/** 回数制限(limit)の記録のキー。誘発の判定と、使った回数の更新で同じキーを使う */
function limitKey(uid: number, ep: number, face: number, idx: number): string {
  return `${uid}:${ep}:${face}:${idx}`;
}

function tryTrigger(c: Ctx, ev: Ev, uid: number, face: number, idx: number, spec: TriggerSpec, batch: number): void {
  const s = c.s;
  const card = s.cards[uid];
  const controller = card.owner;
  // 評価コンテキスト(スナップショットを作る)は高くつくので、安い判定を先に済ませる。ここまでの判定は、どれも状態を書き換えない
  if (spec.subject === 'self' && ev.card !== uid) return;
  if (spec.subject === 'other' && ev.card === uid) return;
  if (spec.turn === 'own' && s.active !== controller) return;
  if (spec.turn === 'opponent' && s.active === controller) return;
  const cc = mkCC(c, controller, { self: uid, selfSnap: snapOf(c, uid), event: ev });
  const ons = Array.isArray(spec.on) ? spec.on : [spec.on];
  if (!ons.some((p: Pattern) => matchPattern(cc, p, ev))) return;
  if (spec.nthThisTurn !== undefined) {
    let n = 0;
    for (const e of s.turnLog) {
      if (e.type === ev.type && e.owner === ev.owner && e.kind === ev.kind) n++;
      if (e.id === ev.id) break;
    }
    if (n !== spec.nthThisTurn) return;
  }
  if (spec.nthMin !== undefined) {
    let n = 0;
    for (const e of s.turnLog) {
      if (e.type === ev.type && e.owner === ev.owner && (ev.cause === undefined || e.cause === ev.cause)) n++;
      if (e.id === ev.id) break;
    }
    if (n < spec.nthMin) return;
  }
  if (spec.limit) {
    const key = limitKey(uid, card.ep, face, idx);
    const used = s.usage[key];
    if (used === s.turn && (s.usage[key + '#'] ?? 0) >= spec.limit.perTurn) return;
  }
  // spec.if は、誘発した時点では見ない(総合ルール 603.4: 解決の時点で条件を満たしていれば解決される)

  const ref: AbilityRef = { defId: card.defId, face, idx };
  // トリガー抑制(キーナリー): 置換効果の一種として処理する。
  if (suppressesTrigger(c, ev, uid, controller)) return;

  if (spec.limit) {
    const key = limitKey(uid, card.ep, face, idx);
    if (s.usage[key] !== s.turn) s.usage[key + '#'] = 0;
    s.usage[key] = s.turn;
    s.usage[key + '#'] = (s.usage[key + '#'] ?? 0) + 1;
  }
  const entry: PoolEntry = {
    id: nextId(s),
    batch,
    ability: ref,
    kind: 'ability',
    source: { uid, ep: card.ep },
    lki: snapOf(c, uid),
    controller,
    event: ev,
    stLayer: false,
  };
  s.pool.push(entry);
  // 「能力がトリガーした時」(オルゲイト)は、実際に誘発した能力だけを見る
  const prev = c.cause;
  const trig = emit(c, 'abilityTriggered', { ability: ref, source: uid, controller, cause: ev, entry: entry.id });
  c.cause = prev;
  collect(c, trig);
}

/** 相手のクリーチャーが出てその能力がトリガーする時、かわりにトリガーしない(置換効果) */
function suppressesTrigger(c: Ctx, ev: Ev, srcUid: number, controller: PlayerId): boolean {
  if (ev.type !== 'entered') return false;
  // 出たクリーチャー自身の能力だけが対象
  if (ev.card !== srcUid) return false;
  const s = c.s;
  for (const p of [0, 1] as PlayerId[]) {
    for (const perm of s.players[p].battle) {
      const uid = perm.cards[0];
      const info = infoOf(c, uid);
      for (const r of info.replaces) {
        if (r.ability.apply.type !== 'cancelTrigger') continue;
        if (r.ability.while && !evalCond(mkCC(c, p, { self: uid }), r.ability.while)) continue;
        const cc = mkCC(c, p, { self: uid });
        const pat: Pattern = { ...r.ability.match };
        // match.type は abilityTriggered(元のイベント種別は causeType)
        if (!matchPattern(cc, { ...pat, type: 'abilityTriggered' }, { ...ev, type: 'abilityTriggered', controller, cause: ev })) continue;
        if (ev.owner !== p) return true;
      }
    }
  }
  return false;
}

/** 現在のバッチで発生したイベントの誘発をまとめて収集する */
export function collectBatch(c: Ctx, evs: Ev[]): void {
  // 「発生源がいる間」の継続効果は、発生源がゾーンを離れたら失効する(spec 3.13-6)
  const s = c.s;
  if (s.effects.some((e) => e.until.kind === 'source')) {
    s.effects = s.effects.filter((e) => e.until.kind !== 'source' || s.cards[e.until.uid].ep === e.until.ep);
  }
  for (const ev of evs) collect(c, ev);
}

// ───────────────────────── ゾーン移動 ─────────────────────────

export interface MoveOpts {
  to: ZoneName;
  cause: string;
  /** 山札の上/下(deck のみ) */
  pos?: 'top' | 'bottom';
  /** 重ねる山(進化・侵略) */
  onto?: number;
  via?: string;
  /** バトルゾーンへ出す時にタップ状態か */
  tapped?: boolean;
  /** 支払ったマナの枚数(entered イベント用) */
  paid?: number;
  /** 軽減後のコスト・無料かどうか(entered イベントの記録用) */
  cost?: number;
  free?: boolean;
  /** 置換を適用しない(置換の結果の出来事) */
  noReplace?: boolean;
  /** 追加のイベント属性 */
  face?: number;
  /** 進化・侵略などで下に入るカードを一緒に動かさない */
  alone?: boolean;
  /**
   * このカードの下に重ねるカード(無月の門・超無限墓地進化など)。どのゾーンのカードでもよい。
   * バトルゾーンのカードは、その山ごと下に入る。
   */
  under?: number[];
  /** 出す前にいたゾーン(プレイ中は limbo にいるので、元のゾーンを伝える。置換の判定に使う) */
  from?: ZoneName;
  /** この移動を起こした効果の使い手(置換の判定に使う。イベントには載せない) */
  by?: PlayerId;
}

export interface MoveResult {
  uid: number;
  moved: boolean;
  to: ZoneName;
  ep: number;
}

/**
 * クリーチャーが召喚された後の処理: 「このターン、次に召喚する自分のクリーチャー」の効果を使い切る。
 * sa の効果は、召喚されたクリーチャーに、そのターンのスピードアタッカーを与える。
 */
export function onSummoned(c: Ctx, uid: number): void {
  const s = c.s;
  if (s.effects.length === 0) return;
  const card = s.cards[uid];
  const mine = s.effects.filter((e) => e.mod.kind === 'nextSummon' && e.controller === card.owner);
  if (mine.length === 0) return;
  s.effects = s.effects.filter((e) => !(e.mod.kind === 'nextSummon' && e.controller === card.owner));
  if (card.zone === 'battle' && mine.some((e) => e.mod.kind === 'nextSummon' && e.mod.sa)) {
    s.effects.push({ id: nextId(s), pid: card.pid, mod: { kind: 'grant', keyword: 'speedAttacker' }, until: { kind: 'endOfTurn', turn: s.turn }, controller: card.owner });
  }
}

/** 封印を1つ墓地に置く: owner の、cmdCivs と同じ文明を持つ封印されたクリーチャーのそれぞれから、封印を1つ */
function releaseSeals(c: Ctx, owner: PlayerId, cmdCivs: string[], evs: Ev[]): void {
  const s = c.s;
  for (const perm of s.players[owner].battle) {
    if (!perm.seals?.length) continue;
    const top = s.cards[perm.cards[0]];
    const civs = c.reg.getFace(top.defId, top.face).civs as string[];
    if (!civs.some((x) => cmdCivs.includes(x))) continue;
    const u = perm.seals.shift()!;
    if (perm.seals.length === 0) delete perm.seals;
    const uc = s.cards[u];
    const usnap = snapOf(c, u);
    uc.zone = 'grave';
    uc.ep++;
    uc.pid = -1;
    s.players[uc.owner].grave.push(u);
    evs.push(emit(c, 'moved', { card: u, owner: uc.owner, from: 'battle', to: 'grave', cause: 'sealRelease', kind: 'creature', ex: false, lki: usnap, underneath: true }));
  }
}

/**
 * カードを、持ち主の山札の上から n 枚目の位置に、横向きに刺す(終葬 5.S.D.)。横向きのカードを手札に加えたプレイヤーは、ゲームに負ける
 */
export function stabIntoDeck(c: Ctx, uids: number[], depth: number): void {
  const s = c.s;
  const evs: Ev[] = [];
  for (const uid of uids) {
    const card = s.cards[uid];
    const from = card.zone;
    const snap = snapOf(c, uid);
    removeFromZone(c, uid);
    const deck = s.players[card.owner].deck;
    deck.splice(Math.min(depth - 1, deck.length), 0, uid);
    card.zone = 'deck';
    card.ep++;
    card.pid = -1;
    card.tapped = false;
    card.ex = false;
    card.exPid = -1;
    card.face = 0;
    delete card.up;
    card.side = true;
    evs.push(emit(c, 'moved', { card: uid, owner: card.owner, from, to: 'deck', cause: 'stab', kind: 'creature', ex: false, lki: snap }));
  }
  s.batchNo++;
  collectBatch(c, evs);
  s.dirtySba = true;
}

/** カードをいまのゾーンから取り除く(置き先は呼び出し側が決める) */
export function removeZoneCard(c: Ctx, uid: number): void {
  removeFromZone(c, uid);
}

function removeFromZone(c: Ctx, uid: number): void {
  const s = c.s;
  const card = s.cards[uid];
  const own = s.players[card.owner];
  switch (card.zone) {
    case 'deck':
    case 'hand':
    case 'mana':
    case 'shield':
    case 'grave':
    case 'hyper': {
      const arr = own[card.zone];
      const i = arr.indexOf(uid);
      if (i >= 0) arr.splice(i, 1);
      break;
    }
    case 'limbo': {
      const i = s.limbo.indexOf(uid);
      if (i >= 0) s.limbo.splice(i, 1);
      break;
    }
    case 'battle': {
      const pm = permByPid(s, card.pid);
      if (pm) {
        const i = pm.perm.cards.indexOf(uid);
        if (i >= 0) pm.perm.cards.splice(i, 1);
        if (pm.perm.cards.length === 0) {
          const b = s.players[pm.owner].battle;
          b.splice(b.indexOf(pm.perm), 1);
        }
      }
      break;
    }
  }
}

function placeInZone(c: Ctx, uid: number, to: ZoneName, pos: 'top' | 'bottom' | undefined): void {
  const s = c.s;
  const card = s.cards[uid];
  const own = s.players[card.owner];
  switch (to) {
    case 'deck':
      if (pos === 'bottom') own.deck.push(uid);
      else own.deck.unshift(uid);
      break;
    case 'hand':
    case 'mana':
    case 'shield':
    case 'grave':
    case 'hyper':
      own[to].push(uid);
      break;
    case 'limbo':
      s.limbo.push(uid);
      break;
    case 'battle':
      throw new Error('battle への移動は enterBattle を使う');
  }
}

/** ゾーン移動の提案。置換を判定し、実際の移動先を決める。 */
interface Proposal {
  uid: number;
  from: ZoneName;
  to: ZoneName;
  cause: string;
  pos?: 'top' | 'bottom';
  /** 実行しない(置換でキャンセルされた) */
  cancelled?: boolean;
  /** 代わりに行う操作 */
  also?: { kind: 'exShieldToGrave'; shield: number } | { kind: 'smaxSacrifice'; picks: number[] } | { kind: 'steps'; ref: AbilityRef; /** 手順を持つカード(省略 = 動くカード自身) */ src?: number };
  replaced?: boolean;
  by?: PlayerId;
}

/**
 * カードを移動する(バッチ)。置換効果を判定し、移動し、イベントを発行して誘発を収集する。
 * 置換の選択が必要なら、状態を変更する前に ask する。
 */
export function moveCards(c: Ctx, uids: number[], opts: MoveOpts): MoveResult[] {
  const s = c.s;
  const proposals: Proposal[] = [];
  for (const uid of uids) {
    const card = s.cards[uid];
    proposals.push({ uid, from: card.zone, to: opts.to, cause: opts.cause, pos: opts.pos, by: opts.by });
  }
  // フェーズA: 置換の判定(状態を変更しない)
  if (!opts.noReplace) {
    for (const p of proposals) applyReplacements(c, p);
  }
  // フェーズB: 実行
  const results: MoveResult[] = [];
  const evs: Ev[] = [];
  for (const p of proposals) {
    if (p.cancelled && !p.also) {
      results.push({ uid: p.uid, moved: false, to: p.from, ep: s.cards[p.uid].ep });
      continue;
    }
    if (p.also?.kind === 'exShieldToGrave') {
      // EXライフ: かわりにシールドを墓地に置く(クリーチャーは離れない)
      const sh = p.also.shield;
      doMove(c, sh, 'grave', 'exLifeSwap', undefined, evs, opts);
      results.push({ uid: p.uid, moved: false, to: p.from, ep: s.cards[p.uid].ep });
      continue;
    }
    if (p.also?.kind === 'smaxSacrifice') {
      for (const u of p.also.picks) doMove(c, u, 'grave', 'destroy', undefined, evs, { ...opts, noReplace: true });
      results.push({ uid: p.uid, moved: false, to: p.from, ep: s.cards[p.uid].ep });
      continue;
    }
    if (p.also?.kind === 'steps') {
      // かわりに、そのカードの手順を行う(手札から捨てられる時に出す、など)。手順は、いまの処理の後に行う
      const card = s.cards[p.uid];
      const src = p.also.src ?? p.uid;
      const sc = s.cards[src];
      // 手順の中から、動くはずだったカードを `$ev.card` で参照できるようにする
      const evp: Ev = { id: nextId(s), causedBy: null, type: 'replaced', turn: s.turn, card: p.uid, owner: card.owner };
      s.cont.push({
        kind: 'effect',
        id: nextId(s),
        causedBy: c.cause,
        ability: p.also.ref,
        source: { uid: src, ep: sc.ep },
        lki: snapOf(c, src),
        controller: sc.owner,
        pc: 0,
        vars: {},
        trigger: evp,
        noOptional: true,
      });
      results.push({ uid: p.uid, moved: false, to: p.from, ep: card.ep });
      continue;
    }
    const r = doMove(c, p.uid, p.to, p.cause, p.pos, evs, opts);
    results.push(r);
  }
  s.batchNo++;
  collectBatch(c, evs);
  s.dirtySba = true;
  return results;
}

/** マナゾーンに置かれる時にタップ状態か。多色カード(ツインパクトは両面の和集合)はタップして置く(spec 3.4.1 M-1)。 */
function entersManaTapped(c: Ctx, uid: number, opts: MoveOpts): boolean {
  if (gameHas(c, 'oppManaTapped') && activeStatics(c, 'oppManaTapped').some((st) => st.controller !== c.s.cards[uid].owner)) return true; // 相手のカードは、マナゾーンにタップして置かれる(影速 ザ・トリッパー)
  return manaCivs(c, uid).length > 1 || !!opts.tapped;
}

/** 実際の移動(置換は済んでいる)。進化の山は下のカードも一緒に動かす。 */
function doMove(c: Ctx, uid: number, to: ZoneName, cause: string, pos: 'top' | 'bottom' | undefined, evs: Ev[], opts: MoveOpts): MoveResult {
  const s = c.s;
  const card = s.cards[uid];
  const from = card.zone;
  const snap = snapOf(c, uid);
  const kind = kindOfType(charsLite(c, uid, card.zone === 'battle' || card.zone === 'limbo' ? card.face : -1).type);
  const wasEx = card.ex;
  // 山(進化元)を一緒に動かす
  let under: number[] = [];
  let sealCards: number[] = [];
  if (from === 'battle' && to !== 'battle' && !opts.alone) {
    const pm = permByPid(s, card.pid);
    if (pm && pm.perm.cards[0] === uid) {
      under = pm.perm.cards.slice(1);
      sealCards = pm.perm.seals?.slice() ?? []; // 封印は、山が離れる時に、墓地に置かれる
    }
    // 山に付いているEXシールドは、離れる時の置換で処理済み
  }
  // 山札に横向きに刺されたカード(終葬 5.S.D.): 山札から出る時に印を外す。手札に加えたプレイヤーは、ゲームに負ける
  if (card.side) {
    delete card.side;
    if (from === 'deck' && to === 'hand') {
      (s.pendingLoss ??= []).push(card.owner);
      s.dirtySba = true;
    }
  }
  if (to === 'battle') {
    return enterBattle(c, uid, opts, evs);
  }
  // シールドの山: ブレイク・墓地送りでは山ごと動く。それ以外(1枚だけを選んで動かす)は、そのカードだけが抜け、下のカードがシールドになる
  let underShield: number[] = [];
  if (from === 'shield' && s.piles?.[uid]) {
    const pile = s.piles[uid];
    delete s.piles[uid];
    if (cause === 'break' || cause === 'burn') underShield = pile;
    else {
      const list = s.players[card.owner].shield;
      const [nt, ...rest] = pile;
      const i = list.indexOf(uid);
      if (i >= 0) list[i] = nt;
      if (rest.length) s.piles[nt] = rest;
    }
  }
  removeFromZone(c, uid);
  card.zone = to;
  card.ep++;
  card.pid = -1;
  card.tapped = false;
  card.ex = false;
  card.exPid = -1;
  delete card.up;
  if (to === 'mana') card.tapped = entersManaTapped(c, uid, opts);
  card.face = 0;
  placeInZone(c, uid, to, pos);
  evs.push(
    emit(c, 'moved', {
      card: uid,
      owner: card.owner,
      from,
      to,
      cause,
      kind,
      ex: wasEx,
      lki: snap,
      via: opts.via,
    }),
  );
  for (const u of underShield) {
    const uc = s.cards[u];
    const usnap = snapOf(c, u);
    removeFromZone(c, u);
    uc.zone = to;
    uc.ep++;
    uc.pid = -1;
    uc.tapped = to === 'mana' ? entersManaTapped(c, u, opts) : false;
    uc.face = 0;
    delete uc.up;
    placeInZone(c, u, to, pos);
    evs.push(emit(c, 'moved', { card: u, owner: uc.owner, from: 'shield', to, cause, kind: 'creature', ex: false, lki: usnap, underneath: true }));
  }
  for (const u of under) {
    const uc = s.cards[u];
    const usnap = snapOf(c, u);
    removeFromZone(c, u);
    uc.zone = to;
    uc.ep++;
    uc.pid = -1;
    uc.tapped = to === 'mana' ? entersManaTapped(c, u, opts) : false;
    uc.face = 0;
    placeInZone(c, u, to, pos);
    evs.push(emit(c, 'moved', { card: u, owner: uc.owner, from: 'battle', to, cause, kind: 'creature', ex: false, lki: usnap, underneath: true }));
  }
  // 封印されていたカードは、墓地に置かれる
  for (const u of sealCards) {
    const uc = s.cards[u];
    if (uc.zone !== 'battle') continue;
    const usnap = snapOf(c, u);
    uc.zone = 'grave';
    uc.ep++;
    uc.pid = -1;
    uc.face = 0;
    s.players[uc.owner].grave.push(u);
    evs.push(emit(c, 'moved', { card: u, owner: uc.owner, from: 'battle', to: 'grave', cause: 'seal', kind: 'creature', ex: false, lki: usnap, underneath: true }));
  }
  return { uid, moved: true, to, ep: card.ep };
}

// ───────────────────────── バトルゾーンへ出す ─────────────────────────

/** カードをバトルゾーンに出す(新しい山、または onto の山の上)。EXライフもここで処理する。 */
export function enterBattle(c: Ctx, uid: number, opts: MoveOpts, evs: Ev[] = []): MoveResult {
  const s = c.s;
  const card = s.cards[uid];
  const from = card.zone;
  const owner = card.owner;
  const snap = snapOf(c, uid);
  const faceIdx = opts.face ?? card.face ?? 0;
  const via = opts.via ?? 'effect';
  // 出る時の置換(「相手のクリーチャーが出る時、かわりに〜に置く」)。状態を変更する前に判定する
  if (gameHas(c, 'entryReplace') && !opts.noReplace) {
    const rep = entryReplacement(c, uid, opts, faceIdx, via);
    if (rep) return applyEntryReplacement(c, uid, rep);
  }
  removeFromZone(c, uid);
  card.zone = 'battle';
  card.ep++;
  card.face = faceIdx;
  card.tapped = false;
  let perm: Permanent;
  let base: number[] = [];
  if (opts.under && opts.under.length > 0) {
    // 下に重ねるカードを集める(バトルゾーンのカードは山ごと。他のゾーンのカードは、バトルゾーンへ移す)
    const pile: number[] = [uid];
    const seen = new Set<number>();
    for (const u of opts.under) {
      const uc = s.cards[u];
      if (uc.zone === 'battle') {
        if (seen.has(uc.pid)) continue;
        seen.add(uc.pid);
        const pm = permByPid(s, uc.pid);
        if (!pm) continue;
        pile.push(...pm.perm.cards);
        const b = s.players[pm.owner].battle;
        b.splice(b.indexOf(pm.perm), 1);
      } else {
        const ufrom = uc.zone;
        const usnap = snapOf(c, u);
        removeFromZone(c, u);
        uc.zone = 'battle';
        uc.ep++;
        uc.tapped = false;
        uc.face = 0;
        pile.push(u);
        evs.push(emit(c, 'moved', { card: u, owner: uc.owner, from: ufrom, to: 'battle', cause: opts.cause, kind: 'creature', ex: false, lki: usnap, underneath: true }));
      }
    }
    perm = { pid: s.nextPid++, cards: pile, tapped: !!opts.tapped, sick: true, enteredTurn: s.turn };
    for (const u of pile) s.cards[u].pid = perm.pid;
    base = pile.slice(1);
    s.players[owner].battle.push(perm);
  } else if (opts.onto !== undefined) {
    const pm = permByPid(s, opts.onto);
    if (!pm) throw new Error('重ねる山がありません');
    perm = pm.perm;
    base = perm.cards.slice();
    perm.cards.unshift(uid);
    card.pid = perm.pid;
    // L3(総合ルール 801.2 で確認済み): 進化しても同一のクリーチャーとして扱い、タップ・召喚酔い・
    // 適用されている継続効果は進化後も続く。出たターンだけ更新する
    perm.enteredTurn = s.turn;
  } else {
    // 各ターン、はじめて出る相手のクリーチャーは、タップして出る
    let tappedIn = !!opts.tapped;
    if (!tappedIn && gameHas(c, 'enterTapped')) {
      if (!s.turnLog.some((e) => e.type === 'entered' && e.owner === owner)) tappedIn = activeStatics(c, 'enterTappedFirst').some((st) => st.controller !== owner);
      if (!tappedIn) tappedIn = activeStatics(c, 'enterTapped').some((st) => st.controller !== owner);
    }
    perm = {
      pid: s.nextPid++,
      cards: [uid],
      tapped: tappedIn,
      sick: true,
      enteredTurn: s.turn,
    };
    card.pid = perm.pid;
    s.players[owner].battle.push(perm);
  }
  const ekind = kindOfType(c.reg.getFace(card.defId, faceIdx).type);
  evs.push(emit(c, 'moved', { card: uid, owner, from, to: 'battle', cause: opts.cause, kind: ekind, ex: false, lki: snap, via }));
  // 侵略でバトルゾーンの別の山から移動する場合は「出た」扱いにならない(decks.md)
  const fromBattle = from === 'battle';
  if (!fromBattle) {
    // 出た元のゾーン。「山札から出た時」などを見る能力があるゲームだけ、イベントに残す(既存の対戦の記録を変えない)
    const efrom = opts.from ?? from;
    evs.push(emit(c, 'entered', { card: uid, owner, via, paid: opts.paid ?? 0, cost: opts.cost, free: !!opts.free, pid: perm.pid, kind: ekind, face: faceIdx, ...(gameHas(c, 'enteredFrom') ? { from: efrom } : {}) }));
  }
  if (opts.onto !== undefined) {
    evs.push(emit(c, 'evolved', { card: uid, owner, pid: perm.pid, base, via }));
  }
  // コマンドが出た時、その持ち主は、そのコマンドと同じ文明を持つ自身のカードから、封印を1つ墓地に置く
  if (s.sealed && !fromBattle && ekind === 'creature' && (c.reg.getFace(card.defId, faceIdx).races ?? []).some((r) => r.includes('コマンド'))) {
    releaseSeals(c, owner, c.reg.getFace(card.defId, faceIdx).civs, evs);
  }
  // フィールドは、1枚だけ出していられる。新しく出したら、前のフィールドは墓地に置かれる
  if (ekind === 'field' && opts.onto === undefined) {
    const olds = s.players[owner].battle.filter((pm) => pm.pid !== perm.pid && kindOfType(c.reg.getFace(s.cards[pm.cards[0]].defId, s.cards[pm.cards[0]].face).type) === 'field').map((pm) => pm.cards[0]);
    if (olds.length > 0) moveCards(c, olds, { to: 'grave', cause: 'fieldReplace' });
  }
  // EXライフ: 出る時、山札の上1枚をシールドにする
  const info = c.reg.getInfo(card.defId, faceIdx);
  if (info.exLife && opts.onto === undefined) {
    const deck = s.players[owner].deck;
    if (deck.length > 0) {
      const sh = deck[0];
      removeFromZone(c, sh);
      const sc = s.cards[sh];
      sc.zone = 'shield';
      sc.ep++;
      sc.ex = true;
      sc.exPid = perm.pid;
      s.players[owner].shield.push(sh);
      evs.push(emit(c, 'moved', { card: sh, owner, from: 'deck', to: 'shield', cause: 'exLife', kind: 'creature', ex: true, lki: snapOf(c, sh) }));
    }
  }
  return { uid, moved: true, to: 'battle', ep: card.ep };
}


/** 出る時の置換(entryReplacement の結果)を実行する: かわりの行き先に置き、置いた後の手順があれば積む */
export function applyEntryReplacement(c: Ctx, uid: number, rep: NonNullable<ReturnType<typeof entryReplacement>>): MoveResult {
  const s = c.s;
  const card = s.cards[uid];
  // 出ない: いまのゾーン(プレイ中なら、元のゾーン)に残る
  if (!rep.stay || card.zone === 'limbo') moveCards(c, [uid], { to: rep.to, cause: 'replaced', noReplace: true });
  // 置いた後の手順(ベイB セガーレ: その後、自分はこのクリーチャーをマナゾーンに置く)
  if (rep.then) {
    const sc = s.cards[rep.then.src];
    s.cont.push({
      kind: 'effect',
      id: nextId(s),
      causedBy: c.cause,
      ability: { defId: sc.defId, face: sc.face, idx: rep.then.idx },
      source: { uid: rep.then.src, ep: sc.ep },
      lki: snapOf(c, rep.then.src),
      controller: rep.then.owner,
      pc: 0,
      vars: {},
      trigger: null,
      noOptional: true,
    });
  }
  return { uid, moved: false, to: rep.to, ep: s.cards[uid].ep };
}

/**
 * 出る時の置換(match.type = 'enter')。バトルゾーンの、能力を無視されていないカードが持つ。
 * 当てはまるものがあれば、かわりに置く先のゾーンを返す(複数なら、出るカードの持ち主が選ぶ)。
 */
export function entryReplacement(c: Ctx, uid: number, opts: MoveOpts, faceIdx: number, via: string): { to: ZoneName; stay?: boolean; then?: { src: number; idx: number; owner: PlayerId } } | null {
  const s = c.s;
  const card = s.cards[uid];
  const origin = opts.from ?? card.zone;
  const cands: { label: string; to: ZoneName; optional: boolean; stay?: boolean; then?: { src: number; idx: number; owner: PlayerId } }[] = [];
  // 「山札から手札以外のゾーンに置かれる時」の置換(move)も、バトルゾーンへ出る時に当てはまる
  if (origin === 'deck') {
    for (const pl of [0, 1] as PlayerId[]) {
      for (const perm of s.players[pl].battle) {
        const src = perm.cards[0];
        if (src === uid) continue;
        for (const r of infoOf(c, src).replaces) {
          const a = r.ability;
          if (a.match.type !== 'move' || a.apply.type !== 'changeDest' || a.match.from !== 'deck') continue;
          const m = a.match;
          if (m.notTo === 'battle') continue;
          const rel = (want: string | undefined, actual: PlayerId): boolean => want === undefined || want === 'any' || (want === 'self' ? actual === pl : actual !== pl);
          if (!rel(m.owner, card.owner)) continue;
          if (a.while && !evalCond(mkCC(c, pl, { self: src }), a.while)) continue;
          cands.push({ label: a.label ?? 'かわりに置く', to: a.apply.to, optional: !!a.optional });
        }
      }
    }
  }
  for (const p of [0, 1] as PlayerId[]) {
    for (const perm of s.players[p].battle) {
      const src = perm.cards[0];
      if (src === uid) continue;
      const info = infoOf(c, src);
      for (const r of info.replaces) {
        const a = r.ability;
        if (a.match.type !== 'enter' || (a.apply.type !== 'changeDest' && a.apply.type !== 'stay')) continue;
        const m = a.match;
        const rel = (want: string | undefined, actual: PlayerId): boolean => want === undefined || want === 'any' || (want === 'self' ? actual === p : actual !== p);
        if (!rel(m.owner, card.owner)) continue;
        if (m.turn === 'own' && s.active !== p) continue;
        if (m.turn === 'opponent' && s.active === p) continue;
        if (m.via !== undefined && via !== m.via) continue;
        if (m.notVia !== undefined && via === m.notVia) continue;
        if (m.from !== undefined && origin !== m.from) continue;
        if (m.notFrom !== undefined && origin === m.notFrom) continue;
        const cc = mkCC(c, p, { self: src, it: uid, itFace: faceIdx });
        if (a.while && !evalCond(mkCC(c, p, { self: src }), a.while)) continue;
        if (m.cond && !evalCond(cc, m.cond)) continue;
        cands.push({ label: a.label ?? 'かわりに置く', to: a.apply.type === 'stay' ? origin : a.apply.to, optional: !!a.optional, ...(a.apply.type === 'changeDest' && a.apply.then ? { then: { src, idx: r.idx, owner: p } } : {}), ...(a.apply.type === 'stay' ? { stay: true } : {}) });
      }
    }
  }
  if (cands.length === 0) return null;
  let chosen = 0;
  // 同じ行き先に置く強制の置換が重なっているだけなら、どれを使っても同じ(聞かない)
  const sameDest = cands.every((x) => !x.optional && x.to === cands[0].to && !x.then);
  if (!sameDest && (cands.length > 1 || cands[0].optional)) {
    const options = [...cands.map((x) => x.label), '置換しない'];
    const ans = ask<number[]>(c, {
      player: card.owner,
      why: 'replaceChoice',
      input: { shape: 'option', options, pick: 1, repeat: false, allIf: false },
      source: { uid, ep: card.ep },
      prompt: `${c.reg.defs[card.defId].name}: 出る時の置換効果を選んでください`,
    });
    chosen = ans[0];
    if (chosen >= cands.length) return null;
  }
  return { to: cands[chosen].to, ...(cands[chosen].then ? { then: cands[chosen].then } : {}), ...(cands[chosen].stay ? { stay: true } : {}) };
}

// ───────────────────────── 置換パイプライン(effects 8) ─────────────────────────

/**
 * 提案に置換効果を適用する。1つの出来事に1回だけで、連鎖しない(101.5)。
 * 複数あるか任意の場合は、持ち主に選ばせる(ask)。
 */
function applyReplacements(c: Ctx, p: Proposal): void {
  // どのカードの、どの移動にも当てはまる置換(「山札から手札以外のゾーンに置かれる時、かわりに墓地に置く」など)
  if (gameHas(c, 'moveReplace')) {
    applyMoveReplacements(c, p);
    if (p.replaced) return;
  }
  // 手札から捨てられる時の置換(自身の能力)
  if (gameHas(c, 'handReplace') && p.from === 'hand' && p.to === 'grave' && p.cause === 'discard') {
    applyHandReplacement(c, p);
    return;
  }
  applyLeaveReplacements(c, p);
}

/** match.type = 'move': バトルゾーンのカードが持つ、他のカードの移動の置換(changeDest) */
function applyMoveReplacements(c: Ctx, p: Proposal): void {
  const s = c.s;
  const card = s.cards[p.uid];
  const cands: { label: string; to: ZoneName; optional: boolean }[] = [];
  for (const pl of [0, 1] as PlayerId[]) {
    for (const perm of s.players[pl].battle) {
      const src = perm.cards[0];
      const info = infoOf(c, src);
      for (const r of info.replaces) {
        const a = r.ability;
        if (a.match.type !== 'move' || a.apply.type !== 'changeDest') continue;
        const m = a.match;
        const rel = (want: string | undefined, actual: PlayerId): boolean => want === undefined || want === 'any' || (want === 'self' ? actual === pl : actual !== pl);
        if (!rel(m.owner, card.owner)) continue;
        if (m.from !== undefined && p.from !== m.from) continue;
        if (m.notFrom !== undefined && p.from === m.notFrom) continue;
        if (m.to !== undefined && p.to !== m.to) continue;
        if (m.notTo !== undefined && p.to === m.notTo) continue;
        if (m.cause !== undefined && p.cause !== m.cause) continue;
        if (a.apply.to === p.to) continue; // 行き先が変わらない置換は、起こらない
        if (a.while && !evalCond(mkCC(c, pl, { self: src }), a.while)) continue;
        if (m.cond && !evalCond(mkCC(c, pl, { self: src, it: p.uid, itFace: -1 }), m.cond)) continue;
        cands.push({ label: a.label ?? 'かわりに置く', to: a.apply.to, optional: !!a.optional });
      }
    }
  }
  if (cands.length === 0) return;
  let chosen = 0;
  // 同じ行き先に置く強制の置換が重なっているだけなら、どれを使っても同じ(聞かない)
  const sameDest = cands.every((x) => !x.optional && x.to === cands[0].to);
  if (!sameDest && (cands.length > 1 || cands[0].optional)) {
    const ans = ask<number[]>(c, {
      player: card.owner,
      why: 'replaceChoice',
      input: { shape: 'option', options: [...cands.map((x) => x.label), '置換しない'], pick: 1, repeat: false, allIf: false },
      source: { uid: p.uid, ep: card.ep },
      prompt: `${c.reg.defs[card.defId].name}: 置換効果を選んでください`,
    });
    chosen = ans[0];
    if (chosen >= cands.length) return;
  }
  p.to = cands[chosen].to;
  p.cause = 'replaced';
  p.replaced = true;
}

/** 手札から捨てられるカード自身の置換(「捨てられる時、墓地に置くかわりに出してもよい」など) */
function applyHandReplacement(c: Ctx, p: Proposal): void {
  const s = c.s;
  const card = s.cards[p.uid];
  const info = c.reg.getInfo(card.defId, 0);
  for (const r of info.replaces) {
    const a = r.ability;
    if (a.match.type !== 'moved' || a.match.from !== 'hand' || a.apply.type !== 'steps') continue;
    const m = a.match;
    if (m.cause !== undefined && m.cause !== p.cause) continue;
    if (m.turn === 'opponent' && s.active === card.owner) continue;
    if (m.turn === 'own' && s.active !== card.owner) continue;
    // 相手の効果で捨てられる時だけ
    if (m.byOpponent && (p.by === undefined || p.by === card.owner)) continue;
    if (a.while && !evalCond(mkCC(c, card.owner, { self: p.uid }), a.while)) continue;
    if (a.optional) {
      const ans = ask<number[]>(c, {
        player: card.owner,
        why: 'replaceChoice',
        input: { shape: 'option', options: [a.label ?? 'かわりの処理を行う', '置換しない'], pick: 1, repeat: false, allIf: false },
        source: { uid: p.uid, ep: card.ep },
        prompt: `${c.reg.defs[card.defId].name}: ${a.label ?? '手札から捨てられる時の置換'}`,
      });
      if (ans[0] !== 0) return;
    }
    p.cancelled = true;
    p.also = { kind: 'steps', ref: { defId: card.defId, face: 0, idx: r.idx } };
    p.replaced = true;
    return;
  }
}

function applyLeaveReplacements(c: Ctx, p: Proposal): void {
  const s = c.s;
  const card = s.cards[p.uid];
  if (p.from !== 'battle') return;
  // 「離れない」(ペトローバ・ハイパー・エン・ゲルス): バトルゾーンを離れる移動はすべて起きない
  if (p.to !== 'battle' && cannotLeave(c, p.uid, p.cause)) {
    p.cancelled = true;
    return;
  }
  const pm = permByPid(s, card.pid);
  if (!pm || pm.perm.cards[0] !== p.uid) return;
  if (p.to === 'battle') return;
  const owner = card.owner;
  const info = infoOf(c, p.uid);

  interface Cand {
    label: string;
    optional: boolean;
    apply: (pp: Proposal) => void;
  }
  const cands: Cand[] = [];

  // カード自身の置換効果(破壊 → マナゾーン / S-MAX進化の身代わり)
  for (const r of info.replaces) {
    const a = r.ability;
    if (a.while && !evalCond(mkCC(c, owner, { self: p.uid }), a.while)) continue;
    const m = a.match;
    if (m.type !== 'moved' && m.type !== 'leave') continue;
    if (m.from !== undefined && m.from !== p.from) continue;
    if (m.cause !== undefined && m.cause !== p.cause) continue;
    if (m.cond && !evalCond(mkCC(c, owner, { self: p.uid, it: p.uid, itFace: -1 }), m.cond)) continue;
    if (a.apply.type === 'steps') {
      cands.push({
        label: a.label ?? 'かわりの処理を行う',
        optional: !!a.optional,
        apply: (pp) => {
          pp.cancelled = true;
          pp.also = { kind: 'steps', ref: { defId: card.defId, face: card.face, idx: r.idx }, src: p.uid };
        },
      });
    } else if (a.apply.type === 'changeDest') {
      const to = a.apply.to;
      cands.push({
        label: a.label ?? `かわりに${to === 'mana' ? 'マナゾーン' : to}に置く`,
        optional: !!a.optional,
        apply: (pp) => {
          pp.to = to;
          pp.cause = 'replaced';
        },
      });
    } else if (a.apply.type === 'smaxSacrifice') {
      const pool = smaxVictims(c, owner, p.uid);
      if (pool) {
        cands.push({
          label: a.label ?? 'かわりに表向きのカード3枚を破壊する',
          optional: true,
          apply: (pp) => {
            // 3枚ちょうどなら選択の余地がない。それより多ければ、持ち主が破壊する3枚を選ぶ
            const picks =
              pool.length === 3
                ? pool
                : ask<number[]>(c, {
                    player: owner,
                    why: 'select',
                    input: { shape: 'pick', candidates: pool, min: 3, max: 3 },
                    source: { uid: p.uid, ep: card.ep },
                    prompt: `${c.reg.defs[card.defId].name}: かわりに破壊する表向きのカードを3枚選んでください`,
                  });
            pp.cancelled = true;
            pp.also = { kind: 'smaxSacrifice', picks };
          },
        });
      }
    }
  }
  // 他のクリーチャーが離れる時の置換(match.type = 'leave'。ウルトラ・セイバー・表向きのシールドの身代わりなど)
  if (gameHas(c, 'leaveReplace')) {
    for (const pl of [0, 1] as PlayerId[]) {
      for (const perm of s.players[pl].battle) {
        const src = perm.cards[0];
        if (src === p.uid) continue;
        const sc = s.cards[src];
        for (const r of infoOf(c, src).replaces) {
          const a = r.ability;
          if (a.match.type !== 'leave' || a.apply.type !== 'steps') continue;
          const m = a.match;
          const rel = (want: string | undefined, actual: PlayerId): boolean => want === undefined || want === 'any' || (want === 'self' ? actual === pl : actual !== pl);
          if (!rel(m.owner, card.owner)) continue;
          if (m.from !== undefined && m.from !== p.from) continue;
          if (m.cause !== undefined && m.cause !== p.cause) continue;
          if (a.while && !evalCond(mkCC(c, pl, { self: src }), a.while)) continue;
          if (m.cond && !evalCond(mkCC(c, pl, { self: src, it: p.uid, itFace: -1 }), m.cond)) continue;
          cands.push({
            label: a.label ?? 'かわりの処理を行う',
            optional: !!a.optional,
            apply: (pp) => {
              pp.cancelled = true;
              pp.also = { kind: 'steps', ref: { defId: sc.defId, face: sc.face, idx: r.idx }, src };
            },
          });
        }
      }
    }
  }
  // EXライフ: 離れる時、かわりにシールドを墓地に置く
  if (info.exLife) {
    const sh = s.players[owner].shield.find((u) => s.cards[u].ex && s.cards[u].exPid === card.pid);
    if (sh !== undefined) {
      cands.push({
        label: 'EXライフ: かわりにシールドを1枚墓地に置く',
        optional: false,
        apply: (pp) => {
          pp.cancelled = true;
          pp.also = { kind: 'exShieldToGrave', shield: sh };
        },
      });
    }
  }
  if (cands.length === 0) return;
  let chosen = 0;
  const needAsk = cands.length > 1 || cands[0].optional;
  if (needAsk) {
    const labels = cands.map((x) => x.label);
    const optional = cands.every((x) => x.optional);
    const options = optional || cands.some((x) => x.optional) ? [...labels, '置換しない'] : labels;
    const spec: Omit<Pending, 'id'> = {
      player: owner,
      why: 'replaceChoice',
      input: { shape: 'option', options, pick: 1, repeat: false, allIf: false },
      source: { uid: p.uid, ep: card.ep },
      prompt: `${c.reg.defs[card.defId].name}: 置換効果を選んでください`,
    };
    const ans = ask<number[]>(c, spec);
    chosen = ans[0];
    if (chosen >= cands.length) return; // 置換しない
  }
  cands[chosen].apply(p);
  p.replaced = true;
}

/**
 * ジャオウガの身代わりで破壊できる、自分の表向きのカード(自身を除く)。3枚に満たなければ null。
 * 公式 Q&A 41461: 「表向きでバトルゾーンに存在するカードを破壊できます」。破壊はバトルゾーンのカードを墓地に置くことなので、
 * マナゾーンのカードは含まない。進化クリーチャーは山ごと1枚として数える。
 */
export function smaxVictims(c: Ctx, owner: PlayerId, self: number): number[] | null {
  const pool: number[] = [];
  for (const perm of c.s.players[owner].battle) {
    if (perm.cards[0] === self) continue;
    pool.push(perm.cards[0]);
  }
  return pool.length >= 3 ? pool : null;
}

// ───────────────────────── 基本操作 ─────────────────────────

export function drawCards(c: Ctx, player: PlayerId, n: number): number {
  const s = c.s;
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    const deck = s.players[player].deck;
    if (deck.length === 0) {
      // 山札が0枚の時にドローしても何も起こらない(114.6)。「引く時、山札がなければ、かわりに〜」の置換があれば、その手順を行う
      if (gameHas(c, 'drawEmpty')) drawEmptyReplacement(c, player);
      break;
    }
    const uid = deck[0];
    moveCards(c, [uid], { to: 'hand', cause: 'draw' });
    drawn++;
  }
  return drawn;
}

/** 山札がない時に引く時の置換(不死鳥縫合 ブラック・ビッグバン): あれば、その手順を行う効果を積む */
function drawEmptyReplacement(c: Ctx, player: PlayerId): void {
  const s = c.s;
  for (const perm of s.players[player].battle) {
    const src = perm.cards[0];
    const sc = s.cards[src];
    for (const r of infoOf(c, src).replaces) {
      const a = r.ability;
      if (a.match.type !== 'drawEmpty' || a.apply.type !== 'steps') continue;
      if (a.while && !evalCond(mkCC(c, player, { self: src }), a.while)) continue;
      s.cont.push({
        kind: 'effect',
        id: nextId(s),
        causedBy: c.cause,
        ability: { defId: sc.defId, face: sc.face, idx: r.idx },
        source: { uid: src, ep: sc.ep },
        lki: snapOf(c, src),
        controller: player,
        pc: 0,
        vars: {},
        trigger: null,
      });
      return;
    }
  }
}

export function shuffleDeck(c: Ctx, player: PlayerId): void {
  if (deckLocked(c, player)) return; // 山札の順序を変えられない(5.S.D.)
  shuffleInPlace(c.s, c.s.players[player].deck);
  // 山札全体を混ぜたら、公開された札の位置の手がかりは失われる
  if (c.s.knownDeck) c.s.knownDeck[player] = [];
}

export function setTapped(c: Ctx, uid: number, tapped: boolean): void {
  const s = c.s;
  const card = s.cards[uid];
  if (card.zone === 'battle') {
    const pm = permByPid(s, card.pid);
    if (pm) pm.perm.tapped = tapped;
    emit(c, tapped ? 'tapped' : 'untapped', { card: uid, owner: card.owner });
  } else {
    card.tapped = tapped;
  }
}

/** 山札の上から1枚をシールドにする(裏向き) */
export function addShieldFromDeck(c: Ctx, player: PlayerId): number | null {
  const s = c.s;
  const deck = s.players[player].deck;
  if (deck.length === 0) return null;
  const uid = deck[0];
  moveCards(c, [uid], { to: 'shield', cause: 'addShield' });
  return uid;
}

export { payNeed, opponentOf };
export type { Ability, InputSpec };
