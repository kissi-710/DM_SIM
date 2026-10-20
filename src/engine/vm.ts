// 効果のインタプリタ(effects 6.5)。フレームは pc と vars(JSON)だけを持ち、再開できる。
import type { ActDef, Cond, Expr, Selector, StepDef } from './ast';
import { type CC, evalCond, evalExpr, selectCards, varUids } from './cond';
import { canSummon, charsOf, infoOf } from './derive';
import type { Instr } from './registry';
import {
  addShieldFromDeck,
  ask,
  collectBatch,
  drawCards,
  emit,
  enterBattle,
  moveCards,
  resolveBattle,
  setTapped,
  shuffleDeck,
} from './ops';
import type { Ctx } from './state';
import { nextId, opponentOf, permByPid, rngInt, shuffleInPlace, snapOf } from './state';
import { type ContEffect, type EffectFrame, type EffectMod, type Ev, type InputSpec, isCreatureType, type ObjRef, type PlayerId } from './types';

// ───────────────────────── コンテキスト ─────────────────────────

export function ccOfFrame(c: Ctx, f: EffectFrame): CC {
  const iter: PlayerId | undefined = f.vars.$iter;
  return {
    c,
    controller: f.controller,
    self: f.source.uid,
    selfSnap: f.lki,
    vars: f.vars,
    event: f.trigger ?? null,
    iter,
  };
}

const ref = (c: Ctx, uid: number): ObjRef => ({ uid, ep: c.s.cards[uid].ep });

function sourceName(c: Ctx, f: EffectFrame): string {
  return c.reg.defs[f.lki.defId]?.name ?? '';
}

// ───────────────────────── 1命令の実行 ─────────────────────────

/** 実行を1命令進める。フレームが終われば true(呼び出し側が pop する)。 */
export function runEffect(c: Ctx, f: EffectFrame): boolean {
  const prog = c.reg.program(f.ability, !!f.noOptional);
  const ins = prog[f.pc];
  if (!ins) return true;
  const cc = ccOfFrame(c, f);
  switch (ins.o) {
    case 'act':
      execAct(c, f, cc, ins.act);
      f.pc++;
      return false;
    case 'select':
      execSelect(c, f, cc, ins.step);
      f.pc++;
      return false;
    case 'may': {
      const plan = planMay(c, f, prog, f.pc);
      const q = ins.prompt ?? '効果を使いますか?';
      if (plan.kind === 'skip') {
        // 使っても何も起きない: 聞かずに使わない側へ進む(本体が空にするはずだった変数は、空にしておく)
        for (const v of plan.empties) f.vars[v] = [];
        f.pc = ins.no;
        return false;
      }
      if (plan.kind === 'pick') {
        // 「使うか」と「どれを対象にするか」を1問に: 選べば使う、選ばなければ使わない
        const ans = ask<number[]>(c, {
          player: f.controller,
          why: 'may',
          input: { shape: 'pick', candidates: plan.candidates, min: 0, max: plan.max },
          source: f.source,
          prompt: `${sourceName(c, f)}: ${q}(使うなら対象を選ぶ。選ばなければ使わない)`,
        });
        if (ans.length === 0) f.pc = ins.no;
        else {
          bindPicked(c, f, plan.step, ans, f.controller);
          f.pc += 2; // may と、それに続く select を済ませた
        }
        return false;
      }
      const ans = ask<boolean>(c, {
        player: f.controller,
        why: 'may',
        input: { shape: 'yesno' },
        source: f.source,
        prompt: `${sourceName(c, f)}: ${q}`,
      });
      f.pc = ans ? f.pc + 1 : ins.no;
      return false;
    }
    case 'jmp':
      f.pc = ins.to;
      return false;
    case 'jf':
      f.pc = evalCond(cc, ins.cond as Cond) ? f.pc + 1 : ins.to;
      return false;
    case 'modes': {
      const st = ins.step;
      const all = st.allIf ? evalCond(cc, st.allIf) : false;
      const who: PlayerId = st.who === 'opponent' ? opponentOf(f.controller) : f.controller;
      // 見てから選べるように、この能力で見て、まだ山札にあるカードを示す
      const seen = who === f.controller ? ((f.vars[':seen'] as number[] | undefined) ?? []).filter((u) => c.s.cards[u].zone === 'deck') : [];
      const ans = ask<number[]>(c, {
        player: who,
        why: 'modes',
        input: {
          shape: 'option',
          options: st.options.map((o) => o.label),
          pick: st.pick,
          repeat: !!st.repeat,
          allIf: all,
          ...(seen.length > 0 ? { seen } : {}),
        },
        source: f.source,
        prompt: `${sourceName(c, f)}: 選択肢を選んでください`,
      });
      // 能力の文章の上に書かれたものから順に解決する(spec 3.12)
      f.vars[ins.key] = ans.slice().sort((a, b) => a - b);
      f.vars[ins.key + ':i'] = 0;
      f.pc = ins.next;
      return false;
    }
    case 'modesNext': {
      const list: number[] = f.vars[ins.key] ?? [];
      const i: number = f.vars[ins.key + ':i'] ?? 0;
      if (i >= list.length) f.pc = ins.end;
      else {
        f.vars[ins.key + ':i'] = i + 1;
        f.pc = ins.starts[list[i]];
      }
      return false;
    }
    case 'eachInit':
      // 処理する対象は開始時点で確定する(本体でカードを動かしても、後ろの要素を飛ばさない)
      f.vars[ins.key + ':list'] = varUids(cc, ins.inVar, { ignoreEp: false }).map((u) => ref(c, u));
      f.vars[ins.key] = 0;
      f.pc++;
      return false;
    case 'eachNext': {
      const list: ObjRef[] = f.vars[ins.key + ':list'] ?? [];
      let i: number = f.vars[ins.key] ?? 0;
      // 先の反復で別のゾーンへ動いた(参照が古くなった)ものは処理しない
      while (i < list.length && c.s.cards[list[i].uid]?.ep !== list[i].ep) i++;
      if (i >= list.length) f.pc = ins.end;
      else {
        f.vars[ins.key] = i + 1;
        f.vars[ins.as] = list[i];
        f.pc++;
      }
      return false;
    }
    case 'repeatInit':
      f.vars[ins.key] = evalExpr(cc, ins.times as Expr);
      f.pc++;
      return false;
    case 'repeatNext': {
      const n: number = f.vars[ins.key] ?? 0;
      if (n <= 0) f.pc = ins.end;
      else {
        f.vars[ins.key] = n - 1;
        f.pc++;
      }
      return false;
    }
    case 'setIter': {
      // ターンプレイヤーから順に(0 = ターンプレイヤー)
      f.vars.$iter = ins.which === 0 ? c.s.active : opponentOf(c.s.active);
      f.pc++;
      return false;
    }
    case 'custom':
      throw new Error('未対応のカスタム処理: ' + ins.handler);
  }
}

