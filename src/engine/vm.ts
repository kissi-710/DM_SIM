// 効果のインタプリタ(effects 6.5)。フレームは pc と vars(JSON)だけを持ち、再開できる。
import type { ActDef, Cond, Expr, Selector, StepDef } from './ast';
import { type CC, evalCond, evalExpr, selectCards, varUids } from './cond';
import { charsOf, costBase, deckLocked, infoOf } from './derive';
import type { Instr } from './registry';
import {
  addShieldFromDeck,
  applyEntryReplacement,
  ask,
  collectBatch,
  drawCards,
  emit,
  enterBattle,
  entryReplacement,
  moveCards,
  onSummoned,
  removeZoneCard,
  setTapped,
  shuffleDeck,
  stabIntoDeck,
} from './ops';
import type { Ctx } from './state';
import { gameHas, nextId, opponentOf, permByPid, rngInt, shuffleInPlace, snapOf } from './state';
import type { ContEffect, EffectFrame, EffectMod, Ev, InputSpec, ObjRef, PlayerId } from './types';

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
function selectInfo(cc: CC, f: EffectFrame, st: SelectStep): { cand: number[]; min: number; max: number; chooser: PlayerId; sumMax?: number } {
  const from = st.from;
  const cand = from && 'var' in from && !('zone' in from) ? varUids(cc, from.var) : selectCards(cc, from as Selector);
  const chooser: PlayerId =
    st.who === 'opponent' ? opponentOf(f.controller) : st.who === 'iter' ? (f.vars.$iter ?? f.controller) : f.controller;
  if (st.sumLte !== undefined) {
    // コストの合計の上限つきで、好きな数を選ぶ
    return { cand, min: 0, max: cand.length, chooser, sumMax: evalExpr(cc, st.sumLte) };
  }
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
    if (x.tapped !== a.tapped || x.ex !== a.ex || (x.ex && x.exPid !== a.exPid)) return false;
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
  const { cand, min, max, chooser, sumMax } = selectInfo(cc, f, st);
  const n = cand.length;
  let picked: number[];
  if (sumMax !== undefined) {
    // 合計に収まる組み合わせが1通り(何も選ばない)しかなければ、聞かない
    const costs = cand.map((u) => costBase(c, u));
    if (costs.every((x) => x > sumMax)) picked = [];
    else
      picked = ask<number[]>(c, {
        player: chooser,
        why: 'select',
        input: { shape: 'pick', candidates: cand, min: 0, max: n, sum: { max: sumMax, costs } },
        source: f.source,
        prompt: st.prompt ?? `${sourceName(c, f)}: コストの合計が ${sumMax} 以下になるように選んでください`,
      });
  } else if (max === 0) picked = [];
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
  if (who === 'iter') return (f.vars.$iter as PlayerId | undefined) ?? f.controller; // forPlayers の現在のプレイヤー
  return who === 'opponent' ? opponentOf(f.controller) : f.controller;
}

/** 創造面(クリーチャー面)のインデックス。呪文のみなら -1 */
function creatureFace(c: Ctx, uid: number): number {
  const def = c.reg.defs[c.s.cards[uid].defId];
  return def.faces.findIndex((x) => x.type !== 'spell');
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
  // 次の、相手のターンの終わりまで(いまが自分のターンなら次のターン、相手のターン中ならその次の相手のターン)
  if (until === 'oppTurnEnd') return { kind: 'untilOppTurnEnd', player: f.controller, afterTurn: s.turn };
  throw new Error('未知の期限: ' + until);
}

function actDraw(c: Ctx, f: EffectFrame, cc: CC, a: any, _key: string): void {
  // 引く枚数は、数・{ n: 式, who? }・式(例: { count: ... })のどれでもよい
  const n = typeof a === 'number' ? a : 'n' in a ? evalExpr(cc, a.n) : evalExpr(cc, a);
  const who = playerOf(f, typeof a === 'object' ? a.who : undefined);
  drawCards(c, who, n);
}

