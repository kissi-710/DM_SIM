// 手続きフレーム: ターン進行・プレイ・攻撃・シールドブレイク・チェックポイント・状況起因処理
// (effects 5, 9, 10)。各ステージは「質問 → 変更」の順で書き、再実行しても二重に変更されない。
import { evalCond, mkCC } from './cond';
import {
  breakerCount,
  canAttack,
  canBlock,
  canCast,
  canUseCost,
  charsOf,
  costOf,
  hasKeyword,
  infoOf,
  isUnblockable,
  payNeed,
  planPayment,
  powerOf,
} from './derive';
import {
  ask,
  collectBatch,
  drawCards,
  emit,
  enterBattle,
  moveCards,
  setTapped,
} from './ops';
import type { Ctx } from './state';
import { nextId, opponentOf, permByPid, rngInt, snapOf } from './state';
import type {
  AbilityRef,
  Civ,
  EffectFrame,
  Ev,
  PlayExtra,
  PlayerId,
  PoolEntry,
  ProcFrame,
  ProcName,
  ZoneName,
} from './types';

// ───────────────────────── フレームの積み方 ─────────────────────────

export function pushProc(c: Ctx, name: ProcName, vars: Record<string, any> = {}): ProcFrame {
  const f: ProcFrame = { kind: 'proc', id: nextId(c.s), causedBy: c.cause, name, stage: 0, vars };
  c.s.cont.push(f);
  return f;
}

export function popFrame(c: Ctx, f: { id: number }): void {
  const top = c.s.cont[c.s.cont.length - 1];
  if (top.id !== f.id) throw new Error('フレームの積み順が不正です');
  c.s.cont.pop();
}

// ───────────────────────── プレイの計画(召喚・詠唱) ─────────────────────────

export interface PlayPlan {
  ok: boolean;
  err?: string;
  face: number;
  kind: 'summon' | 'cast';
  cost: number;
  need: number;
  civs: Civ[];
  pay: number[];
  after: 'deckBottom' | null;
  taps: number[];
  onto?: number;
}

export function planPlay(
  c: Ctx,
  player: PlayerId,
  uid: number,
  from: ZoneName,
  faceIdx: number,
  extra: PlayExtra | undefined,
  free: boolean,
): PlayPlan {
  const s = c.s;
  const card = s.cards[uid];
  const fail = (err: string): PlayPlan => ({ ok: false, err, face: faceIdx, kind: 'summon', cost: 0, need: 0, civs: [], pay: [], after: null, taps: [] });
  if (!card || card.owner !== player) return fail('自分のカードではありません');
  if (card.zone !== from) return fail('カードがそのゾーンにありません');
  const def = c.reg.defs[card.defId];
  const face = def.faces[faceIdx];
  if (!face) return fail('面がありません');
  const info = c.reg.getInfo(card.defId, faceIdx);
  const kind = face.type === 'spell' ? 'cast' : 'summon';
  let after: 'deckBottom' | null = null;
  if (from !== 'hand' && !free) {
    const perm = info.permissions.find((p) => p.from === from && p.play === kind);
    if (!perm) return fail('そのゾーンからはプレイできません');
    after = perm.after ?? null;
  } else if (from !== 'hand' && free) {
    const perm = info.permissions.find((p) => p.from === from && p.play === kind);
    after = perm?.after ?? null;
  }
  if (kind === 'cast' && !canCast(c, player, uid, faceIdx)) return fail('この呪文は唱えられません');
  if (!canUseCost(c, player, face.cost)) return fail('そのコストのカードは実行できません');

  let onto: number | undefined;
  if (face.type === 'evolution') {
    const pm = extra?.onto !== undefined ? permByPid(s, extra.onto) : null;
    if (!pm || pm.owner !== player) return fail('進化元を選んでください');
    const topUid = pm.perm.cards[0];
    const cc = mkCC(c, player, { self: uid, it: topUid, itFace: s.cards[topUid].face });
    if (!face.evolveFrom || !evalCond(cc, face.evolveFrom)) return fail('進化元の条件を満たしていません');
    onto = pm.perm.pid;
  } else if (extra?.onto !== undefined) return fail('進化クリーチャーではありません');

  const taps = extra?.tap ?? [];
  if (taps.length) {
    if (!info.hyperEnergy) return fail('ハイパーエナジーを持ちません');
    const seen = new Set<number>();
    for (const pid of taps) {
      const pm = permByPid(s, pid);
      if (!pm || pm.owner !== player || pm.perm.tapped) return fail('タップできないクリーチャーです');
      const cost = charsOf(c, pm.perm.cards[0], -1).cost;
      if (seen.has(cost)) return fail('コストが互いに異なるクリーチャーを選んでください');
      seen.add(cost);
    }
  }
  const cost = costOf(c, uid, faceIdx, { taps, free });
  const civs = face.civs;
  const need = free ? 0 : payNeed(cost, civs.length);
  let pay: number[] = [];
  if (need > 0) {
    if (extra?.pay?.length) {
      // 手動支払い: 文明と枚数を検証
      const m = extra.pay;
      if (m.length !== need || new Set(m).size !== m.length) return fail('支払うマナの枚数が違います');
      for (const u of m) {
        const mc = s.cards[u];
        if (!mc || mc.owner !== player || mc.zone !== 'mana' || mc.tapped || u === uid) return fail('そのマナは使えません');
      }
      if (!covers(c, m, civs)) return fail('文明を満たしていません');
      pay = m.slice();
    } else {
      const keep = s.players[player].hand.filter((u) => u !== uid);
      const plan = planPayment(c, player, civs, need, from === 'mana' ? [uid] : [], keep);
      if (!plan) return fail('マナが足りません');
      pay = plan;
    }
  }
  return { ok: true, face: faceIdx, kind, cost, need, civs, pay, after, taps, onto };
}