// ───────────────────────── select ─────────────────────────

type SelectStep = Extract<StepDef, { op: 'select' }>;

/** select の候補・選ぶ枚数(上限・下限は候補の数に丸めた後)・選ぶ人 */
function selectInfo(cc: CC, f: EffectFrame, st: SelectStep): { cand: number[]; min: number; max: number; chooser: PlayerId } {
  const from = st.from;
  const cand = from && 'var' in from && !('zone' in from) ? varUids(cc, from.var) : selectCards(cc, from as Selector);
  const chooser: PlayerId =
    st.who === 'opponent' ? opponentOf(f.controller) : st.who === 'iter' ? (f.vars.$iter ?? f.controller) : f.controller;
  const min0 = st.min === undefined ? 1 : evalExpr(cc, st.min);
  const max0 = st.max === undefined ? 1 : evalExpr(cc, st.max);
  const max = Math.min(max0, cand.length);
  const min = Math.min(min0, max);
  return { cand, min, max, chooser };
}

/** 選んだカードを変数に束ね、ログ用の chosen を出す(select と、may に統合した選択で共通) */
function bindPicked(c: Ctx, f: EffectFrame, st: SelectStep, picked: number[], chooser: PlayerId): void {
  const picks = picked.map((u) => ref(c, u));
  f.vars[st.as] = st.append ? [...((f.vars[st.as] as ObjRef[] | undefined) ?? []), ...picks] : picks;
  if (picked.length) {
    // 選んだものの公開(相手が選んだものなど)は、ログのためにイベントにする
    emit(c, 'chosen', { cards: picked, by: chooser, source: f.source.uid });
  }
}

/** 参照として数える項目名。ここに入る数値だけが、カードの uid・山の pid として扱われる */
const REF_KEYS = new Set(['uid', 'pid', 'card', 'cards', 'base', 'source', 'attacker', 'attackerCard', 'blocker']);