function actMove(c: Ctx, f: EffectFrame, cc: CC, a: any, _key: string): void {
  const uids = resolveSel(cc, a.sel);
  const res = moveCards(c, uids, { to: a.to, cause: a.cause ?? 'effect', pos: a.pos, tapped: a.tapped, by: f.controller, ...(a.noReplace ? { noReplace: true } : {}) });
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

function actMoveBottom(c: Ctx, f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  const who = playerOf(f, a.who);
  const n = evalExpr(cc, a.n);
  const deck = s.players[who].deck;
  const bottom = deck.slice(Math.max(0, deck.length - n));
  const res = moveCards(c, bottom, { to: a.to, cause: a.cause ?? 'effect', tapped: a.tapped });
  if (a.as) f.vars[a.as] = res.filter((r) => r.moved).map((r) => ({ uid: r.uid, ep: r.ep }));
}

function actLookTop(c: Ctx, f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  const who = playerOf(f, a.who);
  const n = evalExpr(cc, a.n);
  if (deckLocked(c, who)) {
    f.vars[a.as] = []; // 山札を見れない(5.S.D.)
    return;
  }
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
  const who = playerOf(f, a?.who);
  const added: ObjRef[] = [];
  for (let i = 0; i < n; i++) {
    const u = addShieldFromDeck(c, who);
    if (u !== null) added.push(ref(c, u));
  }
  if (a?.as) f.vars[a.as] = added;
}

function actTap(c: Ctx, _f: EffectFrame, cc: CC, a: any, key: string): void {
  for (const u of resolveSel(cc, a.sel)) setTapped(c, u, key === 'tap');
}

function actAddEffect(c: Ctx, f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  // mod の n が式(オブジェクト)なら、その場で評価した数にする(「自分の墓地のクリーチャー1体につき-1000」など)
  const mods: EffectMod[] = (a.mods ?? [a.mod]).map((m: any) => (m && typeof m.n === 'object' ? { ...m, n: evalExpr(cc, m.n) } : m));
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
  // 複数を同時に出す時、出る時の置換の質問は、最初の1枚を出す前にまとめて行う(質問は、状態を変更する前に行うため)
  const reps = new Map<number, NonNullable<ReturnType<typeof entryReplacement>>>();
  const batch = uids.length > 1 && gameHas(c, 'entryReplace');
  if (batch) {
    for (const u of uids) {
      const fi = creatureFace(c, u);
      if (fi < 0) continue;
      const rep = entryReplacement(c, u, { to: 'battle', cause: via, via, face: fi, paid: 0 }, fi, via);
      if (rep) reps.set(u, rep);
    }
  }
  for (const u of uids) {
    const fi = creatureFace(c, u);
    if (fi < 0) continue;
    const face = c.reg.getFace(s.cards[u].defId, fi);
    if (reps.has(u)) {
      applyEntryReplacement(c, u, reps.get(u)!);
      continue;
    }
    let onto: number | undefined;
    if (face.type === 'evolution') {
      // 進化クリーチャーは、進化元(onto: 変数のクリーチャー)の上に出す。進化元の条件を満たさなければ出せない
      const base = a.onto ? varUids(cc, a.onto, { ignoreEp: true })[0] : undefined;
      if (base === undefined || s.cards[base].zone !== 'battle' || !face.evolveFrom) continue;
      const topUid = s.cards[base].pid >= 0 ? permByPid(s, s.cards[base].pid)?.perm.cards[0] : undefined;
      if (topUid === undefined || !evalCond({ ...cc, self: u, it: topUid, itFace: s.cards[topUid].face, evo: true }, face.evolveFrom)) continue;
      onto = s.cards[topUid].pid;
    }
    const r = enterBattle(c, u, { to: 'battle', cause: via, via, face: fi, paid: 0, ...(batch ? { noReplace: true } : {}), ...(onto !== undefined ? { onto } : {}) }, evs);
    if (r.moved) entered.push({ uid: u, ep: r.ep });
    if (r.moved && via === 'summon') onSummoned(c, u);
  }
  if (a.as) f.vars[a.as] = entered;
  s.batchNo++;
  // noTriggers: 出ることによって起こる効果(「出た時」の能力)はすべて無視する
  collectBatch(c, a.noTriggers ? evs.filter((e) => e.type !== 'entered') : evs);
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
  // 出る時の置換の質問は、状態を変更する前(手札に戻す前)に行う
  const rep = gameHas(c, 'entryReplace') ? entryReplacement(c, uid, { to: 'battle', cause: 'revolutionChange', via: 'revolutionChange', face: fi, tapped: true, paid: 0 }, fi, 'revolutionChange') : null;
  const res = moveCards(c, [trig.card], { to: 'hand', cause: 'revolutionChange' });
  if (!res[0]?.moved) return; // 置換されて離れなかった(EXライフなど): 入れ替わらない
  const evs: Ev[] = [];
  if (rep) applyEntryReplacement(c, uid, rep);
  else enterBattle(c, uid, { to: 'battle', cause: 'revolutionChange', via: 'revolutionChange', face: fi, tapped: true, paid: 0, noReplace: true }, evs);
  fr.vars.pid = s.cards[uid].pid;
  s.batchNo++;
  collectBatch(c, evs);
  s.dirtySba = true;
}

function actPlayerEffect(c: Ctx, f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  // プレイヤー単位の継続効果(pid = -1)。「相手は〜できない」
  const m = a.mod;
  let mod: EffectMod;
  switch (m.kind) {
    case 'cannotUseCost':
      mod = { kind: 'cannotUseCost', n: evalExpr(cc, m.n) };
      break;
    case 'cannotSummon':
      mod = { kind: 'cannotSummon', costLte: evalExpr(cc, m.costLte) };
      break;
    case 'cannotCastLte':
      mod = { kind: 'cannotCastLte', n: evalExpr(cc, m.n) };
      break;
    case 'ignoreCost':
      mod = { kind: 'ignoreCost', n: evalExpr(cc, m.n) };
      break;
    case 'ignoreAll':
      mod = { kind: 'ignoreAll' };
      break;
    case 'startShield':
      mod = { kind: 'startShield' };
      break;
    case 'owe':
      mod = { kind: 'owe', civ: m.civ, n: m.n };
      break;
    case 'oncePerTurnActs':
      mod = { kind: 'oncePerTurnActs' };
      break;
    case 'nextSummon':
      mod = { kind: 'nextSummon', delta: evalExpr(cc, m.delta), sa: !!m.sa };
      break;
    case 'cannotAttackAny':
      mod = { kind: 'cannotAttackAny' };
      break;
    case 'cannotLose':
      mod = { kind: 'cannotLose' };
      break;
    case 'cannotActCost':
      mod = { kind: 'cannotActCost', n: evalExpr(cc, m.n) };
      break;
    default:
      mod = m.n === undefined ? { kind: 'cannotCast' } : { kind: 'cannotCast', n: evalExpr(cc, m.n) };
  }
  s.effects.push({ id: nextId(s), pid: -1, mod, until: durationOf(c, f, a.until), controller: f.controller });
}

/** 効果によるバトル。a, b は選んだクリーチャー(a が攻撃側扱い) */
function actBattle(c: Ctx, _f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  const as = resolveSel(cc, a.a).filter((u) => s.cards[u].zone === 'battle');
  const bs = resolveSel(cc, a.b).filter((u) => s.cards[u].zone === 'battle');
  if (as.length === 0 || bs.length === 0) return;
  s.cont.push({
    kind: 'proc',
    id: nextId(s),
    causedBy: c.cause,
    name: 'battle',
    stage: 0,
    vars: { a: s.cards[as[0]].pid, d: s.cards[bs[0]].pid },
  });
}

/** 山札に加えてシャッフルする(それぞれの持ち主の山札に) */
function actShuffleIn(c: Ctx, _f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  const uids = resolveSel(cc, a.sel);
  if (uids.length === 0) return;
  const owners = new Set<PlayerId>(uids.map((u) => s.cards[u].owner));
  moveCards(c, uids, { to: 'deck', cause: 'effect', pos: 'top' });
  for (const p of owners) shuffleDeck(c, p);
}

/** 山札の下に、いまの並びのまま置く(「好きな順序で山札の下に置く」。並びは変えない) */
function actBottom(c: Ctx, _f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  // except: 山札の下に置かないカード(メクレイドで選んだカードなど)
  const skip = a.except ? varUids(cc, a.except, { ignoreEp: true }) : [];
  const uids = varUids(cc, a.of, { ignoreEp: true }).filter((u) => s.cards[u].zone === 'deck' && !skip.includes(u));
  if (uids.length === 0) return;
  const owner = s.cards[uids[0]].owner;
  if (deckLocked(c, owner)) return; // 山札の順序を変えられない(5.S.D.)
  const deck = s.players[owner].deck;
  for (const u of uids) deck.splice(deck.indexOf(u), 1);
  for (const u of uids) {
    deck.push(u);
    s.cards[u].ep++;
  }
}

/** 無月の門など: このカードを、選んだカードの上に重ねて召喚する(コストは支払わない)。sel = 手札・墓地のカード、under = 下になるカード */
function actSummonOnto(c: Ctx, _f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  const uid = resolveSel(cc, a.sel)[0];
  if (uid === undefined) return;
  const card = s.cards[uid];
  if (card.zone !== 'hand' && card.zone !== 'grave') return;
  const fi = creatureFace(c, uid);
  if (fi < 0) return;
  const under = varUids(cc, a.under).filter((u) => u !== uid);
  const evs: Ev[] = [];
  enterBattle(c, uid, { to: 'battle', cause: 'summon', via: 'summon', face: fi, paid: 0, free: true, under, from: card.zone }, evs);
  s.batchNo++;
  collectBatch(c, evs);
  s.dirtySba = true;
}

/** 「このターンの後に自分のターンを追加する」 */
function actExtraTurn(c: Ctx, f: EffectFrame, _cc: CC, _a: any, _key: string): void {
  const s = c.s;
  s.extraTurns = [...(s.extraTurns ?? []), f.controller];
  emit(c, 'extraTurn', { by: f.controller, source: f.source.uid });
}

/** ゲーム中に1度の能力を使った印(cond の unused で調べる) */
function actMarkUsed(c: Ctx, f: EffectFrame, _cc: CC, a: any, _key: string): void {
  c.s.usage['once:' + f.source.uid + ':' + a.key] = 1;
}

/** カードを、バトルゾーンの山(フィールドなど)の下に置く。sel = 置くカード、onto = 山の一番上のカード */
function actPutUnder(c: Ctx, _f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  const base = resolveSel(cc, a.onto)[0];
  if (base === undefined || s.cards[base].zone !== 'battle') return;
  const pm = permByPid(s, s.cards[base].pid);
  if (!pm) return;
  for (const u of resolveSel(cc, a.sel)) {
    const card = s.cards[u];
    if (card.zone === 'battle') continue;
    const from = card.zone;
    const snap = snapOf(c, u);
    removeZoneCard(c, u);
    card.zone = 'battle';
    card.ep++;
    card.pid = pm.perm.pid;
    card.tapped = false;
    card.face = 0;
    pm.perm.cards.push(u);
    emit(c, 'moved', { card: u, owner: card.owner, from, to: 'battle', cause: 'putUnder', kind: 'spell', ex: false, lki: snap, underneath: true });
  }
  s.dirtySba = true;
}

/** タップして、次の持ち主のターンのはじめにアンタップしない(クリーチャー・マナのカード) */
function actTapLock(c: Ctx, f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  const uids = resolveSel(cc, a.sel);
  if (uids.length === 0) return;
  const pids: number[] = [];
  const mana: number[] = [];
  const owners = new Set<PlayerId>();
  for (const u of uids) {
    const card = s.cards[u];
    owners.add(card.owner);
    setTapped(c, u, true);
    if (card.zone === 'battle') pids.push(card.pid);
    else if (card.zone === 'mana') mana.push(u);
  }
  for (const owner of owners) {
    const mine = (u: number) => s.cards[u].owner === owner;
    s.effects.push({
      id: nextId(s),
      pid: -1,
      mod: { kind: 'noUntap', pids: pids.filter((p) => permByPid(s, p)?.owner === owner), uids: mana.filter(mine) },
      until: { kind: 'untilTurnStart', player: owner, afterTurn: s.turn },
      controller: f.controller,
    });
  }
  s.dirtySba = true;
}

/** 自分のシールドをすべて、ブレイクする(S・トリガーも使える。終極宣言) */
function actBreakShields(c: Ctx, f: EffectFrame, _cc: CC, a: any, _key: string): void {
  const s = c.s;
  const me = f.controller;
  // n があれば、そのぶんだけ(なければすべて)
  const n = Math.min(a?.n ?? Infinity, s.players[me].shield.length);
  if (n === 0) return;
  s.cont.push({
    kind: 'proc',
    id: nextId(s),
    causedBy: c.cause,
    name: 'break',
    stage: 0,
    vars: { pid: s.cards[f.source.uid].pid, owner: opponentOf(me), n },
  });
}

/**
 * ガチンコ・ジャッジ: 各プレイヤーは、自身の山札の上から1枚目を表向きにし、それを一番下に置く。
 * そのカードのコストが相手以上であれば、自分の勝ち。勝った時、変数 as に自分の公開したカードを入れる(負けたら空)
 */
function actJudge(c: Ctx, f: EffectFrame, _cc: CC, a: any, _key: string): void {
  const s = c.s;
  const me = f.controller;
  const opp = opponentOf(me);
  const um = s.players[me].deck[0];
  const uo = s.players[opp].deck[0];
  const cm = um === undefined ? -1 : costBase(c, um);
  const co = uo === undefined ? -1 : costBase(c, uo);
  const shown = [um, uo].filter((u): u is number => u !== undefined);
  if (shown.length > 0) emit(c, 'revealed', { cards: shown, to: 'all', from: 'deck' });
  for (const u of shown) {
    const owner = s.cards[u].owner;
    const deck = s.players[owner].deck;
    deck.splice(deck.indexOf(u), 1);
    deck.push(u);
    s.cards[u].ep++;
  }
  if (a?.as) f.vars[a.as] = cm >= co && um !== undefined ? [ref(c, um)] : [];
}

/**
 * カードを、表向きでシールド1つの上に置く(重ねる)。sel = 置くカード(どのゾーンでもよい。持ち主のシールドに置く)、onto = 下になるシールド
 * 重ねても、シールドの枚数は変わらない(シールド1つの上に置く)
 */
function actStackShield(c: Ctx, _f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  const uid = resolveSel(cc, a.sel)[0];
  const base = resolveSel(cc, a.onto)[0];
  if (uid === undefined || base === undefined) return;
  const bc = s.cards[base];
  const card = s.cards[uid];
  if (bc.zone !== 'shield' || card.owner !== bc.owner || uid === base) return;
  const list = s.players[bc.owner].shield;
  const i = list.indexOf(base);
  if (i < 0) return;
  const from = card.zone;
  if (from === 'shield') return; // シールドのカードどうしを重ねることは、いまのカードにはない
  const snap = snapOf(c, uid);
  // 下のカードたち(元の山の分も含む)
  const piles = (s.piles ??= {});
  const under = [base, ...(piles[base] ?? [])];
  delete piles[base];
  removeZoneCard(c, uid);
  card.zone = 'shield';
  card.ep++;
  card.pid = -1;
  card.tapped = false;
  card.face = 0;
  card.up = true;
  list[i] = uid;
  piles[uid] = under;
  emit(c, 'moved', { card: uid, owner: card.owner, from, to: 'shield', cause: 'stackShield', kind: 'creature', ex: false, lki: snap });
  s.dirtySba = true;
}

/**
 * バトルゾーンに置いたまま、ツインパクトの呪文側を、コストを支払わずに唱える(マジック・フレンド・バースト・スマッシュ・バーストなど)。
 * カードは動かない。呪文を唱えた時の能力は誘発する
 */
function actCastSide(c: Ctx, _f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  const uid = resolveSel(cc, a.sel)[0];
  if (uid === undefined) return;
  const card = s.cards[uid];
  if (card.zone !== 'battle') return;
  const fi = spellFace(c, uid);
  if (fi < 0) return;
  const info = c.reg.getInfo(card.defId, fi);
  if (!info.spell) return;
  const ev = emit(c, 'cast', { card: uid, owner: card.owner, free: true, paid: 0, cost: 0, face: fi, from: 'battle' });
  s.batchNo++;
  collectBatch(c, [ev]);
  s.cont.push({
    kind: 'effect',
    id: nextId(s),
    causedBy: ev.id,
    ability: { defId: card.defId, face: fi, idx: info.spell.idx },
    source: { uid, ep: card.ep },
    lki: snapOf(c, uid),
    controller: card.owner,
    pc: 0,
    vars: {},
    trigger: ev,
  });
}

/** 封印を付ける: 持ち主の山札の上から1枚を、裏向きで、そのクリーチャーの上に置く */
function actSeal(c: Ctx, _f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  for (const u of resolveSel(cc, a.sel)) {
    const card = s.cards[u];
    if (card.zone !== 'battle') continue;
    const pm = permByPid(s, card.pid);
    if (!pm) continue;
    const deck = s.players[card.owner].deck;
    const d = deck[0];
    if (d === undefined) continue;
    const snap = snapOf(c, d);
    removeZoneCard(c, d);
    const dc = s.cards[d];
    dc.zone = 'battle';
    dc.ep++;
    dc.pid = pm.perm.pid;
    dc.face = 0;
    dc.tapped = false;
    (pm.perm.seals ??= []).push(d);
    s.sealed = true;
    emit(c, 'moved', { card: d, owner: dc.owner, from: 'deck', to: 'battle', cause: 'seal', kind: 'creature', ex: false, lki: snap, underneath: true });
  }
  s.dirtySba = true;
}

/** 持ち主の山札の上から depth 枚目の位置に、横向きに刺す */
function actStab(c: Ctx, _f: EffectFrame, cc: CC, a: any, _key: string): void {
  stabIntoDeck(c, resolveSel(cc, a.sel), a.depth ?? 4);
}

/**
 * ニンジャ・チェンジ: 相手のクリーチャーの攻撃・ブロックの途中で、自分のクリーチャー(sel)を手札に戻し、手札のこのクリーチャーを出す。
 * 攻撃先・ブロッカーが入れ替わるクリーチャーだったなら、出たクリーチャーがその役を引き継ぐ
 */
function actNinjaChange(c: Ctx, f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  const trig = f.trigger;
  if (!trig || (trig.type !== 'attackDeclared' && trig.type !== 'blocked')) return;
  const uid = f.source.uid;
  const card = s.cards[uid];
  if (card.ep !== f.source.ep || card.zone !== 'hand') return;
  const old = resolveSel(cc, a.sel)[0];
  if (old === undefined || s.cards[old].zone !== 'battle') return;
  const oldPm = permByPid(s, s.cards[old].pid);
  if (!oldPm || oldPm.owner !== card.owner) return;
  const fr = [...s.cont].reverse().find((x) => x.kind === 'proc' && x.name === 'attack' && x.vars.pid === trig.attacker);
  const fi = creatureFace(c, uid);
  if (fi < 0) return;
  const wasTapped = oldPm.perm.tapped;
  const oldPid = oldPm.perm.pid;
  const rep = gameHas(c, 'entryReplace') ? entryReplacement(c, uid, { to: 'battle', cause: 'ninjaChange', via: 'ninjaChange', face: fi, tapped: wasTapped, paid: 0 }, fi, 'ninjaChange') : null;
  const res = moveCards(c, [old], { to: 'hand', cause: 'bounce' });
  if (!res[0]?.moved) return;
  const evs: Ev[] = [];
  if (rep) applyEntryReplacement(c, uid, rep);
  else enterBattle(c, uid, { to: 'battle', cause: 'ninjaChange', via: 'ninjaChange', face: fi, tapped: wasTapped, paid: 0, noReplace: true }, evs);
  const newPid = s.cards[uid].pid;
  if (fr && fr.vars.target && fr.vars.target.kind === 'creature' && fr.vars.target.pid === oldPid) fr.vars.target = { kind: 'creature', pid: newPid };
  s.batchNo++;
  collectBatch(c, evs);
  s.dirtySba = true;
}

/** シールドのカード(sel)に、次の持ち主のターンのはじめまで「S・トリガー」を与える */
function actGrantShieldTrigger(c: Ctx, _f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  for (const u of resolveSel(cc, a.sel)) {
    const card = s.cards[u];
    if (card.zone !== 'shield') continue;
    s.usage[`stg:${u}:${card.ep}`] = s.turn;
  }
}

/** クロスギア(gear)を、クリーチャー(to)にクロスする(コストは支払わない) */
function actCross(c: Ctx, f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  const gu = (typeof a.gear === 'string' ? varUids(cc, a.gear, { ignoreEp: true }) : resolveSel(cc, a.gear))[0];
  const hu = (typeof a.to === 'string' ? varUids(cc, a.to, { ignoreEp: true }) : resolveSel(cc, a.to))[0];
  if (gu === undefined || hu === undefined) return;
  const gp = s.cards[gu].zone === 'battle' ? permByPid(s, s.cards[gu].pid) : null;
  const hp = s.cards[hu].zone === 'battle' ? permByPid(s, s.cards[hu].pid) : null;
  if (!gp || !hp || gp.owner !== hp.owner || gp.perm.crossedOn === hp.perm.pid) return;
  gp.perm.crossedOn = hp.perm.pid;
  emit(c, 'crossed', { card: gu, owner: gp.owner, host: hp.perm.cards[0], hostPid: hp.perm.pid, free: true });
  collectBatch(c, [c.out[c.out.length - 1]]);
  void f;
}

/** そのカード(マナゾーン)を、このターン、マナゾーンから召喚してもよい(コストは支払う) */
function actAllowSummon(c: Ctx, _f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  for (const u of resolveSel(cc, a.sel)) {
    const card = s.cards[u];
    if (card.zone === 'mana') s.usage[`pm:${u}:${card.ep}`] = s.turn;
  }
}

/** クリーチャー(進化の山)の下にあるカードを、n 枚(省略 = すべて)、墓地(または山札の下)に置く */
function actDropUnder(c: Ctx, _f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  for (const u of resolveSel(cc, a.sel)) {
    const card = s.cards[u];
    if (card.zone !== 'battle') continue;
    const pm = permByPid(s, card.pid);
    if (!pm || pm.perm.cards[0] !== u) continue;
    const n = Math.min(a.n ?? Infinity, pm.perm.cards.length - 1);
    for (let i = 0; i < n; i++) {
      const uc = pm.perm.cards.pop();
      if (uc === undefined || uc === u) break;
      const ucard = s.cards[uc];
      const snap = snapOf(c, uc);
      ucard.zone = a.to === 'deck' ? 'deck' : 'grave';
      ucard.ep++;
      ucard.pid = -1;
      ucard.tapped = false;
      ucard.face = 0;
      const own = s.players[ucard.owner];
      if (a.to === 'deck') own.deck.push(uc);
      else own.grave.push(uc);
      emit(c, 'moved', { card: uc, owner: ucard.owner, from: 'battle', to: ucard.zone, cause: 'trashUnder', kind: 'creature', ex: false, lki: snap, underneath: true });
    }
  }
  s.dirtySba = true;
}

/** クリーチャー(進化の山)の一番上のカードだけを破壊する(下のカードは残る) */
function actDestroyTop(c: Ctx, _f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  for (const u of resolveSel(cc, a.sel)) {
    if (s.cards[u].zone !== 'battle') continue;
    moveCards(c, [u], { to: 'grave', cause: 'destroy', alone: true });
  }
}

/** このクリーチャー(発生源)が、相手のシールドを n 個ブレイクする(破天九語) */
function actBreakOpp(c: Ctx, f: EffectFrame, _cc: CC, a: any, _key: string): void {
  const s = c.s;
  const me = f.controller;
  const opp = opponentOf(me);
  const n = Math.min(a?.n ?? 1, s.players[opp].shield.length);
  if (n <= 0) return;
  s.cont.push({ kind: 'proc', id: nextId(s), causedBy: c.cause, name: 'break', stage: 0, vars: { pid: s.cards[f.source.uid].pid, owner: me, n } });
}

/** 自分はゲームに勝つ */
function actWin(c: Ctx, f: EffectFrame, _cc: CC, _a: any, _key: string): void {
  const s = c.s;
  if (s.winner !== null) return;
  s.winner = f.controller;
  s.loseReason = '効果による勝利';
  emit(c, 'gameOver', { winner: f.controller, reason: '効果による勝利' });
}

/** アビスラッシュ(効果で出したクリーチャー): このターン攻撃でき、ターンの終わりに(ifAttacked なら、攻撃していれば)山札の下に置く */
function actRush(c: Ctx, _f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  for (const u of resolveSel(cc, a.sel)) {
    const card = s.cards[u];
    if (card.zone !== 'battle') continue;
    const pm = permByPid(s, card.pid);
    if (!pm) continue;
    pm.perm.rush = s.turn;
    if (a.ifAttacked) pm.perm.rushIfAttacked = true;
  }
}

/** そのカードを、別のコスト(alt)で使う(キリフダッシュ)。払えなければ何も起きない */
function actPlay(c: Ctx, _f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  for (const u of resolveSel(cc, a.sel)) {
    const card = s.cards[u];
    const fi = creatureFace(c, u);
    if (fi < 0) continue;
    s.cont.push({
      kind: 'proc',
      id: nextId(s),
      causedBy: c.cause,
      name: 'play',
      stage: 0,
      vars: { uid: u, ep: card.ep, from: card.zone, face: fi, free: false, extra: a.alt !== undefined ? { alt: a.alt } : undefined, after: null, settle: false, soft: true },
    });
  }
}

/** そのカードの「このクリーチャーが出た時」で始まる能力を1つ使う(どのゾーンのカードでもよい。最初の1つ) */
function actUseCip(c: Ctx, f: EffectFrame, cc: CC, a: any, _key: string): void {
  const s = c.s;
  // 捨てたばかりのカードなど、直前に動いたカードも指せるように、世代は見ない
  for (const u of typeof a.sel === 'string' ? varUids(cc, a.sel, { ignoreEp: true }) : resolveSel(cc, a.sel)) {
    const card = s.cards[u];
    const def = c.reg.defs[card.defId];
    for (let fi = 0; fi < def.faces.length; fi++) {
      if (!def.faces[fi].races && def.faces[fi].type === 'spell') continue;
      const t = c.reg.getInfo(card.defId, fi).triggers.find((r) => {
        if (r.ability.gen || r.ability.spec.subject !== 'self') return false;
        const on = Array.isArray(r.ability.spec.on) ? r.ability.spec.on : [r.ability.spec.on];
        return on.length === 1 && on[0].type === 'entered';
      });
      if (!t) continue;
      const ev: Ev = { id: nextId(s), causedBy: null, type: 'entered', turn: s.turn, card: u, owner: card.owner };
      s.cont.push({
        kind: 'effect',
        id: nextId(s),
        causedBy: c.cause,
        ability: { defId: card.defId, face: fi, idx: t.idx },
        source: ref(c, u),
        lki: snapOf(c, u),
        controller: f.controller,
        pc: 0,
        vars: {},
        trigger: ev,
        noOptional: true,
      });
      break;
    }
  }
}

/** プレイヤーの墓地をシャッフルして、山札の下に置く */
function actGraveToBottom(c: Ctx, f: EffectFrame, _cc: CC, a: any, _key: string): void {
  const s = c.s;
  const who = playerOf(f, a?.who);
  const uids = s.players[who].grave.slice();
  if (uids.length === 0) return;
  shuffleInPlace(s, uids);
  moveCards(c, uids, { to: 'deck', cause: 'effect', pos: 'bottom' });
}

function actLog(c: Ctx, f: EffectFrame, _cc: CC, a: any, _key: string): void {
  // 「そのターン中に〜を使っていなければ」の判定用に、印をログに残す
  emit(c, a, { owner: f.controller, source: f.source.uid });
}

function actSetVar(_c: Ctx, f: EffectFrame, cc: CC, a: any, _key: string): void {
  // 値が式(オブジェクト)なら、その場で評価した数を入れる
  f.vars[a.as] = typeof a.value === 'object' && a.value !== null ? evalExpr(cc, a.value) : a.value;
}

/** 原始操作の名前 → 実行する関数(act の最初のキーで引く) */
const ACT_HANDLERS = new Map<string, (c: Ctx, f: EffectFrame, cc: CC, a: any, key: string) => void>([
  ['draw', actDraw],
  ['move', actMove],
  ['moveTop', actMoveTop],
  ['moveBottom', actMoveBottom],
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
  ['shuffleIn', actShuffleIn],
  ['bottom', actBottom],
  ['summonOnto', actSummonOnto],
  ['extraTurn', actExtraTurn],
  ['markUsed', actMarkUsed],
  ['putUnder', actPutUnder],
  ['tapLock', actTapLock],
  ['breakShields', actBreakShields],
  ['judge', actJudge],
  ['castSide', actCastSide],
  ['seal', actSeal],
  ['stab', actStab],
  ['rush', actRush],
  ['dropUnder', actDropUnder],
  ['destroyTop', actDestroyTop],
  ['allowSummon', actAllowSummon],
  ['breakOpp', actBreakOpp],
  ['cross', actCross],
  ['ninjaChange', actNinjaChange],
  ['grantShieldTrigger', actGrantShieldTrigger],
  ['win', actWin],
  ['play', actPlay],
  ['useCip', actUseCip],
  ['graveToBottom', actGraveToBottom],
  ['stackShield', actStackShield],
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