/** 支払いの選択肢(UI が「聞くか、自動で払うか」を決めるための情報) */
export interface PayChoice {
  /** タップする枚数(0 なら支払いなし) */
  need: number;
  /** 使えるマナ(アンタップ) */
  avail: number[];
  /** 自動で払う場合のマナ(プレイできなければ空) */
  auto: number[];
  /**
   * 自明か。有効な払い方が1通り(文明の組み合わせとして区別がない)なら true。
   * 自明なら、人間にも聞かずに自動で払ってよい(UI 方針「自明なら質問を省略する」)。
   */
  obvious: boolean;
}

/**
 * カードを使う時のマナの払い方に、プレイヤーが選べる余地があるかを調べる。
 * マナは「持つ文明の組」が同じなら区別しない(同じ組のマナどうしは、どれをタップしても結果が同じ)。
 * 組ごとの枚数の振り分けを数え上げ、有効なものが2通り以上あるときだけ「選択がある」とする。
 */
export function payChoice(c: Ctx, player: PlayerId, uid: number, from: ZoneName, faceIdx: number, extra: PlayExtra | undefined, free: boolean): PayChoice {
  const base = planPlay(c, player, uid, from, faceIdx, { ...(extra ?? {}), pay: undefined }, free);
  if (!base.ok || base.need <= 0) return { need: base.need, avail: [], auto: base.pay, obvious: true };
  const s = c.s;
  const avail = s.players[player].mana.filter((u) => !s.cards[u].tapped && u !== uid);
  const groups = new Map<string, number[]>();
  for (const u of avail) {
    const key = charsOf(c, u, -1).civs.slice().sort().join(',');
    const g = groups.get(key);
    if (g) g.push(u);
    else groups.set(key, [u]);
  }
  const gs = [...groups.values()];
  const tail: number[] = new Array(gs.length + 1).fill(0);
  for (let i = gs.length - 1; i >= 0; i--) tail[i] = tail[i + 1] + gs[i].length;
  let valid = 0;
  const picked: number[] = [];
  const go = (i: number, left: number): void => {
    if (valid >= 2) return;
    if (left === 0) {
      if (covers(c, picked, base.civs)) valid++;
      return;
    }
    if (i === gs.length || tail[i] < left) return;
    for (let k = Math.min(gs[i].length, left); k >= 0; k--) {
      for (let j = 0; j < k; j++) picked.push(gs[i][j]);
      go(i + 1, left - k);
      picked.length -= k;
    }
  };
  go(0, base.need);
  return { need: base.need, avail, auto: base.pay, obvious: valid <= 1 };
}

/** 選んだマナが、必要な文明を1枚ずつ(1枚は1文明)満たせるか */
function covers(c: Ctx, mana: number[], civs: Civ[]): boolean {
  const cs = mana.map((u) => charsOf(c, u, -1).civs);
  const used = new Set<number>();
  const go = (i: number): boolean => {
    if (i === civs.length) return true;
    for (let j = 0; j < mana.length; j++) {
      if (used.has(j) || !cs[j].includes(civs[i])) continue;
      used.add(j);
      if (go(i + 1)) return true;
      used.delete(j);
    }
    return false;
  };
  return go(0);
}