function collectRefs(v: unknown, flag: boolean, out: Set<number>): void {
  if (typeof v === 'number') {
    if (flag) out.add(v);
  } else if (Array.isArray(v)) {
    for (const x of v) collectRefs(x, flag, out);
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) collectRefs(x, REF_KEYS.has(k), out);
  }
}

/** 変数の値(配列は uid の列として、オブジェクトは中の参照として数える) */
function collectVarRefs(vars: Record<string, unknown>, out: Set<number>): void {
  for (const x of Object.values(vars)) collectRefs(x, Array.isArray(x), out);
}

/**
 * 進行中の処理(スタック・待機中の誘発・今ターンの出来事・継続効果など)が、名指しで覚えているカードと山。
 * 同名のカードのうちこれに載っているものは、他の同名と同じ扱いにできない。
 */
function referencedIds(c: Ctx, f: EffectFrame): Set<number> {
  const s = c.s;
  const out = new Set<number>();
  const frameRefs = (src: ObjRef, lki: unknown, vars: Record<string, unknown>, trigger: unknown) => {
    out.add(src.uid);
    collectRefs(lki, false, out);
    collectVarRefs(vars, out);
    collectRefs(trigger, false, out);
  };
  frameRefs(f.source, f.lki, f.vars, f.trigger);
  for (const fr of s.cont) {
    if (fr.kind === 'effect') frameRefs(fr.source, fr.lki, fr.vars, fr.trigger);
    else collectVarRefs(fr.vars, out);
  }
  for (const e of s.pool) frameRefs(e.source, e.lki, {}, e.event);
  for (const ev of s.turnLog) collectRefs(ev, false, out);
  for (const e of s.effects) if (e.until.kind === 'source') out.add(e.until.uid);
  for (const u of s.breaking) out.add(u);
  return out;
}

/**
 * 候補のどれを選んでも、その後の結果が同じか(同じ持ち主・同じゾーン・同名・同じ状態)。
 * 同じなら、どれを選ぶかは聞かない(docs/effects.md 11.6)。不確かな時は false(聞く側に倒す)。
 * 山札(順序が結果を変える)・見えないカード('?')・処理の中で名指しされているカードは同じと見なさない。
 */
export function interchangeable(c: Ctx, f: EffectFrame, cand: number[]): boolean {
  if (cand.length < 2) return false;
  const s = c.s;
  const a = s.cards[cand[0]];
  if (a.defId === '?' || a.zone === 'deck' || a.zone === 'limbo') return false;
  for (const u of cand) {
    const x = s.cards[u];
    if (x.defId !== a.defId || x.zone !== a.zone || x.owner !== a.owner || x.face !== a.face) return false;
    if (x.tapped !== a.tapped || x.ex !== a.ex || (x.ex && x.exPid !== a.exPid) || !!x.up !== !!a.up) return false;
  }
  const refs = referencedIds(c, f);
  if (cand.some((u) => refs.has(u))) return false;
  if (a.zone === 'battle') {
    const first = permByPid(s, a.pid)?.perm;
    if (!first) return false;
    for (const u of cand) {
      const pm = permByPid(s, s.cards[u].pid)?.perm;
      if (!pm || pm.cards.length !== 1 || pm.cards[0] !== u) return false;
      if (pm.tapped !== first.tapped || pm.sick !== first.sick || pm.enteredTurn !== first.enteredTurn) return false;
      if (refs.has(pm.pid) || s.effects.some((e) => e.pid === pm.pid)) return false;
    }
  }
  return true;
}

function execSelect(c: Ctx, f: EffectFrame, cc: CC, st: SelectStep): void {
  const { cand, min, max, chooser } = selectInfo(cc, f, st);
  const n = cand.length;
  let picked: number[];
  if (max === 0) picked = [];
  else if (st.random) {
    const pool = cand.slice();
    picked = [];
    while (picked.length < max && pool.length) picked.push(pool.splice(rngInt(c.s, pool.length), 1)[0]);
  } else if (min === n) {
    picked = cand.slice();
  } else if (min === max && interchangeable(c, f, cand)) {
    // 何枚選ぶかが決まっていて、どれを選んでも同じ: 聞かずに先頭から
    picked = cand.slice(0, min);
  } else {
    const ans = ask<number[]>(c, {
      player: chooser,
      why: 'select',
      input: { shape: 'pick', candidates: cand, min, max },
      source: f.source,
      prompt: st.prompt ?? `${sourceName(c, f)}: 対象を選んでください`,
    });
    picked = ans;
  }
  bindPicked(c, f, st, picked, chooser);
}

