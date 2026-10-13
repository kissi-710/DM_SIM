// 原始操作(effects 6.3 / 8): イベント発行・誘発の収集・ゾーン移動・置換パイプライン。
// 規約: 入力待ち(ask)は、状態を変更する前に行う。再実行しても二重に変更されない。
import type { Ability } from './ast';
import { evalCond, matchPattern, mkCC } from './cond';
import { charsOf, infoOf, payNeed } from './derive';
import type { Ctx } from './state';
import { nextId, opponentOf, permByPid, rngInt, shuffleInPlace, snapOf } from './state';
import {
  type AbilityRef,
  type Ev,
  type InputSpec,
  NeedInput,
  type Pending,
  type PlayerId,
  type PoolEntry,
  type ZoneName,
} from './types';

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
  const refs = c.reg.trigIndex.get(ev.type);
  if (!refs) return;
  const s = c.s;
  // 定義IDごとに、そのカードがどこにあるかを走査
  const defSet = new Set(refs.map((r) => r.defId));
  const batch = s.batchNo;
  for (let uid = 0; uid < s.cards.length; uid++) {
    const card = s.cards[uid];
    if (!defSet.has(card.defId)) continue;
    // バトルゾーンでは山の一番上だけが能力を持つ
    if (card.zone === 'battle') {
      const pm = permByPid(s, card.pid);
      if (!pm || pm.perm.cards[0] !== uid) continue;
    }
    for (const r of refs) {
      if (r.defId !== card.defId) continue;
      const spec = r.ability.spec;
      const watch = spec.watch ?? WATCH_DEFAULT;
      if (!watch.includes(card.zone)) continue;
      // 使用中の面(バトルゾーン)。場以外では面0の能力だけが働く
      if (card.zone === 'battle' ? r.face !== card.face : r.face !== 0) continue;
      tryTrigger(c, ev, uid, r.face, r.idx, r.ability.spec, batch);
    }
  }
}

function tryTrigger(c: Ctx, ev: Ev, uid: number, face: number, idx: number, spec: any, batch: number): void {
  const s = c.s;
  const card = s.cards[uid];
  const controller = card.owner;
  const cc = mkCC(c, controller, { self: uid, selfSnap: snapOf(c, uid), event: ev });
  const ons = Array.isArray(spec.on) ? spec.on : [spec.on];
  if (!ons.some((p: any) => matchPattern(cc, p, ev))) return;
  if (spec.subject === 'self' && ev.card !== uid) return;
  if (spec.subject === 'other' && ev.card === uid) return;
  if (spec.turn === 'own' && s.active !== controller) return;
  if (spec.turn === 'opponent' && s.active === controller) return;
  if (spec.nthThisTurn !== undefined) {
    let n = 0;
    for (const e of s.turnLog) {
      if (e.type === ev.type && e.owner === ev.owner && e.kind === ev.kind) n++;
      if (e.id === ev.id) break;
    }
    if (n !== spec.nthThisTurn) return;
  }
  if (spec.limit) {
    const key = `${uid}:${card.ep}:${face}:${idx}`;
    const used = s.usage[key];
    if (used === s.turn && (s.usage[key + '#'] ?? 0) >= spec.limit.perTurn) return;
  }
  if (spec.if && !evalCond({ ...cc, it: ev.card ?? null, itFace: -1 }, spec.if)) return;

  const ref: AbilityRef = { defId: card.defId, face, idx };
  // トリガー抑制(キーナリー): 置換効果の一種として処理する。
  if (suppressesTrigger(c, ev, uid, controller)) return;

  if (spec.limit) {
    const key = `${uid}:${card.ep}:${face}:${idx}`;
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
        const pat: any = { ...r.ability.match };
        // match.type は abilityTriggered(元のイベント種別は causeType)
        if (!matchPattern(cc, { ...pat, type: 'abilityTriggered' }, { ...ev, type: 'abilityTriggered', controller, cause: ev } as any)) continue;
        if (ev.owner !== p) return true;
      }
    }
  }
  return false;
}

/** 現在のバッチで発生したイベントの誘発をまとめて収集する */
export function collectBatch(c: Ctx, evs: Ev[]): void {
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
}

export interface MoveResult {
  uid: number;
  moved: boolean;
  to: ZoneName;
  ep: number;
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
    case 'grave': {
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
  also?: { kind: 'exShieldToGrave'; shield: number } | { kind: 'smaxSacrifice'; picks: number[] };
  replaced?: boolean;
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
    proposals.push({ uid, from: card.zone, to: opts.to, cause: opts.cause, pos: opts.pos });
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
    const r = doMove(c, p.uid, p.to, p.cause, p.pos, evs, opts);
    results.push(r);
  }
  s.batchNo++;
  collectBatch(c, evs);
  s.dirtySba = true;
  return results;
}