// ───────────────────────── ターン進行 ─────────────────────────

function runTurn(c: Ctx, f: ProcFrame): void {
  const s = c.s;
  const P = s.active;
  switch (f.stage) {
    case 0: {
      if (s.turn > s.cfg.turnLimit) {
        s.winner = 'draw';
        s.loseReason = 'ターン上限';
        emit(c, 'gameOver', { winner: 'draw', reason: 'ターン上限' });
        return;
      }
      s.step = 'start';
      s.turnLog = [];
      s.skipTurn = false;
      s.manaCharged = false;
      // 自分のマナとクリーチャーをアンタップし、召喚酔いを解除する
      for (const u of s.players[P].mana) s.cards[u].tapped = false;
      for (const perm of s.players[P].battle) {
        perm.tapped = false;
        perm.sick = false;
      }
      // 「次の自分のターンのはじめまで」の期限切れ
      s.effects = s.effects.filter((e) => !(e.until.kind === 'untilTurnStart' && e.until.player === P && s.turn > e.until.afterTurn));
      emit(c, 'stepStart', { step: 'start', player: P });
      s.batchNo++;
      collectBatch(c, [c.out[c.out.length - 1]]);
      f.stage = 1;
      pushProc(c, 'settle');
      return;
    }
    case 1: {
      s.step = 'draw';
      const skipDraw = s.turn === 1 && P === s.first;
      if (!skipDraw && !(s.cfg.solitaire && P === 1)) drawCards(c, P, 1);
      s.step = 'mana';
      f.stage = 2;
      pushProc(c, 'settle');
      return;
    }
    case 2: {
      if (s.winner !== null) return;
      if (s.skipTurn) {
        s.step = 'end';
        s.skipTurn = false;
        // L6: 設定で、ターン終了時の誘発を起こさないこともできる
        if (!s.cfg.skipRunsEndTriggers) f.vars.noEnd = true;
      }
      if (s.cfg.solitaire && P === 1) s.step = 'end';
      if (s.step === 'end') {
        f.stage = 3;
        return;
      }
      s.pending = { id: nextId(s), player: P, why: 'turnAction', input: null };
      return;
    }
    case 3: {
      if (f.vars.noEnd) {
        f.vars.noEnd = false;
        f.stage = 4;
        return;
      }
      emit(c, 'stepStart', { step: 'end', player: P });
      s.batchNo++;
      collectBatch(c, [c.out[c.out.length - 1]]);
      f.stage = 4;
      pushProc(c, 'settle');
      return;
    }
    case 4: {
      s.effects = s.effects.filter((e) => !(e.until.kind === 'endOfTurn' && e.until.turn <= s.turn));
      s.turn += 1;
      s.active = opponentOf(P);
      s.step = 'start';
      f.stage = 0;
      return;
    }
  }
}

// ───────────────────────── プレイ(召喚・詠唱) ─────────────────────────