// ───────────────────────── 任意効果(may)の聞き方 ─────────────────────────

/**
 * 任意効果の聞き方(payChoice と同じ流儀: 状態だけで決まる関数にして、テストで固定する)。
 * - skip: 使っても何も起きない。聞かずに「使わない」へ進む。empties は、本体が空にするはずだった変数。
 * - pick: 本体の最初が「自分が1〜n 枚選ぶ」で、候補がある。「使うか」と「どれか」を1問(0枚 = 使わない)にまとめる。
 * - ask: 従来どおり「使いますか?」を聞く。
 */
export type MayPlan =
  | { kind: 'skip'; empties: string[] }
  | { kind: 'pick'; step: SelectStep; candidates: number[]; max: number }
  | { kind: 'ask' };

/** 対象が空だと何も起きない原始操作(sel を取るもの) */
const INERT_ON_EMPTY = new Set(['move', 'tap', 'untap', 'addEffect', 'put', 'summon', 'castFree']);

/**
 * may の本体(prog[from] 〜 prog[end))を実行しても、状態が何も変わらないか。
 * 変わらないと言えるのは、対象を選ぶ(候補が空)・空の対象に操作する・空かで分岐する、だけの時。
 * 分からない命令が出たら null(= 聞く)。変わらない時は、本体が空にする変数の名前を返す。
 */
function inertBody(cc: CC, f: EffectFrame, prog: Instr[], from: number, end: number): string[] | null {
  const empties = new Set<string>();
  const isEmpty = (name: string) => empties.has(name) || varUids(cc, name).length === 0;
  let pc = from;
  while (pc < end) {
    const ins = prog[pc];
    switch (ins.o) {
      case 'select': {
        const st = ins.step;
        if (selectInfo(cc, f, st).cand.length > 0) return null;
        if (!st.append || isEmpty(st.as)) empties.add(st.as);
        pc++;
        break;
      }
      case 'act': {
        const key = Object.keys(ins.act)[0];
        if (!INERT_ON_EMPTY.has(key)) return null;
        const a = ins.act[key];
        const sel: string | Selector = a.sel;
        const none = typeof sel === 'string' ? isEmpty(sel) : selectCards(cc, sel).length === 0;
        if (!none) return null;
        if (a.as && (key === 'move' || key === 'put' || key === 'summon')) empties.add(a.as);
        pc++;
        break;
      }
      case 'jf': {
        const cond: any = ins.cond;
        const v: unknown = cond && typeof cond === 'object' && Object.keys(cond).length === 1 ? cond.nonEmpty : undefined;
        if (typeof v !== 'string') return null;
        // 空なら条件は成り立たない(evalCond の nonEmpty と同じく、世代は見ない)
        if (!(empties.has(v) || varUids(cc, v, { ignoreEp: true }).length === 0)) return null;
        pc = ins.to;
        break;
      }
      case 'jmp':
        if (ins.to <= pc) return null;
        pc = ins.to;
        break;
      default:
        return null;
    }
  }
  return [...empties];
}

export function planMay(c: Ctx, f: EffectFrame, prog: Instr[], pc: number): MayPlan {
  const ins = prog[pc];
  if (!ins || ins.o !== 'may') return { kind: 'ask' };
  const cc = ccOfFrame(c, f);
  const empties = inertBody(cc, f, prog, pc + 1, ins.no);
  if (empties) return { kind: 'skip', empties };
  const nx = prog[pc + 1];
  if (nx && nx.o === 'select' && pc + 1 < ins.no && !nx.step.random) {
    const info = selectInfo(cc, f, nx.step);
    // 「ちょうど1枚(1〜n 枚)選ぶ」で、選ぶのは自分。0枚を選べる select や、他人が選ぶものは統合しない
    if (info.chooser === f.controller && info.cand.length > 0 && info.min === 1) {
      // 1枚だけ選ぶ時、同じものしか無ければ代表の1枚だけを示す(「このカードを使いますか?」)
      const candidates = info.max === 1 && interchangeable(c, f, info.cand) ? [info.cand[0]] : info.cand;
      return { kind: 'pick', step: nx.step, candidates, max: info.max };
    }
  }
  return { kind: 'ask' };
}

