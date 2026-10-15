// 効果のインタプリタ(effects 6.5)。フレームは pc と vars(JSON)だけを持ち、再開できる。
import type { ActDef, Cond, Expr, Selector, StepDef } from './ast';
import { type CC, evalCond, evalExpr, selectCards, varUids } from './cond';
import { charsOf, infoOf } from './derive';
import {
  addShieldFromDeck,
  ask,
  collectBatch,
  drawCards,
  emit,
  enterBattle,
  moveCards,
  setTapped,
  shuffleDeck,
} from './ops';
import type { Ctx } from './state';
import { nextId, opponentOf, permByPid, rngInt, shuffleInPlace, snapOf } from './state';
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
      const ans = ask<boolean>(c, {
        player: f.controller,
        why: 'may',
        input: { shape: 'yesno' },
        source: f.source,
        prompt: `${sourceName(c, f)}: ${ins.prompt ?? '効果を使いますか?'}`,
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

function execSelect(c: Ctx, f: EffectFrame, cc: CC, st: Extract<StepDef, { op: 'select' }>): void {
  let cand: number[];
  const from = st.from;
  if (from && 'var' in from && !('zone' in from)) cand = varUids(cc, from.var);
  else cand = selectCards(cc, from as Selector);
  const chooser: PlayerId =
    st.who === 'opponent' ? opponentOf(f.controller) : st.who === 'iter' ? (f.vars.$iter ?? f.controller) : f.controller;
  const min0 = st.min === undefined ? 1 : evalExpr(cc, st.min);
  const max0 = st.max === undefined ? 1 : evalExpr(cc, st.max);
  const n = cand.length;
  const max = Math.min(max0, n);
  const min = Math.min(min0, max);
  let picked: number[];
  if (max === 0) picked = [];
  else if (st.random) {
    const pool = cand.slice();
    picked = [];
    while (picked.length < max && pool.length) picked.push(pool.splice(rngInt(c.s, pool.length), 1)[0]);
  } else if (min === n) {
    picked = cand.slice();
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
  f.vars[st.as] = picked.map((u) => ref(c, u));
  if (picked.length) {
    // 選んだものの公開(相手が選んだものなど)は、ログのためにイベントにする
    emit(c, 'chosen', { cards: picked, by: chooser, source: f.source.uid });
  }
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
  throw new Error('未知の期限: ' + until);
}

function execAct(c: Ctx, f: EffectFrame, cc: CC, act: ActDef): void {
  const s = c.s;
  const key = Object.keys(act)[0];
  const a: any = act[key];
  switch (key) {
    case 'draw': {
      const n = typeof a === 'number' ? a : evalExpr(cc, a.n);
      const who = playerOf(f, typeof a === 'object' ? a.who : undefined);
      drawCards(c, who, n);
      return;
    }
    case 'move': {
      const uids = resolveSel(cc, a.sel);
      const res = moveCards(c, uids, { to: a.to, cause: a.cause ?? 'effect', pos: a.pos, tapped: a.tapped });
      if (a.as) {
        f.vars[a.as] = res.filter((r) => r.moved && r.to === a.to).map((r) => ({ uid: r.uid, ep: r.ep }));
      }
      return;
    }
    case 'moveTop': {
      const who = playerOf(f, a.who);
      const n = evalExpr(cc, a.n);
      const top = s.players[who].deck.slice(0, n);
      const res = moveCards(c, top, { to: a.to, cause: a.cause ?? 'effect', tapped: a.tapped });
      if (a.as) f.vars[a.as] = res.filter((r) => r.moved).map((r) => ({ uid: r.uid, ep: r.ep }));
      return;
    }
    case 'lookTop': {
      const who = playerOf(f, a.who);
      const n = evalExpr(cc, a.n);
      const top = s.players[who].deck.slice(0, n);
      f.vars[a.as] = top.map((u) => ref(c, u));
      // この能力で見たカード。後の選択肢(modes)で、選ぶ人に見せる(マルル: 見てから選ぶ)
      f.vars[':seen'] = [...((f.vars[':seen'] as number[] | undefined) ?? []), ...top];
      emit(c, 'looked', { cards: top, to: who, from: 'deck' });
      return;
    }
    case 'revealUntil': {
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
      return;
    }
    case 'reveal': {
      const uids = resolveSel(cc, a.items);
      for (const p of [0, 1] as PlayerId[]) {
        if (s.cfg.ackReveals[p]) {
          ask(c, { player: p, why: 'ack', input: { shape: 'ack', shown: uids }, source: f.source, prompt: `${sourceName(c, f)}: 公開` });
        }
      }
      emit(c, 'revealed', { cards: uids, to: 'all' });
      return;
    }
    case 'shuffleBottom': {
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
      return;
    }
    case 'shuffle': {
      shuffleDeck(c, playerOf(f, a?.who));
      return;
    }
    case 'assign': {
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
      return;
    }
    case 'addShield': {
      const n = a?.n ?? 1;
      for (let i = 0; i < n; i++) addShieldFromDeck(c, f.controller);
      return;
    }
    case 'tap':
    case 'untap': {
      for (const u of resolveSel(cc, a.sel)) setTapped(c, u, key === 'tap');
      return;
    }
    case 'addEffect': {
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
      return;
    }
    case 'put':
    case 'summon': {
      const uids = resolveSel(cc, a.sel);
      const via = key === 'summon' ? 'summon' : 'effect';
      const evs: Ev[] = [];
      const entered: ObjRef[] = [];
      for (const u of uids) {
        const fi = creatureFace(c, u);
        if (fi < 0) continue;
        const face = c.reg.getFace(s.cards[u].defId, fi);
        if (face.type === 'evolution') continue; // 進化元がないので出せない
        const r = enterBattle(c, u, { to: 'battle', cause: via, via, face: fi, paid: 0 }, evs);
        entered.push({ uid: u, ep: r.ep });
      }
      if (a.as) f.vars[a.as] = entered;
      s.batchNo++;
      collectBatch(c, evs);
      s.dirtySba = true;
      return;
    }
    case 'castFree': {
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
      return;
    }
    case 'skipRestOfTurn': {
      s.skipTurn = true;
      emit(c, 'skipTurn', { by: f.controller, source: f.source.uid });
      return;
    }
    case 'copyTrigger': {
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
      return;
    }
    case 'invade': {
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
      return;
    }
    case 'revolutionChange': {
      // 革命チェンジ: 攻撃中のクリーチャーを手札に戻し、このカードを手札から攻撃中のクリーチャーとして出す。
      // 「攻撃する時」は誘発しない(攻撃の宣言は済んでいる)。攻撃の対象は変わらない。
      const trig = f.trigger;
      if (!trig || trig.type !== 'attackDeclared') return;
      const uid = f.source.uid;
      const card = s.cards[uid];
      if (card.ep !== f.source.ep || card.zone !== 'hand') return;
      const pm = permByPid(s, trig.attacker);
      if (!pm || pm.perm.cards[0] !== trig.card) return;
      const fr = [...s.cont].reverse().find((x) => x.kind === 'proc' && x.name === 'attack' && x.vars.pid === trig.attacker);
      if (!fr) return;
      const fi = creatureFace(c, uid);
      if (fi < 0) return;
      const res = moveCards(c, [trig.card], { to: 'hand', cause: 'revolutionChange' });
      if (!res[0]?.moved) return; // 置換されて離れなかった(EXライフなど): 入れ替わらない
      const evs: Ev[] = [];
      enterBattle(c, uid, { to: 'battle', cause: 'revolutionChange', via: 'revolutionChange', face: fi, tapped: true, paid: 0 }, evs);
      fr.vars.pid = s.cards[uid].pid;
      s.batchNo++;
      collectBatch(c, evs);
      s.dirtySba = true;
      return;
    }
    case 'playerEffect': {
      // プレイヤー単位の継続効果(pid = -1)。「相手は〜できない」
      const m = a.mod;
      const mod: EffectMod = m.kind === 'cannotUseCost' ? { kind: 'cannotUseCost', n: evalExpr(cc, m.n) } : { kind: 'cannotCast' };
      s.effects.push({ id: nextId(s), pid: -1, mod, until: durationOf(c, f, a.until), controller: f.controller });
      return;
    }
    case 'log': {
      // 「そのターン中に〜を使っていなければ」の判定用に、印をログに残す
      emit(c, a, { owner: f.controller, source: f.source.uid });
      return;
    }
    case 'setVar': {
      f.vars[a.as] = a.value;
      return;
    }
    default:
      throw new Error('未知の原始操作: ' + key);
  }
}

export { creatureFace, spellFace, infoOf, charsOf };