function runPlay(c: Ctx, f: ProcFrame): void {
  const s = c.s;
  const v = f.vars;
  const uid: number = v.uid;
  switch (f.stage) {
    case 0: {
      const card = s.cards[uid];
      if (!card || card.ep !== v.ep || card.zone !== v.from) {
        popFrame(c, f); // 何かの効果で離れた
        return;
      }
      const owner = card.owner;
      const plan = planPlay(c, owner, uid, v.from, v.face, v.extra, !!v.free);
      if (!plan.ok) {
        if (v.free) {
          popFrame(c, f); // 無料で使えない(進化元がない等)
          return;
        }
        throw new Error('プレイできません: ' + plan.err);
      }
      // ハイパーエナジー: クリーチャーをタップ
      for (const pid of plan.taps) {
        const pm = permByPid(s, pid)!;
        setTapped(c, pm.perm.cards[0], true);
      }
      for (const u of plan.pay) setTapped(c, u, true);
      // プレイ中として処理する(場所は limbo)
      const prevZone = card.zone;
      removeFrom(c, uid);
      card.zone = 'limbo';
      card.ep++;
      card.face = plan.face;
      s.limbo.push(uid);
      v.plan = { kind: plan.kind, paid: plan.pay.length, cost: plan.cost, after: plan.after, onto: plan.onto ?? null, face: plan.face, free: !!v.free };
      v.fromZone = prevZone;
      f.stage = 1;
      return;
    }
    case 1: {
      const p = v.plan;
      const card = s.cards[uid];
      const owner = card.owner;
      if (p.kind === 'summon') {
        const evs: Ev[] = [];
        enterBattle(c, uid, { to: 'battle', cause: 'summon', via: 'summon', onto: p.onto ?? undefined, face: p.face, paid: p.paid, cost: p.cost, free: p.free }, evs);
        s.batchNo++;
        collectBatch(c, evs);
        s.dirtySba = true;
        f.stage = 3;
        return;
      }
      emit(c, 'cast', { card: uid, owner, free: p.free, paid: p.paid, cost: p.cost, face: p.face, from: v.fromZone });
      const ev = c.out[c.out.length - 1];
      s.batchNo++;
      collectBatch(c, [ev]);
      f.stage = 2;
      const info = c.reg.getInfo(card.defId, p.face);
      if (info.spell) {
        const fr: EffectFrame = {
          kind: 'effect',
          id: nextId(s),
          causedBy: ev.id,
          ability: { defId: card.defId, face: p.face, idx: info.spell.idx },
          source: { uid, ep: card.ep },
          lki: snapOf(c, uid),
          controller: owner,
          pc: 0,
          vars: {},
          trigger: ev,
        };
        s.cont.push(fr);
      }
      return;
    }
    case 2: {
      // 呪文の解決後。墓地(または山札の下)に置く
      const p = v.plan;
      const card = s.cards[uid];
      if (card.zone === 'limbo') {
        if (v.after === 'hyper') {
          // インターステラ: 墓地(や山札の下)のかわりに超次元ゾーンに置く。呪文自身の置換と重なる時は超次元ゾーンを選ぶ
          moveCards(c, [uid], { to: 'hyper', cause: 'castHyper', noReplace: true });
        } else if (p.after === 'deckBottom' || v.after === 'deckBottom') {
          moveCards(c, [uid], { to: 'deck', cause: 'castBottom', pos: 'bottom', noReplace: true });
        } else {
          moveCards(c, [uid], { to: 'grave', cause: 'cast', noReplace: true });
        }
      }
      f.stage = 3;
      return;
    }
    case 3:
      popFrame(c, f);
      return;
  }
}

function removeFrom(c: Ctx, uid: number): void {
  const s = c.s;
  const card = s.cards[uid];
  const own = s.players[card.owner];
  if (card.zone === 'limbo') {
    const i = s.limbo.indexOf(uid);
    if (i >= 0) s.limbo.splice(i, 1);
  } else if (card.zone !== 'battle') {
    const arr = own[card.zone];
    const i = arr.indexOf(uid);
    if (i >= 0) arr.splice(i, 1);
  }
}

// ───────────────────────── 攻撃 ─────────────────────────