// ───────────────────────── 原始操作 ─────────────────────────

function resolveSel(cc: CC, sel: string | Selector): number[] {
  if (typeof sel === 'string') return varUids(cc, sel);
  return selectCards(cc, sel);
}

function playerOf(f: EffectFrame, who: string | undefined): PlayerId {
  return who === 'opponent' ? opponentOf(f.controller) : f.controller;
}

/** 創造面(クリーチャー面)のインデックス。呪文のみなら -1 */
function creatureFace(c: Ctx, uid: number): number {
  const def = c.reg.defs[c.s.cards[uid].defId];
  return def.faces.findIndex((x) => isCreatureType(x.type));
}
function spellFace(c: Ctx, uid: number): number {
  const def = c.reg.defs[c.s.cards[uid].defId];
  return def.faces.findIndex((x) => x.type === 'spell');
}

function durationOf(c: Ctx, f: EffectFrame, until: string): ContEffect['until'] {
  const s = c.s;
  if (until === 'endOfTurn') return { kind: 'endOfTurn', turn: s.turn };
  if (until === 'nextTurnStart') return { kind: 'untilTurnStart', player: f.controller, afterTurn: s.turn };
  if (until === 'source') return { kind: 'source', uid: f.source.uid, ep: f.source.ep };
  // 「次の、相手のターンの終わりまで」: 自分のターン中なら次のターン、相手のターン中ならそのターン
  if (until === 'nextOpponentTurnEnd') return { kind: 'endOfTurn', turn: s.active === f.controller ? s.turn + 1 : s.turn };
  throw new Error('未知の期限: ' + until);
}

function actDraw(c: Ctx, f: EffectFrame, cc: CC, a: any, _key: string): void {
  const n = typeof a === 'number' ? a : evalExpr(cc, a.n);
  const who = playerOf(f, typeof a === 'object' ? a.who : undefined);
  drawCards(c, who, n);
}

function actMove(c: Ctx, f: EffectFrame, cc: CC, a: any, _key: string): void {
  const uids = resolveSel(cc, a.sel);
  const res = moveCards(c, uids, { to: a.to, cause: a.cause ?? 'effect', pos: a.pos, tapped: a.tapped });
  if (a.as) {
    f.vars[a.as] = res.filter((r) => r.moved && r.to === a.to).map((r) => ({ uid: r.uid, ep: r.ep }));
  }
}

function actMoveTop(c: Ctx, f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  const who = playerOf(f, a.who);
  const n = evalExpr(cc, a.n);
  const top = s.players[who].deck.slice(0, n);
  const res = moveCards(c, top, { to: a.to, cause: a.cause ?? 'effect', tapped: a.tapped });
  if (a.as) f.vars[a.as] = res.filter((r) => r.moved).map((r) => ({ uid: r.uid, ep: r.ep }));
}

function actLookTop(c: Ctx, f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  const who = playerOf(f, a.who);
  const n = evalExpr(cc, a.n);
  const top = s.players[who].deck.slice(0, n);
  f.vars[a.as] = top.map((u) => ref(c, u));
  // この能力で見たカード。後の選択肢(modes)で、選ぶ人に見せる(マルル: 見てから選ぶ)
  f.vars[':seen'] = [...((f.vars[':seen'] as number[] | undefined) ?? []), ...top];
  emit(c, 'looked', { cards: top, to: who, from: 'deck' });
}

function actRevealUntil(c: Ctx, f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  const who = playerOf(f, a.who);
  const deck = s.players[who].deck;
  const revealed: number[] = [];
  let found: number | null = null;
  for (const u of deck) {
    revealed.push(u);
    if (evalCond({ ...cc, it: u, itFace: -1 }, a.cond)) {
      found = u;
      break;
    }
  }
  // 公開の確認(確認が必要な人間のみ)
  for (const p of [0, 1] as PlayerId[]) {
    if (s.cfg.ackReveals[p]) {
      ask(c, {
        player: p,
        why: 'ack',
        input: { shape: 'ack', shown: revealed },
        source: f.source,
        prompt: `${sourceName(c, f)}: 山札の上から公開されたカード`,
      });
    }
  }
  f.vars[a.as] = found === null ? [] : [ref(c, found)];
  f.vars[a.rest] = revealed.filter((u) => u !== found).map((u) => ref(c, u));
  emit(c, 'revealed', { cards: revealed, to: 'all', from: 'deck' });
}