/** 実際の移動(置換は済んでいる)。進化の山は下のカードも一緒に動かす。 */
function doMove(c: Ctx, uid: number, to: ZoneName, cause: string, pos: 'top' | 'bottom' | undefined, evs: Ev[], opts: MoveOpts): MoveResult {
  const s = c.s;
  const card = s.cards[uid];
  const from = card.zone;
  const snap = snapOf(c, uid);
  const kind = charsOf(c, uid, card.zone === 'battle' || card.zone === 'limbo' ? card.face : -1).type === 'spell' ? 'spell' : 'creature';
  const wasEx = card.ex;
  // 山(進化元)を一緒に動かす
  let under: number[] = [];
  if (from === 'battle' && to !== 'battle' && !opts.alone) {
    const pm = permByPid(s, card.pid);
    if (pm && pm.perm.cards[0] === uid) under = pm.perm.cards.slice(1);
    // 山に付いているEXシールドは、離れる時の置換で処理済み
  }
  if (to === 'battle') {
    return enterBattle(c, uid, opts, evs);
  }
  removeFromZone(c, uid);
  card.zone = to;
  card.ep++;
  card.pid = -1;
  card.tapped = false;
  card.ex = false;
  card.exPid = -1;
  if (to === 'mana') {
    // 多色カードはタップ状態でマナゾーンに置く(spec 3.3)
    const civs = charsOf(c, uid, -1).civs;
    card.tapped = civs.length > 1 || !!opts.tapped;
  }
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
  for (const u of under) {
    const uc = s.cards[u];
    const usnap = snapOf(c, u);
    removeFromZone(c, u);
    uc.zone = to;
    uc.ep++;
    uc.pid = -1;
    uc.tapped = false;
    uc.face = 0;
    placeInZone(c, u, to, pos);
    evs.push(emit(c, 'moved', { card: u, owner: uc.owner, from: 'battle', to, cause, kind: 'creature', ex: false, lki: usnap, underneath: true }));
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
  removeFromZone(c, uid);
  card.zone = 'battle';
  card.ep++;
  card.face = faceIdx;
  card.tapped = false;
  let perm;
  let base: number[] = [];
  if (opts.onto !== undefined) {
    const pm = permByPid(s, opts.onto);
    if (!pm) throw new Error('重ねる山がありません');
    perm = pm.perm;
    base = perm.cards.slice();
    perm.cards.unshift(uid);
    card.pid = perm.pid;
    // L3: タップと召喚酔いは引き継ぎ、新しいオブジェクトとして出たターンを更新
    perm.enteredTurn = s.turn;
  } else {
    perm = {
      pid: s.nextPid++,
      cards: [uid],
      tapped: !!opts.tapped,
      sick: true,
      enteredTurn: s.turn,
    };
    card.pid = perm.pid;
    s.players[owner].battle.push(perm);
  }
  evs.push(emit(c, 'moved', { card: uid, owner, from, to: 'battle', cause: opts.cause, kind: 'creature', ex: false, lki: snap, via }));
  // 侵略でバトルゾーンの別の山から移動する場合は「出た」扱いにならない(decks.md)
  const fromBattle = from === 'battle';
  if (!fromBattle) {
    evs.push(emit(c, 'entered', { card: uid, owner, via, paid: opts.paid ?? 0, cost: opts.cost, free: !!opts.free, pid: perm.pid, kind: 'creature', face: faceIdx }));
  }
  if (opts.onto !== undefined) {
    evs.push(emit(c, 'evolved', { card: uid, owner, pid: perm.pid, base, via }));
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

// ───────────────────────── 置換パイプライン(effects 8) ─────────────────────────

/**
 * 提案に置換効果を適用する。1つの出来事に1回だけで、連鎖しない(101.5)。
 * 複数あるか任意の場合は、持ち主に選ばせる(ask)。
 */
function applyReplacements(c: Ctx, p: Proposal): void {
  const s = c.s;
  const card = s.cards[p.uid];
  if (p.from !== 'battle') return;
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
    const m: any = a.match;
    if (m.type !== 'moved') continue;
    if (m.from !== undefined && m.from !== p.from) continue;
    if (m.cause !== undefined && m.cause !== p.cause) continue;
    if (a.apply.type === 'changeDest') {
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
      const picks = smaxVictims(c, owner, p.uid);
      if (picks) {
        cands.push({
          label: a.label ?? 'かわりに表向きのカード3枚を破壊する',
          optional: true,
          apply: (pp) => {
            pp.cancelled = true;
            pp.also = { kind: 'smaxSacrifice', picks };
          },
        });
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

/** ジャオウガの身代わり: 自分の表向きのカード3枚(バトルゾーン・マナゾーン) */
function smaxVictims(c: Ctx, owner: PlayerId, self: number): number[] | null {
  const s = c.s;
  const faceUp: number[] = [];
  for (const perm of s.players[owner].battle) {
    if (perm.cards[0] === self) continue;
    faceUp.push(perm.cards[0]);
  }
  for (const u of s.players[owner].mana) faceUp.push(u);
  if (faceUp.length < 3) return null;
  // 選択はコストの小さいものから(価値の低いマナ・クリーチャーを優先)
  const scored = faceUp.map((u) => ({ u, v: valueOf(c, u) })).sort((a, b) => a.v - b.v);
  return scored.slice(0, 3).map((x) => x.u);
}

function valueOf(c: Ctx, u: number): number {
  const card = c.s.cards[u];
  const ch = charsOf(c, u, -1);
  return (card.zone === 'battle' ? 10 + (ch.power ?? 0) / 1000 : 0) + ch.cost;
}

// ───────────────────────── 基本操作 ─────────────────────────

export function drawCards(c: Ctx, player: PlayerId, n: number): number {
  const s = c.s;
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    const deck = s.players[player].deck;
    if (deck.length === 0) break; // 山札が0枚の時にドローしても何も起こらない(114.6)
    const uid = deck[0];
    moveCards(c, [uid], { to: 'hand', cause: 'draw' });
    drawn++;
  }
  return drawn;
}

export function shuffleDeck(c: Ctx, player: PlayerId): void {
  shuffleInPlace(c.s, c.s.players[player].deck);
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

export function randomPick<T>(c: Ctx, arr: T[], n: number): T[] {
  const pool = arr.slice();
  const out: T[] = [];
  while (out.length < n && pool.length > 0) out.push(pool.splice(rngInt(c.s, pool.length), 1)[0]);
  return out;
}

export { payNeed, opponentOf };
export type { Ability, InputSpec };