function runAttack(c: Ctx, f: ProcFrame): void {
  const s = c.s;
  const v = f.vars;
  switch (f.stage) {
    case 0: {
      const pm = permByPid(s, v.pid);
      if (!pm) {
        popFrame(c, f);
        return;
      }
      const owner = pm.owner;
      const top = pm.perm.cards[0];
      setTapped(c, top, true);
      emit(c, 'attackDeclared', { card: top, attacker: pm.perm.pid, owner, target: v.target });
      const ev = c.out[c.out.length - 1];
      s.batchNo++;
      collectBatch(c, [ev]);
      f.stage = 1;
      pushProc(c, 'settle');
      return;
    }
    case 1: {
      if (s.winner !== null || s.skipTurn) {
        popFrame(c, f);
        return;
      }
      const pm = permByPid(s, v.pid);
      if (!pm) {
        popFrame(c, f);
        return;
      }
      const target = v.target as { kind: 'player' } | { kind: 'creature'; pid: number };
      if (target.kind === 'creature' && !permByPid(s, target.pid)) {
        popFrame(c, f); // 攻撃先が場を離れた → 攻撃は終了
        return;
      }
      const defender = opponentOf(pm.owner);
      // 攻撃されているクリーチャー自身は、ブロッカーとして選べない(総合ルール 507.1a)
      const attacked = v.target.kind === 'creature' ? v.target.pid : -1;
      const cands = isUnblockable(c, pm.perm)
        ? []
        : s.players[defender].battle.filter((p) => p.pid !== attacked && canBlock(c, p)).map((p) => p.cards[0]);
      let blocker: number | null = null;
      if (cands.length > 0) {
        const ans = ask<number[]>(c, {
          player: defender,
          why: 'block',
          input: { shape: 'pick', candidates: cands, min: 0, max: 1 },
          source: null,
          prompt: 'ブロッカーでブロックしますか?',
        });
        if (ans.length) blocker = ans[0];
      }
      if (blocker !== null) {
        const bpm = permByPid(s, s.cards[blocker].pid)!;
        setTapped(c, blocker, true);
        v.target = { kind: 'creature', pid: bpm.perm.pid };
        v.blocked = true;
        emit(c, 'blocked', { attacker: pm.perm.pid, attackerCard: pm.perm.cards[0], blocker: bpm.perm.pid, card: blocker, owner: defender });
        const ev = c.out[c.out.length - 1];
        s.batchNo++;
        collectBatch(c, [ev]);
        f.stage = 2;
        pushProc(c, 'settle');
      } else {
        f.stage = 2;
      }
      return;
    }
    case 2: {
      if (s.winner !== null || s.skipTurn) {
        popFrame(c, f);
        return;
      }
      const pm = permByPid(s, v.pid);
      if (!pm) {
        popFrame(c, f);
        return;
      }
      const target = v.target as { kind: 'player' } | { kind: 'creature'; pid: number };
      if (target.kind === 'player') {
        f.stage = 3;
        pushProc(c, 'break', { pid: pm.perm.pid, owner: pm.owner, n: breakerCount(c, pm.perm) });
        return;
      }
      const dm = permByPid(s, target.pid);
      if (!dm) {
        popFrame(c, f);
        return;
      }
      const pa = powerOf(c, pm.perm);
      const pd = powerOf(c, dm.perm);
      const aTop = pm.perm.cards[0];
      const dTop = dm.perm.cards[0];
      const losers: number[] = [];
      let winner: number | null = null;
      if (pa > pd) {
        losers.push(dTop);
        winner = aTop;
      } else if (pa < pd) {
        losers.push(aTop);
        winner = dTop;
      } else losers.push(aTop, dTop);
      // スレイヤー: バトルの後、バトルした相手を破壊する(勝敗にかかわらず)
      if (hasKeyword(c, pm.perm, 'slayer') && !losers.includes(dTop)) losers.push(dTop);
      if (hasKeyword(c, dm.perm, 'slayer') && !losers.includes(aTop)) losers.push(aTop);
      const aOwner = pm.owner;
      const dOwner = dm.owner;
      const aPid = pm.perm.pid;
      const dPid = dm.perm.pid;
      moveCards(c, losers, { to: 'grave', cause: 'destroy' });
      const winPid = winner === null ? null : winner === aTop ? aPid : dPid;
      emit(c, 'battleEnded', {
        attacker: aPid,
        defender: dPid,
        winner: winPid,
        card: winner,
        winnerCard: winner,
        loserCard: winner === null ? null : winner === aTop ? dTop : aTop,
        loserOwner: winner === null ? undefined : winner === aTop ? dOwner : aOwner,
        winnerOwner: winner === null ? undefined : winner === aTop ? aOwner : dOwner,
        draw: winner === null,
      });
      const ev = c.out[c.out.length - 1];
      s.batchNo++;
      collectBatch(c, [ev]);
      f.stage = 3;
      pushProc(c, 'settle');
      return;
    }
    case 3:
      popFrame(c, f);
      return;
  }
}

// ───────────────────────── シールドブレイク ─────────────────────────