function actReveal(c: Ctx, f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  const uids = resolveSel(cc, a.items);
  for (const p of [0, 1] as PlayerId[]) {
    if (s.cfg.ackReveals[p]) {
      ask(c, { player: p, why: 'ack', input: { shape: 'ack', shown: uids }, source: f.source, prompt: `${sourceName(c, f)}: 公開` });
    }
  }
  emit(c, 'revealed', { cards: uids, to: 'all' });
}

function actShuffleBottom(c: Ctx, _f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  const uids = varUids(cc, a.of, { ignoreEp: true }).filter((u) => s.cards[u].zone === 'deck');
  if (uids.length === 0) return;
  const owner = s.cards[uids[0]].owner;
  const deck = s.players[owner].deck;
  for (const u of uids) deck.splice(deck.indexOf(u), 1);
  shuffleInPlace(s, uids);
  for (const u of uids) {
    deck.push(u);
    s.cards[u].ep++;
  }
  // 公開した札(ヨビニオン)を山札の下に戻した: 並びは分からないが、どの札が下にあるかは両者が知っている
  (s.knownDeck ??= [[], []])[owner].push(uids.map((u) => ({ uid: u, ep: s.cards[u].ep })));
}

function actShuffle(c: Ctx, f: EffectFrame, _cc: CC, a: any, _key: string): void {
  shuffleDeck(c, playerOf(f, a?.who));
}

function actAssign(c: Ctx, f: EffectFrame, cc: CC, a: any, _key: string): void {
  const items = varUids(cc, a.items);
  const slots: { id: string; to: any; count: number; label: string; cause?: string }[] = a.slots.map((x: any) => ({
    id: x.id,
    to: x.to,
    count: x.count,
    label: x.label ?? x.id,
    cause: x.cause,
  }));
  const cap = slots.reduce((t, x) => t + x.count, 0);
  const need = Math.min(items.length, cap);
  let result: Record<string, number[]> = {};
  if (items.length > 0) {
    const input: InputSpec = {
      shape: 'assign',
      items,
      slots: slots.map((x) => ({ id: x.id, to: x.to, count: x.count, label: x.label })),
    };
    if (items.length === need && slots.every((x) => x.count >= items.length) && slots.length === 1) {
      result = { [slots[0].id]: items.slice() };
    } else {
      result = ask<Record<string, number[]>>(c, {
        player: f.controller,
        why: 'assign',
        input,
        source: f.source,
        prompt: `${sourceName(c, f)}: カードを振り分けてください`,
      });
    }
  }
  const bound: Record<string, ObjRef[]> = {};
  for (const sl of slots) {
    const us = (result[sl.id] ?? []).filter((u) => items.includes(u));
    bound[sl.id] = [];
    if (us.length === 0) continue;
    const res = moveCards(c, us, { to: sl.to, cause: sl.cause ?? 'effect' });
    bound[sl.id] = res.filter((r) => r.moved).map((r) => ({ uid: r.uid, ep: r.ep }));
  }
  if (a.as) f.vars[a.as] = bound;
}

function actAddShield(c: Ctx, f: EffectFrame, _cc: CC, a: any, _key: string): void {
  const n = a?.n ?? 1;
  for (let i = 0; i < n; i++) addShieldFromDeck(c, f.controller);
}

function actTap(c: Ctx, _f: EffectFrame, cc: CC, a: any, key: string): void {
  for (const u of resolveSel(cc, a.sel)) setTapped(c, u, key === 'tap');
}

function actAddEffect(c: Ctx, f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  const mods: EffectMod[] = a.mods ?? [a.mod];
  const targets = resolveSel(cc, a.sel);
  for (const u of targets) {
    const card = s.cards[u];
    if (card.zone !== 'battle') continue;
    for (const m of mods) {
      s.effects.push({ id: nextId(s), pid: card.pid, mod: m, until: durationOf(c, f, a.until), controller: f.controller });
    }
  }
  s.dirtySba = true;
}

function actPut(c: Ctx, f: EffectFrame, cc: CC, a: any, key: string): void {
  const s = c.s;
  const uids = resolveSel(cc, a.sel);
  const via = key === 'summon' ? 'summon' : 'effect';
  const evs: Ev[] = [];
  const entered: ObjRef[] = [];
  for (const u of uids) {
    const fi = creatureFace(c, u);
    if (fi < 0) continue;
    const face = c.reg.getFace(s.cards[u].defId, fi);
    if (face.type === 'evolution') continue; // 進化元がないので出せない
    if (key === 'summon' && !canSummon(c, s.cards[u].owner, face.cost)) continue; // 召喚できない効果を受けている
    const r = enterBattle(c, u, { to: 'battle', cause: via, via, face: fi, paid: 0 }, evs);
    if (r.to === 'battle') entered.push({ uid: u, ep: r.ep }); // G城の置換でマナゾーンに置かれたものは、出ていない
  }
  if (a.as) f.vars[a.as] = entered;
  s.batchNo++;
  collectBatch(c, evs);
  s.dirtySba = true;
}

function actCastFree(c: Ctx, _f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  const uids = resolveSel(cc, a.sel);
  for (const u of uids) {
    const fi = spellFace(c, u);
    if (fi < 0) continue;
    s.cont.push({
      kind: 'proc',
      id: nextId(s),
      causedBy: c.cause,
      name: 'play',
      stage: 0,
      vars: { uid: u, ep: s.cards[u].ep, from: s.cards[u].zone, face: fi, free: true, after: a.after ?? null, settle: false },
    });
  }
}

function actSkipRestOfTurn(c: Ctx, f: EffectFrame, _cc: CC, _a: any, _key: string): void {
  const s = c.s;
  s.skipTurn = true;
  emit(c, 'skipTurn', { by: f.controller, source: f.source.uid });
}

function actCopyTrigger(c: Ctx, f: EffectFrame, _cc: CC, _a: any, _key: string): void {
  const s = c.s;
  const trig = f.trigger;
  if (!trig || trig.type !== 'abilityTriggered') return;
  const srcUid: number = trig.source;
  s.cont.push({
    kind: 'effect',
    id: nextId(s),
    causedBy: c.cause,
    ability: trig.ability,
    source: ref(c, srcUid),
    lki: snapOf(c, srcUid),
    controller: f.controller, // L4: 処理者はオルゲイトの持ち主
    pc: 0,
    vars: {},
    trigger: trig.cause,
    noOptional: true,
  });
}

function actInvade(c: Ctx, f: EffectFrame, _cc: CC, _a: any, _key: string): void {
  const s = c.s;
  const trig = f.trigger;
  if (!trig || trig.type !== 'attackDeclared') return;
  const uid = f.source.uid;
  const card = s.cards[uid];
  const target = permByPid(s, trig.attacker);
  if (!target || card.ep !== f.source.ep) return;
  if (card.zone === 'battle' && card.pid === trig.attacker) return;
  const evs: Ev[] = [];
  const fi = creatureFace(c, uid);
  enterBattle(c, uid, { to: 'battle', cause: 'invade', via: 'invade', onto: trig.attacker, face: fi }, evs);
  s.batchNo++;
  collectBatch(c, evs);
  s.dirtySba = true;
}

function actRevolutionChange(c: Ctx, f: EffectFrame, cc: CC, _a: any, _key: string): void {
  const s = c.s;
  // 革命チェンジ: 攻撃中のクリーチャーを手札に戻し、このカードを手札から攻撃中のクリーチャーとして出す。
  // 「攻撃する時」は誘発しない(攻撃の宣言は済んでいる)。攻撃の対象は変わらない。
  const trig = f.trigger;
  if (!trig || trig.type !== 'attackDeclared') return;
  const uid = f.source.uid;
  const card = s.cards[uid];
  if (card.ep !== f.source.ep || card.zone !== 'hand') return;
  const pm = permByPid(s, trig.attacker);
  if (!pm || pm.perm.cards[0] !== trig.card) return;
  // 入れ替える時にも、攻撃クリーチャーが条件(文明・種族・コストなど)を満たしている必要がある
  // (革命チェンジの確認は、使用宣言と入れ替えの2回。侵略は宣言の1回だけ)
  const trigAb = c.reg.ability(f.ability);
  if (trigAb.kind === 'trigger') {
    const on = Array.isArray(trigAb.spec.on) ? trigAb.spec.on[0] : trigAb.spec.on;
    const cond = on?.attackerCond;
    if (cond && !evalCond({ ...cc, it: trig.card, itFace: -1 }, cond as Cond)) return;
  }
  const fr = [...s.cont].reverse().find((x) => x.kind === 'proc' && x.name === 'attack' && x.vars.pid === trig.attacker);
  if (!fr) return;
  const fi = creatureFace(c, uid);
  if (fi < 0) return;
  const res = moveCards(c, [trig.card], { to: 'hand', cause: 'revolutionChange' });
  if (!res[0]?.moved) return; // 置換されて離れなかった(EXライフなど): 入れ替わらない
  const evs: Ev[] = [];
  enterBattle(c, uid, { to: 'battle', cause: 'revolutionChange', via: 'revolutionChange', face: fi, tapped: true, paid: 0 }, evs);
  // G城の置換でマナゾーンに置かれた時は、入れ替わらない(攻撃していたクリーチャーは手札に戻った後で、攻撃は終わる)
  if (s.cards[uid].zone === 'battle') fr.vars.pid = s.cards[uid].pid;
  s.batchNo++;
  collectBatch(c, evs);
  s.dirtySba = true;
}