function runBreak(c: Ctx, f: ProcFrame): void {
  const s = c.s;
  const v = f.vars;
  const attackerOwner: PlayerId = v.owner;
  const defender = opponentOf(attackerOwner);
  switch (f.stage) {
    case 0: {
      const shields = s.players[defender].shield;
      if (shields.length === 0) {
        // 攻撃先が変更されないまま、シールドが0枚の相手プレイヤーへの攻撃が成立 → 勝利
        s.winner = attackerOwner;
        s.loseReason = 'ダイレクトアタック';
        emit(c, 'gameOver', { winner: attackerOwner, reason: 'ダイレクトアタック' });
        popFrame(c, f);
        return;
      }
      const n = Math.min(v.n, shields.length);
      // どのシールドを割るかは攻撃側が選ぶが、裏向きなので無作為に扱う(spec 3.7)
      const pool = shields.slice();
      const broken: number[] = [];
      while (broken.length < n) broken.push(pool.splice(rngInt(s, pool.length), 1)[0]);
      v.broken = broken;
      s.breaking = broken.slice();
      const brokenEvs: Ev[] = [];
      for (const u of broken) brokenEvs.push(emit(c, 'shieldBroken', { card: u, owner: defender, by: v.pid }));
      s.batchNo++;
      collectBatch(c, brokenEvs);
      f.stage = 1;
      return;
    }
    case 1: {
      const broken: number[] = v.broken;
      s.breaking = broken.slice(); // 再実行時の復元
      // S・トリガー/G・ストライクを宣言できるカード(革命2は、ブレイク後の枚数で判定)
      const cands: number[] = [];
      for (const u of broken) {
        if (declaration(c, u)) cands.push(u);
      }
      let declared: number[] = [];
      if (cands.length > 0) {
        declared = ask<number[]>(c, {
          player: defender,
          why: 'triggerDeclare',
          input: { shape: 'pick', candidates: cands, min: 0, max: cands.length },
          source: null,
          prompt: 'S・トリガー/G・ストライクを宣言するカードを選んでください',
        });
      }
      // 宣言がすべて終わってから、手札に加える(112.3a)
      const kinds = declared.map((u) => ({ u, d: declaration(c, u)! }));
      moveCards(c, broken, { to: 'hand', cause: 'break', noReplace: true });
      s.breaking = [];
      const batch = ++s.batchNo;
      for (const { u, d } of kinds) {
        emit(c, 'triggerDeclared', { card: u, owner: defender, kind: d.kind });
        const card = s.cards[u];
        const entry: PoolEntry = {
          id: nextId(s),
          batch,
          ability: d.ref,
          kind: d.kind,
          source: { uid: u, ep: card.ep },
          lki: snapOf(c, u),
          controller: defender,
          event: null,
          stLayer: true,
        };
        s.pool.push(entry);
      }
      f.stage = 2;
      pushProc(c, 'settle');
      return;
    }
    case 2:
      popFrame(c, f);
      return;
  }
}

/** シールドゾーンから手札に加わる時に宣言できる能力(S・トリガー / G・ストライク)。 */
export function declaration(c: Ctx, uid: number): { kind: 'shieldTrigger' | 'gStrike'; ref: AbilityRef; face: number } | null {
  const s = c.s;
  const card = s.cards[uid];
  const def = c.reg.defs[card.defId];
  const cc = mkCC(c, card.owner, { self: uid });
  for (let fi = 0; fi < def.faces.length; fi++) {
    const info = c.reg.getInfo(card.defId, fi);
    for (const st of info.shieldTriggers) {
      if (st.ability.while && !evalCond(cc, st.ability.while)) continue;
      return { kind: 'shieldTrigger', ref: { defId: card.defId, face: fi, idx: st.idx }, face: fi };
    }
    if (info.gStrike) return { kind: 'gStrike', ref: { defId: card.defId, face: fi, idx: info.gStrike.idx }, face: fi };
  }
  return null;
}

// ───────────────────────── チェックポイント ─────────────────────────

/** 待機プールから次に解決する能力の候補を選ぶ(101.4 / effects 5.2) */
export function pickNextCandidates(c: Ctx): { player: PlayerId; entries: PoolEntry[] } | null {
  const s = c.s;
  if (s.pool.length === 0) return null;
  let group: PoolEntry[];
  const st = s.pool.filter((e) => e.stLayer);
  if (st.length) {
    const maxBatch = Math.max(...st.map((e) => e.batch));
    group = st.filter((e) => e.batch === maxBatch);
  } else {
    group = s.pool;
    if (s.cfg.waitingPolicy === 'newFirst') {
      const m = Math.max(...group.map((e) => e.batch));
      group = group.filter((e) => e.batch === m);
    } else if (s.cfg.waitingPolicy === 'oldFirst') {
      const m = Math.min(...group.map((e) => e.batch));
      group = group.filter((e) => e.batch === m);
    }
  }
  const tp = group.filter((e) => e.controller === s.active);
  if (tp.length) return { player: s.active, entries: tp };
  return { player: opponentOf(s.active), entries: group };
}

function runSettle(c: Ctx, f: ProcFrame): void {
  const s = c.s;
  // 状況起因処理(1回につき1つの変更を行い、再びここへ戻る)
  if (runSba(c)) return;
  if (s.winner !== null) {
    popFrame(c, f);
    return;
  }
  const pick = pickNextCandidates(c);
  if (!pick) {
    popFrame(c, f);
    return;
  }
  let chosen: PoolEntry;
  // 同じ能力(同じカード・同じ能力)ばかりなら、順序で結果が変わらないので質問しない(effects 12)
  const same = pick.entries.every(
    (e) =>
      e.kind === pick.entries[0].kind &&
      e.controller === pick.entries[0].controller &&
      e.lki.defId === pick.entries[0].lki.defId &&
      JSON.stringify(e.ability) === JSON.stringify(pick.entries[0].ability),
  );
  if (pick.entries.length === 1 || same || s.cfg.autoOrder[pick.player]) chosen = pick.entries[0];
  else {
    const id = ask<number>(c, {
      player: pick.player,
      why: 'pickNext',
      input: {
        shape: 'order',
        candidates: pick.entries.map((e) => e.id),
        labels: pick.entries.map((e) => entryLabel(c, e)),
      },
      source: null,
      prompt: '次に解決する能力を選んでください',
    });
    chosen = pick.entries.find((e) => e.id === id) ?? pick.entries[0];
  }
  s.pool.splice(s.pool.indexOf(chosen), 1);
  resolveEntry(c, chosen);
}

export function entryLabel(c: Ctx, e: PoolEntry): string {
  const name = c.reg.defs[e.lki.defId]?.name ?? '?';
  if (e.kind === 'shieldTrigger') return `${name}(S・トリガー)`;
  if (e.kind === 'gStrike') return `${name}(G・ストライク)`;
  const a = e.ability ? c.reg.ability(e.ability) : null;
  const lab = a && 'label' in a && a.label ? a.label : a && a.kind === 'trigger' ? triggerLabel(a.spec.on) : '能力';
  return `${name}: ${lab}`;
}

function triggerLabel(on: any): string {
  const o = Array.isArray(on) ? on[0] : on;
  const m: Record<string, string> = {
    entered: '出た時',
    evolved: '重なった時',
    attackDeclared: '攻撃する時',
    cast: '呪文を唱えた時',
    stepStart: 'ターン',
    moved: '移動した時',
    battleEnded: 'バトル後',
    abilityTriggered: '能力がトリガーした時',
  };
  return m[o.type] ?? o.type;
}

/** 待機していた能力を解決するフレームを積む */
function resolveEntry(c: Ctx, e: PoolEntry): void {
  const s = c.s;
  const card = s.cards[e.source.uid];
  // 条件を持つ誘発型能力は、解決の時点で条件を満たしていれば解決される(総合ルール 603.4。
  // 誘発した時点で満たしているかは問わない)。満たさなければ、何も起こさず(ログにも出さず)終える
  if (e.kind === 'ability' && e.ability) {
    const a0 = c.reg.ability(e.ability);
    if (a0.kind === 'trigger' && (a0.spec.if || a0.spec.ifAtResolve)) {
      const cc0 = { ...mkCC(c, e.controller, { self: e.source.uid, selfSnap: e.lki, event: e.event }), it: e.event?.card ?? null, itFace: -1 };
      if (a0.spec.if && !evalCond(cc0, a0.spec.if)) return;
      if (a0.spec.ifAtResolve && !evalCond(cc0, a0.spec.ifAtResolve)) return;
    }
  }
  const prevCause = c.cause;
  c.cause = e.event?.id ?? null;
  const logged = emit(c, 'resolve', {
    source: e.source.uid,
    controller: e.controller,
    kind: e.kind,
    label: entryLabel(c, e),
  });
  c.cause = prevCause;
  if (e.kind === 'shieldTrigger') {
    // 宣言されたS・トリガーを使う(コストを支払わない)
    if (card.ep !== e.source.ep || card.zone !== 'hand') return;
    const d = declaration(c, e.source.uid);
    const face = e.ability ? e.ability.face : d ? d.face : 0;
    s.cont.push({
      kind: 'proc',
      id: nextId(s),
      causedBy: logged.id,
      name: 'play',
      stage: 0,
      vars: { uid: e.source.uid, ep: card.ep, from: 'hand', face, free: true, after: null },
    });
    return;
  }
  const ability = e.ability!;
  const a = c.reg.ability(ability);
  void a;
  s.cont.push({
    kind: 'effect',
    id: logged.id,
    causedBy: e.event?.id ?? null,
    ability,
    source: e.source,
    lki: e.lki,
    controller: e.controller,
    pc: 0,
    vars: {},
    trigger: e.event,
  });
}

// ───────────────────────── 状況起因処理 ─────────────────────────