function actPlayerEffect(c: Ctx, f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  // プレイヤー単位の継続効果(pid = -1)。「相手は〜できない」
  const m = a.mod;
  const mod: EffectMod =
    m.kind === 'cannotUseCost'
      ? { kind: 'cannotUseCost', n: evalExpr(cc, m.n) }
      : m.kind === 'cannotSummon'
        ? { kind: 'cannotSummon', maxCost: evalExpr(cc, m.maxCost) }
        : { kind: 'cannotCast' };
  s.effects.push({ id: nextId(s), pid: -1, mod, until: durationOf(c, f, a.until), controller: f.controller });
}

/**
 * 効果によるバトル: a と b(どちらも変数の参照)のクリーチャーをバトルさせる。
 * どちらかがバトルゾーンにいなければ、何も起きない(バトルは行われない)。
 */
function actBattle(c: Ctx, _f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  const pidOf = (name: string): number | null => {
    const u = varUids(cc, name)[0];
    if (u === undefined) return null;
    const card = s.cards[u];
    if (card.zone !== 'battle') return null;
    const pm = permByPid(s, card.pid);
    return pm && pm.perm.cards[0] === u ? pm.perm.pid : null;
  };
  const pa = pidOf(a.a);
  const pb = pidOf(a.b);
  if (pa === null || pb === null || pa === pb) return;
  resolveBattle(c, pa, pb);
  s.dirtySba = true;
}

function actLog(c: Ctx, f: EffectFrame, _cc: CC, a: any, _key: string): void {
  // 「そのターン中に〜を使っていなければ」の判定用に、印をログに残す
  emit(c, a, { owner: f.controller, source: f.source.uid });
}

function actSetVar(_c: Ctx, f: EffectFrame, _cc: CC, a: any, _key: string): void {
  f.vars[a.as] = a.value;
}

/** 原始操作の名前 → 実行する関数(act の最初のキーで引く) */
const ACT_HANDLERS = new Map<string, (c: Ctx, f: EffectFrame, cc: CC, a: any, key: string) => void>([
  ['draw', actDraw],
  ['move', actMove],
  ['moveTop', actMoveTop],
  ['lookTop', actLookTop],
  ['revealUntil', actRevealUntil],
  ['reveal', actReveal],
  ['shuffleBottom', actShuffleBottom],
  ['shuffle', actShuffle],
  ['assign', actAssign],
  ['addShield', actAddShield],
  ['tap', actTap],
  ['untap', actTap],
  ['addEffect', actAddEffect],
  ['put', actPut],
  ['summon', actPut],
  ['castFree', actCastFree],
  ['skipRestOfTurn', actSkipRestOfTurn],
  ['copyTrigger', actCopyTrigger],
  ['invade', actInvade],
  ['revolutionChange', actRevolutionChange],
  ['playerEffect', actPlayerEffect],
  ['battle', actBattle],
  ['log', actLog],
  ['setVar', actSetVar],
]);

function execAct(c: Ctx, f: EffectFrame, cc: CC, act: ActDef): void {
  const key = Object.keys(act)[0];
  const handler = ACT_HANDLERS.get(key);
  if (!handler) throw new Error('未知の原始操作: ' + key);
  handler(c, f, cc, act[key], key);
}

export { creatureFace, spellFace, infoOf, charsOf };