/** 1つの変更を行ったら true を返す(呼び出し側は再度チェックする)。 */
export function runSba(c: Ctx): boolean {
  const s = c.s;
  if (!s.dirtySba) return false;
  if (s.winner !== null) return false;
  // 山札が0枚のプレイヤーは敗北(104.2b)
  // 山札が0枚の敗北は、0枚になった出来事に対して1回(置換された後は、山札が増えるまで再度は起きない)
  for (const p of [0, 1] as PlayerId[]) if (s.players[p].deck.length > 0) delete s.usage['deckOutHandled' + p];
  const losers = ([0, 1] as PlayerId[]).filter(
    (p) => s.players[p].deck.length === 0 && s.turn >= 1 && !(s.cfg.solitaire && p === 1) && !s.usage['deckOutHandled' + p],
  );
  if (losers.length) {
    for (const p of losers) {
      const sacrifice = lossReplacement(c, p);
      if (sacrifice) return true;
    }
    if (losers.length === 2) s.winner = 'draw';
    else s.winner = opponentOf(losers[0]);
    s.loseReason = '山札切れ';
    emit(c, 'gameOver', { winner: s.winner, reason: '山札切れ' });
    return true;
  }
  // パワー0以下のクリーチャーは破壊される(108.1b)
  const dead: number[] = [];
  for (const p of [0, 1] as PlayerId[]) {
    for (const perm of s.players[p].battle) if (powerOf(c, perm) <= 0) dead.push(perm.cards[0]);
  }
  if (dead.length) {
    moveCards(c, dead, { to: 'grave', cause: 'destroy' });
    return true;
  }
  // S-MAX進化クリーチャーが2体以上いる場合、1体を残して手札に戻す
  for (const p of [0, 1] as PlayerId[]) {
    const smax = s.players[p].battle.filter((perm) => charsOf(c, perm.cards[0], -1).type === 'smaxEvolution').map((x) => x.cards[0]);
    if (smax.length >= 2) {
      const keep = ask<number[]>(c, {
        player: p,
        why: 'keepOne',
        input: { shape: 'pick', candidates: smax, min: 1, max: 1 },
        source: null,
        prompt: 'S-MAX進化クリーチャーは1体だけ残せます。残す1体を選んでください',
      });
      const bounce = smax.filter((u) => u !== keep[0]);
      moveCards(c, bounce, { to: 'hand', cause: 'bounce' });
      return true;
    }
  }
  s.dirtySba = false;
  return false;
}

/** 「ゲームに負ける時、かわりに〜してもよい」(ジャオウガ)。置換したら true */
function lossReplacement(c: Ctx, p: PlayerId): boolean {
  const s = c.s;
  const key = `deckOutHandled${p}`;
  for (const perm of s.players[p].battle) {
    const uid = perm.cards[0];
    const info = infoOf(c, uid);
    for (const r of info.replaces) {
      if (r.ability.apply.type !== 'smaxSacrifice' || r.ability.match.type !== 'gameLoss') continue;
      const faceUp: number[] = [];
      for (const q of s.players[p].battle) if (q.cards[0] !== uid) faceUp.push(q.cards[0]);
      for (const u of s.players[p].mana) faceUp.push(u);
      if (faceUp.length < 3) continue;
      const use = ask<number[]>(c, {
        player: p,
        why: 'replaceChoice',
        input: { shape: 'option', options: ['かわりに表向きのカード3枚を破壊する', '置換しない'], pick: 1, repeat: false, allIf: false },
        source: { uid, ep: s.cards[uid].ep },
        prompt: `${c.reg.defs[s.cards[uid].defId].name}: ゲームに負ける時、かわりに表向きのカード3枚を破壊してもよい`,
      });
      if (use[0] !== 0) return false;
      // 価値の低いカード(マナ・コストの小さいもの)から3枚
      const scored = faceUp
        .map((u) => ({ u, v: (s.cards[u].zone === 'battle' ? 100 : 0) + charsOf(c, u, -1).cost }))
        .sort((a, b) => a.v - b.v)
        .slice(0, 3)
        .map((x) => x.u);
      s.usage[key] = 1;
      moveCards(c, scored, { to: 'grave', cause: 'destroy', noReplace: true });
      return true;
    }
  }
  return false;
}

// ───────────────────────── ディスパッチ ─────────────────────────

export function runProc(c: Ctx, f: ProcFrame): void {
  switch (f.name) {
    case 'turn':
      return runTurn(c, f);
    case 'play':
      return runPlay(c, f);
    case 'attack':
      return runAttack(c, f);
    case 'break':
      return runBreak(c, f);
    case 'settle':
      return runSettle(c, f);
    default:
      throw new Error('未知の手続き: ' + f.name);
  }
}

export { hasKeyword, canAttack };
