// 手続きフレーム: ターン進行・プレイ・攻撃・シールドブレイク・チェックポイント・状況起因処理
// (effects 5, 9, 10)。各ステージは「質問 → 変更」の順で書き、再実行しても二重に変更されない。
import type { Ability, Pattern } from './ast';
import { evalCond, mkCC } from './cond';
import {
  activeStatics,
  breakerCount,
  canAttack,
  canBlock,
  cannotLeave,
  canGuard,
  hasSelfStatic,
  canPlayCard,
  canCast,
  canSummon,
  canUseCost,
  costBase,
  grantedPlayFrom,
  grantsRush,
  costOf,
  faceTypeOf,
  hasKeyword,
  infoOf,
  isAttacking,
  isUnblockable,
  playerCannotLose,
  manaSources,
  sourceCivs,
  mustBlock,
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
  listens,
  moveCards,
  onSummoned,
  setTapped,
  smaxVictims,
  stabIntoDeck,
} from './ops';
import type { Ctx } from './state';
import { gameHas, nextId, opponentOf, permByPid, rngInt, snapOf } from './state';
import type {
  AbilityRef,
  Civ,
  EffectFrame,
  Ev,
  PlayExtra,
  Permanent,
  PlayerId,
  PoolEntry,
  ProcFrame,
  ProcName,
  ZoneName,
} from './types';
import { isCreatureType } from './types';

// ───────────────────────── フレームの積み方 ─────────────────────────

export function pushProc(c: Ctx, name: ProcName, vars: Record<string, unknown> = {}): ProcFrame {
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
  kind: 'summon' | 'cast' | 'put';
  cost: number;
  need: number;
  civs: Civ[];
  pay: number[];
  after: 'deckBottom' | null;
  taps: number[];
  onto?: number;
  /** 別のコストで捨てる手札 */
  discard?: number[];
  alt?: string;
  /** 使った「各ターンに1度」のコスト軽減の発生源 */
  once?: number[];
  /** 他のカードの許可(allowPlayFrom)で使う時の、その発生源 */
  grant?: number;
  /** 別のコストでタップする自分のクリーチャーの山 */
  tapAlt?: number[];
  /** アビスラッシュで召喚する(墓地から) */
  rush?: boolean;
  /** 超無限墓地進化で、下に重ねるカード */
  under?: number[];
  /** フシギバースで、マナゾーンに置くクリーチャー */
  toMana?: number[];
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
  const kind = face.type === 'spell' ? 'cast' : isCreatureType(face.type) ? 'summon' : 'put';
  let after: 'deckBottom' | null = null;
  let grantSrc: number | null = null;
  let rush = false;
  const altAb = extra?.alt !== undefined ? info.altCosts.find((a) => a.id === extra.alt) : undefined;
  if (from !== 'hand' && !free) {
    const perm = info.permissions.find((p) => p.from === from && p.play === kind);
    // 別のコストで、そのゾーンから使える(ムゲンクライムなど)
    if (!perm && altAb?.cost.from?.includes(from)) {
      after = null;
    } else if (!perm) {
      // 他のカードの「自分のターン中、〜を from から召喚してもよい」
      grantSrc = kind === 'summon' ? grantedPlayFrom(c, player, uid, faceIdx, from) : null;
      if (grantSrc === null) return fail('そのゾーンからはプレイできません');
      rush = grantsRush(c, grantSrc);
    } else {
      after = perm.after ?? null;
      rush = !!perm.rush;
    }
  } else if (from !== 'hand' && free) {
    const perm = info.permissions.find((p) => p.from === from && p.play === kind);
    after = perm?.after ?? null;
    rush = !!perm?.rush;
  }
  if (kind === 'cast' && !canCast(c, player, uid, faceIdx)) return fail('この呪文は唱えられません');
  if (kind === 'summon' && !canSummon(c, player, uid, faceIdx)) return fail('このクリーチャーは召喚できません');
  if (!canUseCost(c, player, face.cost)) return fail('そのコストのカードは実行できません');
  if (!canPlayCard(c, player, uid, faceIdx)) return fail('そのカードは使えません');

  let onto: number | undefined;
  if (face.type === 'evolution' && !altAb?.cost.graveEvolve) {
    const pm = extra?.onto !== undefined ? permByPid(s, extra.onto) : null;
    if (!pm || pm.owner !== player) return fail('進化元を選んでください');
    const topUid = pm.perm.cards[0];
    const cc = mkCC(c, player, { self: uid, it: topUid, itFace: s.cards[topUid].face, evo: true });
    if (!face.evolveFrom || !evalCond(cc, face.evolveFrom)) return fail('進化元の条件を満たしていません');
    onto = pm.perm.pid;
  } else if (extra?.onto !== undefined) return fail('進化クリーチャーではありません');

  // 別のコスト(マナを払うかわりに、手札を捨てる・マナを払わない)
  let freeAlt = false;
  let reduceAlt = 0;
  let tapAlt: number[] | undefined;
  let graveUnder: number[] | undefined;
  let toMana: number[] | undefined;
  let payAlt: number | undefined;
  let discard: number[] | undefined;
  if (extra?.alt !== undefined) {
    const ab = info.altCosts.find((a) => a.id === extra.alt);
    if (!ab) return fail('その別のコストはありません');
    if (from !== (ab.cost.from?.[0] ?? 'hand') && !(ab.cost.from ?? ['hand']).includes(from)) return fail('そのゾーンから使う別のコストではありません');
    if (ab.when && !evalCond(mkCC(c, player, { self: uid }), ab.when)) return fail('別のコストを使える条件を満たしていません');
    freeAlt = ab.cost.reduce === undefined && ab.cost.pay === undefined && !ab.cost.graveEvolve && !ab.cost.fushigi; // 別のコストは、マナを払うかわりのコスト(reduce は軽減、pay はコストのかわりに払う。墓地進化・フシギバースは、コストを払う)
    reduceAlt = ab.cost.reduce ?? 0;
    if (ab.cost.tapCreatures) {
      const n = ab.cost.tapCreatures;
      const cands = s.players[player].battle.filter((p) => !p.tapped && isCreatureType(faceTypeOf(c, p.cards[0]))).map((p) => p.pid);
      if (extra.tapAlt?.length) {
        if (extra.tapAlt.length !== n || new Set(extra.tapAlt).size !== n || !extra.tapAlt.every((p) => cands.includes(p))) return fail('タップするクリーチャーが条件に合いません');
        tapAlt = extra.tapAlt.slice();
      } else {
        if (cands.length < n) return fail('タップできるクリーチャーが足りません');
        tapAlt = cands.slice(0, n);
      }
    }
    if (ab.cost.pay !== undefined) payAlt = ab.cost.pay;
    if (ab.cost.graveEvolve) {
      // 超無限墓地進化: 墓地のクリーチャーを1体以上選んで、その上に重ねて出す。選んだ数だけコストを少なくする(1未満にならない)
      const under = (extra.under ?? []).slice();
      const ok = under.length > 0 && new Set(under).size === under.length && under.every((u) => s.cards[u]?.zone === 'grave' && s.cards[u].owner === player && isCreatureType(faceTypeOf(c, u)));
      if (!ok) return fail('墓地から重ねるクリーチャーを選んでください');
      graveUnder = under;
      reduceAlt = under.length;
    }
    if (ab.cost.fushigi) {
      // フシギバース: 自分のクリーチャーを1体タップしてマナゾーンに置き、基準のコストからそのコストを引いた数を支払う
      const pid = extra.tapAlt?.[0];
      const pm = pid !== undefined ? permByPid(s, pid) : null;
      if (!pm || pm.owner !== player || pm.perm.tapped || !isCreatureType(faceTypeOf(c, pm.perm.cards[0]))) return fail('マナゾーンに置く、アンタップしている自分のクリーチャーを選んでください');
      payAlt = Math.max(ab.cost.fushigi.min, ab.cost.fushigi.base - costBase(c, pm.perm.cards[0]));
      toMana = [pm.perm.cards[0]];
      tapAlt = undefined;
    }
    if (ab.cost.discard) {
      const d = ab.cost.discard;
      const ccd = mkCC(c, player, { self: uid });
      const cands = s.players[player].hand.filter((u) => u !== uid && (!d.where || evalCond({ ...ccd, it: u, itFace: -1 }, d.where)));
      if (extra.discard?.length) {
        if (extra.discard.length !== d.n || new Set(extra.discard).size !== d.n || !extra.discard.every((u) => cands.includes(u))) return fail('捨てる手札が条件に合いません');
        discard = extra.discard.slice();
      } else {
        if (cands.length < d.n) return fail('捨てる手札が足りません');
        discard = cands.slice(0, d.n);
      }
    }
  } else if (extra?.discard?.length) return fail('別のコストを選んでいません');
  if (freeAlt) free = true;

  const taps = extra?.tap ?? [];
  if (taps.length) {
    if (!info.hyperEnergy) return fail('ハイパーエナジーを持ちません');
    const seen = new Set<number>();
    for (const pid of taps) {
      const pm = permByPid(s, pid);
      if (!pm || pm.owner !== player || pm.perm.tapped) return fail('タップできないクリーチャーです');
      const cost = costBase(c, pm.perm.cards[0]);
      if (seen.has(cost)) return fail('コストが互いに異なるクリーチャーを選んでください');
      seen.add(cost);
    }
  }
  const once: number[] = [];
  const cost = payAlt !== undefined ? payAlt : Math.max(graveUnder ? 1 : 0, costOf(c, uid, faceIdx, { taps, free, once }) - reduceAlt);
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
        if (!mc || mc.owner !== player || u === uid || !manaSources(c, player).includes(u)) return fail('そのマナは使えません');
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
  return { ok: true, face: faceIdx, kind, cost, need, civs, pay, after, taps, onto, ...(discard ? { discard } : {}), ...(extra?.alt !== undefined ? { alt: extra.alt } : {}), ...(once.length ? { once } : {}), ...(grantSrc !== null ? { grant: grantSrc } : {}), ...(tapAlt ? { tapAlt } : {}), ...(rush ? { rush: true } : {}), ...(graveUnder ? { under: graveUnder } : {}), ...(toMana ? { toMana } : {}) };
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
  const avail = manaSources(c, player, [uid]);
  const groups = new Map<string, number[]>();
  for (const u of avail) {
    const key = sourceCivs(c, u).slice().sort().join(',');
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
  const cs = mana.map((u) => sourceCivs(c, u));
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
      // 「相手のターンのはじめに、相手はマナゾーンのカードを n 枚までしかアンタップできない」(卍月 ガ・リュザーク 卍)
      const limits = activeStatics(c, 'untapLimit').filter((st) => st.controller !== P);
      let untapLeft = limits.length ? Math.min(...limits.map((st) => (st.ability.mod.type === 'untapLimit' ? st.ability.mod.n : 99))) : Infinity;
      // 「次のターンのはじめに、アンタップしない」(noUntap)
      const noUntapPids = new Set<number>();
      const noUntapUids = new Set<number>();
      for (const e of s.effects) {
        if (e.mod.kind !== 'noUntap' || e.until.kind !== 'untilTurnStart' || e.until.player !== P) continue;
        for (const p of e.mod.pids) noUntapPids.add(p);
        for (const u of e.mod.uids) noUntapUids.add(u);
      }
      for (const u of s.players[P].mana) {
        if (!s.cards[u].tapped || noUntapUids.has(u)) continue;
        if (untapLeft > 0) {
          s.cards[u].tapped = false;
          untapLeft--;
        }
      }
      for (const perm of s.players[P].battle) {
        if (!noUntapPids.has(perm.pid)) perm.tapped = false;
        perm.sick = false;
        delete perm.hyper; // ハイパーモードは、次の自分のターンのはじめまで
      }
      // 「次の自分のターンのはじめまで」の期限切れ(逆転撃の支払い(owe)は、支払いの段階で消す)
      s.effects = s.effects.filter((e) => !(e.until.kind === 'untilTurnStart' && e.until.player === P && s.turn > e.until.afterTurn && e.mod.kind !== 'owe' && e.mod.kind !== 'startShield'));
      emit(c, 'stepStart', { step: 'start', player: P });
      s.batchNo++;
      collectBatch(c, [c.out[c.out.length - 1]]);
      f.stage = s.effects.some((e) => (e.mod.kind === 'owe' || e.mod.kind === 'startShield') && e.controller === P) ? 5 : 1;
      pushProc(c, 'settle');
      return;
    }
    case 5: {
      // 逆転撃: 次の自分のターンのはじめに、マナを支払う。払えなければ、ゲームに負ける。1回に1つずつ処理する
      const e = s.effects.find((x) => (x.mod.kind === 'owe' || x.mod.kind === 'startShield') && x.controller === P);
      if (!e) {
        f.stage = 1;
        return;
      }
      if (e.mod.kind === 'startShield') {
        // 次の自分のターンのはじめに、自分のシールドを1つ手札に加える(「S・トリガー」は使えない)。質問は、状態を変更する前に行う
        const shields = s.players[P].shield;
        if (shields.length === 0) {
          s.effects = s.effects.filter((x) => x.id !== e.id);
          return;
        }
        const pick =
          shields.length === 1
            ? [shields[0]]
            : ask<number[]>(c, {
                player: P,
                why: 'select',
                input: { shape: 'pick', candidates: shields.slice(), min: 1, max: 1 },
                source: null,
                prompt: '手札に加える自分のシールドを選んでください(「S・トリガー」は使えない)',
              });
        s.effects = s.effects.filter((x) => x.id !== e.id);
        moveCards(c, pick, { to: 'hand', cause: 'effect' });
        pushProc(c, 'settle');
        return;
      }
      if (e.mod.kind !== 'owe') {
        f.stage = 1;
        return;
      }
      const plan = planPayment(c, P, [e.mod.civ], e.mod.n);
      if (!plan) {
        // 払えない: 負ける(「ゲームに負ける時」の置換があれば使える)。質問は、状態を変更する前に行う
        if (lossReplacement(c, P, false)) {
          s.effects = s.effects.filter((x) => x.id !== e.id);
          return;
        }
        s.effects = s.effects.filter((x) => x.id !== e.id);
        s.winner = opponentOf(P);
        s.loseReason = '逆転撃の支払い不能';
        emit(c, 'gameOver', { winner: s.winner, reason: '逆転撃の支払い不能' });
        return;
      }
      for (const u of plan) setTapped(c, u, true);
      s.effects = s.effects.filter((x) => x.id !== e.id);
      emit(c, 'paidDebt', { owner: P, n: plan.length });
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
      f.stage = 6;
      pushProc(c, 'settle');
      return;
    }
    case 6: {
      // アビスラッシュ・J・O・E: ターンの終わりに山札の下に置く(置換の質問が出ることがあるので、1体ずつ別の段階で行う)
      const done: number[] = (f.vars.bottomDone ??= []);
      const perm = s.players[P].battle.find((x) => {
        if (done.includes(x.pid)) return false;
        if (x.rush === s.turn) return !(x.rushIfAttacked && !s.turnLog.some((e) => e.type === 'attackDeclared' && e.attacker === x.pid));
        return x.endBottom === s.turn;
      });
      if (!perm) {
        f.stage = 4;
        return;
      }
      const moved = moveCards(c, [perm.cards[0]], { to: 'deck', cause: 'effect', pos: 'bottom' });
      done.push(perm.pid);
      // J・O・E: 山札の下に置いたら、カードを1枚引く
      if (perm.endBottom === s.turn && moved.some((r) => r.moved)) drawCards(c, P, 1);
      pushProc(c, 'settle');
      return;
    }
    case 4: {
      s.effects = s.effects.filter(
        (e) =>
          !(e.until.kind === 'endOfTurn' && e.until.turn <= s.turn) &&
          !(e.until.kind === 'untilOppTurnEnd' && s.turn > e.until.afterTurn && P !== e.until.player),
      );
      s.turn += 1;
      // 「このターンの後に自分のターンを追加する」: 追加のターンの後は、本来の順番に戻る
      const normal = s.resume ?? opponentOf(P);
      const extra = s.extraTurns?.shift();
      if (extra !== undefined) {
        s.resume = normal;
        s.active = extra;
      } else {
        s.resume = undefined;
        s.active = normal;
      }
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
        if (v.free || v.soft) {
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
      // 別のコスト: 手札を捨てる・クリーチャーをタップする
      for (const pid of plan.tapAlt ?? []) {
        const pm = permByPid(s, pid);
        if (pm) setTapped(c, pm.perm.cards[0], true);
      }
      if (plan.discard?.length) moveCards(c, plan.discard, { to: 'grave', cause: 'discard' });
      // プレイ中として処理する(場所は limbo)
      const prevZone = card.zone;
      removeFrom(c, uid);
      card.zone = 'limbo';
      card.ep++;
      card.face = plan.face;
      s.limbo.push(uid);
      for (const src of plan.once ?? []) s.usage['cd:' + src] = s.turn;
      if (plan.grant !== undefined) s.usage['gp:' + plan.grant] = s.turn;
      v.plan = { kind: plan.kind, paid: plan.pay.length, cost: plan.cost, after: plan.after, onto: plan.onto ?? null, face: plan.face, free: !!v.free, alt: plan.alt ?? null, rush: !!plan.rush, under: plan.under ?? null };
      v.fromZone = prevZone;
      // フシギバース: タップしたクリーチャーを、マナゾーンに置く(離れる時の置換の質問が出ることがあるので、別の段階で行う)
      v.toMana = plan.toMana ?? null;
      f.stage = plan.toMana?.length ? 4 : 1;
      return;
    }
    case 4: {
      moveCards(c, (v.toMana as number[] | null) ?? [], { to: 'mana', cause: 'manaPlace', tapped: true });
      v.toMana = null;
      f.stage = 1;
      return;
    }
    case 1: {
      const p = v.plan;
      const card = s.cards[uid];
      const owner = card.owner;
      // パンドラ・シフト: 出すかわりに、超次元ゾーンに置く
      if (p.kind === 'summon' && p.alt && c.reg.getInfo(card.defId, p.face).altCosts.some((a) => a.id === p.alt && a.cost.toHyper)) {
        moveCards(c, [uid], { to: 'hyper', cause: 'pandora', noReplace: true });
        f.stage = 3;
        return;
      }
      if (p.kind === 'summon' || p.kind === 'put') {
        const evs: Ev[] = [];
        const via = p.kind === 'summon' ? 'summon' : 'put';
        enterBattle(c, uid, { to: 'battle', cause: via, via, onto: p.onto ?? undefined, face: p.face, paid: p.paid, cost: p.cost, free: p.free, from: v.fromZone, ...(p.under?.length ? { under: p.under } : {}) }, evs);
        if (p.kind === 'summon' && s.cards[uid].zone === 'battle') onSummoned(c, uid);
        // J・O・E: このターンの終わりに山札の下に置き、カードを1枚引く
        if (p.alt && s.cards[uid].zone === 'battle' && c.reg.getInfo(card.defId, p.face).altCosts.some((a) => a.id === p.alt && a.cost.endBottomDraw)) {
          const pm = permByPid(s, s.cards[uid].pid);
          if (pm) pm.perm.endBottom = s.turn;
        }
        // アビスラッシュ
        if (p.rush && s.cards[uid].zone === 'battle') {
          const pm = permByPid(s, s.cards[uid].pid);
          if (pm) pm.perm.rush = s.turn;
        }
        // 別のコストを使って出た印(そのターンだけ。altUsed の条件で調べる)
        if (p.alt && s.cards[uid].zone === 'battle') s.usage['alt:' + uid + ':' + p.alt] = s.turn;
        // S・トリガーとして使って出た印(S・トリガー・プラスのP能力の条件。イベントの内容は変えない)
        if (v.st) {
          const ent = evs.find((e) => e.type === 'entered' && e.card === uid);
          if (ent) s.usage['st:' + uid] = ent.id;
        }
        s.batchNo++;
        collectBatch(c, evs);
        s.dirtySba = true;
        f.stage = 3;
        return;
      }
      emit(c, 'cast', { card: uid, owner, free: p.free, paid: p.paid, cost: p.cost, face: p.face, from: v.fromZone });
      const ev = c.out[c.out.length - 1];
      if (v.st) s.usage['st:' + uid] = ev.id; // S・トリガーとして唱えた印
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
      if (card.zone === 'limbo' && gameHas(c, 'afterCast') && v.after !== 'hyper' && afterCastReplacement(c, uid, p.face)) {
        // 唱え終わった呪文を、墓地のかわりに別の手順で動かす(フィールドの下に置く、など)
        f.stage = 3;
        return;
      }
      if (card.zone === 'limbo') {
        if (v.after === 'hyper') {
          // インターステラ: 墓地(や山札の下)のかわりに超次元ゾーンに置く。呪文自身の置換と重なる時は超次元ゾーンを選ぶ
          moveCards(c, [uid], { to: 'hyper', cause: 'castHyper', noReplace: true });
        } else if (p.after === 'deckBottom' || v.after === 'deckBottom' || (v.fromZone === 'grave' && graveCastGoesBottom(c, card.owner))) {
          moveCards(c, [uid], { to: 'deck', cause: 'castBottom', pos: 'bottom', noReplace: true });
        } else {
          // 呪文自身の効果が、自身の移動を置換する(チャージャーなど)。他の置換効果より優先する(総合ルール 409.2b / 609.8a)。
          // 質問は、状態を変更する前に行う
          const info = c.reg.getInfo(card.defId, p.face);
          let dest: ZoneName | null = null;
          for (const r of info.replaces) {
            const a = r.ability;
            if (a.apply.type !== 'changeDest' || a.match.type !== 'moved' || a.match.cause !== 'cast') continue;
            if (a.while && !evalCond(mkCC(c, card.owner, { self: uid }), a.while)) continue;
            if (a.optional) {
              const yes = ask<boolean>(c, {
                player: card.owner,
                why: 'may',
                input: { shape: 'yesno' },
                source: { uid, ep: card.ep },
                prompt: `${c.reg.defs[card.defId].name}: ${a.label ?? '墓地に置くかわりに置き換えますか?'}`,
              });
              if (!yes) continue;
            }
            dest = a.apply.to;
            break;
          }
          if (dest) moveCards(c, [uid], { to: dest, cause: 'replaced', noReplace: true });
          else moveCards(c, [uid], { to: 'grave', cause: 'cast', noReplace: true });
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

/**
 * 唱え終わった呪文に当てはまる「かわりに〜する」(match.type = 'afterCast')を探し、あれば、その手順を行う効果を積んで true を返す。
 * 持つのはバトルゾーンの、能力を無視されていないカード(複数あれば、先頭のもの)。
 */
function afterCastReplacement(c: Ctx, uid: number, faceIdx: number): boolean {
  const s = c.s;
  const card = s.cards[uid];
  for (const p of [0, 1] as PlayerId[]) {
    for (const perm of s.players[p].battle) {
      const src = perm.cards[0];
      const info = infoOf(c, src);
      for (const r of info.replaces) {
        const a = r.ability;
        if (a.match.type !== 'afterCast' || a.apply.type !== 'steps') continue;
        const m = a.match;
        if (m.owner !== undefined && m.owner !== 'any' && (m.owner === 'self' ? card.owner !== p : card.owner === p)) continue;
        if (a.while && !evalCond(mkCC(c, p, { self: src }), a.while)) continue;
        if (m.cond && !evalCond(mkCC(c, p, { self: src, it: uid, itFace: faceIdx }), m.cond)) continue;
        const sc = s.cards[src];
        const ev: Ev = { id: nextId(s), causedBy: null, type: 'afterCast', turn: s.turn, card: uid, owner: card.owner };
        s.cont.push({
          kind: 'effect',
          id: nextId(s),
          causedBy: c.cause,
          ability: { defId: sc.defId, face: sc.face, idx: r.idx },
          source: { uid: src, ep: sc.ep },
          lki: snapOf(c, src),
          controller: p,
          pc: 0,
          vars: {},
          trigger: ev,
          noOptional: true,
        });
        return true;
      }
    }
  }
  return false;
}

/** 自分の墓地から呪文を唱えた後、墓地のかわりに山札の下に置くか(サイクルペディア) */
function graveCastGoesBottom(c: Ctx, owner: PlayerId): boolean {
  return activeStatics(c, 'graveCastToBottom').some((st) => st.controller === owner);
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

// ───────────────────────── バトル ─────────────────────────

type PermRef = NonNullable<ReturnType<typeof permByPid>>;

/** 「バトルする時」の誘発を発行する(聞き手のいるカードがある時だけ。段階を増やさず、既存の対戦の記録を変えない) */
function emitBattleStarted(c: Ctx, pm: PermRef, dm: PermRef): void {
  if (!listens(c, 'battleStarted')) return;
  const evb = emit(c, 'battleStarted', {
    attacker: pm.perm.pid,
    defender: dm.perm.pid,
    attackerCard: pm.perm.cards[0],
    defenderCard: dm.perm.cards[0],
    owner: pm.owner,
  });
  c.s.batchNo++;
  collectBatch(c, [evb]);
  pushProc(c, 'settle');
}

/** パワーを比べて、負けた方(同じなら両方)を破壊する。スレイヤーも処理する。「バトルの後」に使う当事者の情報を返す */
function resolveBattleCore(c: Ctx, pm: PermRef, dm: PermRef) {
  const s = c.s;
  let pa = powerOf(c, pm.perm);
  let pd = powerOf(c, dm.perm);
  const aTop = pm.perm.cards[0];
  const dTop = dm.perm.cards[0];
  // 各ターン、はじめて自分のクリーチャーがバトルする時、そのクリーチャーはそのバトルに勝つ(輝く革命 ボルシャック・フレア)
  if (gameHas(c, 'firstBattleWins')) {
    const aw = firstBattleWinsFor(c, pm.owner);
    const dw = firstBattleWinsFor(c, dm.owner);
    if (aw && !dw) pa = Infinity;
    else if (dw && !aw) pd = Infinity;
  }
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
  return { attacker: aPid, defender: dPid, attackerCard: aTop, defenderCard: dTop, owner: aOwner };
}

/** そのプレイヤーの「各ターン、はじめてバトルするクリーチャーが勝つ」を、いま使えるか(使えるなら、使ったと記録する) */
function firstBattleWinsFor(c: Ctx, owner: PlayerId): boolean {
  const s = c.s;
  const key = 'fbw:' + owner;
  if (s.usage[key] === s.turn) return false;
  if (!activeStatics(c, 'firstBattleWins').some((st) => st.controller === owner)) return false;
  s.usage[key] = s.turn;
  return true;
}

/** 効果によるバトル(「その2体をバトルさせる」)。vars: a, d = 山の pid(a が攻撃側扱い) */
/** バトルの当事者を、「かわりにこのクリーチャーにバトルさせてもよい」(battleProxy)で置き換える。置き換えなければ、そのまま返す */
function battleProxySwap(c: Ctx, pma: { perm: Permanent; owner: PlayerId }, pmd: { perm: Permanent; owner: PlayerId }): { a: { perm: Permanent; owner: PlayerId }; d: { perm: Permanent; owner: PlayerId } } {
  const s = c.s;
  if (!gameHas(c, 'battleProxy')) return { a: pma, d: pmd };
  const swap = (side: { perm: Permanent; owner: PlayerId }): { perm: Permanent; owner: PlayerId } => {
    const owner = side.owner;
    const cands = s.players[owner].battle.filter((x) => {
      if (x === side.perm || x === pma.perm || x === pmd.perm) return false;
      return infoOf(c, x.cards[0]).statics.some(
        (st) =>
          st.ability.mod.type === 'battleProxy' &&
          (!st.ability.while || evalCond(mkCC(c, owner, { self: x.cards[0] }), st.ability.while)) &&
          evalCond(mkCC(c, owner, { self: x.cards[0], it: side.perm.cards[0], itFace: s.cards[side.perm.cards[0]].face }), st.ability.mod.cond),
      );
    });
    if (cands.length === 0) return side;
    const ans = ask<number[]>(c, {
      player: owner,
      why: 'may',
      input: { shape: 'pick', candidates: cands.map((x) => x.cards[0]), min: 0, max: 1 },
      source: { uid: cands[0].cards[0], ep: s.cards[cands[0].cards[0]].ep },
      prompt: 'バトルを、かわりにこのクリーチャーにさせますか?(選べば置き換える)',
    });
    if (ans.length === 0) return side;
    return permByPid(s, s.cards[ans[0]].pid)!;
  };
  const a = swap(pma);
  const d = swap(pmd);
  return { a, d };
}

function runBattle(c: Ctx, f: ProcFrame): void {
  const s = c.s;
  const v = f.vars;
  const pma = permByPid(s, v.a);
  const pmd = permByPid(s, v.d);
  switch (f.stage) {
    case 0: {
      if (!pma || !pmd || pma.owner === pmd.owner) {
        popFrame(c, f);
        return;
      }
      // 「自分の他のジャイアントが相手のクリーチャーとバトルする時、かわりにこのクリーチャーにバトルさせてもよい」(銀河竜 ゴルファンタジスタ)
      const swapped = battleProxySwap(c, pma, pmd);
      v.a = swapped.a.perm.pid;
      v.d = swapped.d.perm.pid;
      f.stage = 1;
      emitBattleStarted(c, swapped.a, swapped.d);
      return;
    }
    case 1: {
      // 「バトルする時」の効果の解決で、どちらかが場を離れていれば、バトルは行われない(115.3a)
      if (!pma || !pmd || s.winner !== null) {
        popFrame(c, f);
        return;
      }
      const bi = resolveBattleCore(c, pma, pmd);
      if (listens(c, 'afterBattle')) v.battle = bi;
      f.stage = 2;
      pushProc(c, 'settle');
      return;
    }
    case 2: {
      if (listens(c, 'afterBattle') && v.battle && s.winner === null && !s.skipTurn) {
        const eva = emit(c, 'afterBattle', { ...v.battle });
        s.batchNo++;
        collectBatch(c, [eva]);
        f.stage = 3;
        pushProc(c, 'settle');
        return;
      }
      popFrame(c, f);
      return;
    }
    case 3:
      popFrame(c, f);
      return;
  }
}

// ───────────────────────── 攻撃 ─────────────────────────

/**
 * 攻撃の終わり: 「攻撃の終わりに」の誘発(聞き手がいる時だけ)・「最初の攻撃の終わりにアンタップする」を処理して、攻撃の手続きを終える。
 * ターンが飛ばされる・勝敗が決まった場合は、何も起こさない。
 */
function endAttack(c: Ctx, f: ProcFrame): void {
  const s = c.s;
  const v = f.vars;
  const pm = permByPid(s, v.pid);
  // 攻撃が行われた(攻撃の宣言をした)クリーチャーがいる時だけ
  if (pm && s.winner === null && !s.skipTurn) {
    // 最初の攻撃の終わりにアンタップする効果(調律師ピーカプなど)
    const un = s.effects.find((e) => e.pid === pm.perm.pid && e.mod.kind === 'untapAfterAttack');
    if (un) {
      s.effects = s.effects.filter((e) => e !== un);
      setTapped(c, pm.perm.cards[0], false);
    }
    if (listens(c, 'attackEnded')) {
      // 攻撃中にシールドをブレイクしたか(キリフダッシュの条件)
      let broke = false;
      for (let i = s.turnLog.length - 1; i >= 0; i--) {
        const e = s.turnLog[i];
        if (e.type === 'shieldBroken' && e.by === pm.perm.pid) broke = true;
        if (e.type === 'attackDeclared' && e.attacker === pm.perm.pid) break;
      }
      const ev = emit(c, 'attackEnded', { card: pm.perm.cards[0], attacker: pm.perm.pid, owner: pm.owner, broke });
      s.batchNo++;
      collectBatch(c, [ev]);
    }
  }
  // G・ブレイカー: その攻撃の後、自分のシールドをすべてブレイクする
  if (pm && s.winner === null && !s.skipTurn && s.players[pm.owner].shield.length > 0 && breakerCount(c, pm.perm) >= 99) {
    popFrame(c, f);
    s.cont.push({ kind: 'proc', id: nextId(s), causedBy: c.cause, name: 'break', stage: 0, vars: { pid: pm.perm.pid, owner: opponentOf(pm.owner), n: s.players[pm.owner].shield.length } });
    return;
  }
  popFrame(c, f);
}

function runAttack(c: Ctx, f: ProcFrame): void {
  const s = c.s;
  const v = f.vars;
  switch (f.stage) {
    case 0: {
      const pm = permByPid(s, v.pid);
      if (!pm) {
        endAttack(c, f);
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
        endAttack(c, f);
        return;
      }
      const pm = permByPid(s, v.pid);
      if (!pm) {
        endAttack(c, f);
        return;
      }
      const target = v.target as { kind: 'player' } | { kind: 'creature'; pid: number };
      if (target.kind === 'creature' && !permByPid(s, target.pid)) {
        endAttack(c, f); // 攻撃先が場を離れた → 攻撃は終了
        return;
      }
      const defender = opponentOf(pm.owner);
      // 攻撃されているクリーチャー自身は、ブロッカーとして選べない(総合ルール 507.1a)
      const attacked = v.target.kind === 'creature' ? v.target.pid : -1;
      const cands = isUnblockable(c, pm.perm)
        ? []
        : s.players[defender].battle
            .filter((p) => p.pid !== attacked && (canBlock(c, p) || (attacked !== -1 && canGuard(c, p))))
            // 飛行: 飛行を持つクリーチャーは、飛行を持たないクリーチャーにブロックされない
            .filter((p) => !(gameHas(c, 'flying') && hasSelfStatic(c, pm.perm.cards[0], 'flying') && !hasSelfStatic(c, p.cards[0], 'flying')))
            .map((p) => p.cards[0]);
      // ブロッカーは、複数体を同時に選べる(507.1a / 507.2)。ブロックを強制する効果を受けているものは、必ず選ぶ(507.1b)。
      // 選んだ全員がタップし、最後に解決した1体だけが、攻撃先を変更してブロッククリーチャーになる(507.2a)
      const forced = cands.filter((u) => mustBlock(c, permByPid(s, s.cards[u].pid)!.perm));
      let chosen: number[] = [];
      if (forced.length > 0) chosen = forced;
      else if (cands.length > 0) {
        chosen = ask<number[]>(c, {
          player: defender,
          why: 'block',
          input: { shape: 'pick', candidates: cands, min: 0, max: cands.length },
          source: null,
          prompt: 'ブロッカーでブロックしますか?(複数体を選べる。最後に解決する1体がブロックする)',
        });
      }
      let blocker: number | null = null;
      if (chosen.length === 1) blocker = chosen[0];
      else if (chosen.length > 1) {
        const last = ask<number[]>(c, {
          player: defender,
          why: 'block',
          input: { shape: 'pick', candidates: chosen, min: 1, max: 1 },
          source: null,
          prompt: '最後に解決する(ブロックする)ブロッカーを選んでください',
        });
        blocker = last[0];
      }
      if (blocker !== null) {
        const bpm = permByPid(s, s.cards[blocker].pid)!;
        for (const u of chosen) setTapped(c, u, true);
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
        endAttack(c, f);
        return;
      }
      const pm = permByPid(s, v.pid);
      if (!pm) {
        endAttack(c, f);
        return;
      }
      const target = v.target as { kind: 'player' } | { kind: 'creature'; pid: number };
      if (target.kind === 'player') {
        f.stage = 3;
        pushProc(c, 'break', { pid: pm.perm.pid, owner: pm.owner, n: breakerCount(c, pm.perm) });
        return;
      }
      const dm0 = permByPid(s, target.pid);
      if (!dm0) {
        endAttack(c, f);
        return;
      }
      // 「バトルする時」の誘発は、パワーを比べる前に解決する(総合ルール 115.2 / 701.13a)。
      // 聞き手のいるカードがある時だけ、イベントを発行する(段階を増やさず、既存の対戦の記録を変えない)
      const sw = battleProxySwap(c, pm, dm0);
      v.ba = sw.a.perm.pid;
      v.bd = sw.d.perm.pid;
      f.stage = 4;
      emitBattleStarted(c, sw.a, sw.d);
      return;
    }
    case 4: {
      // バトル。「バトルする時」の効果の解決で、どちらかが場を離れていれば、バトルは行われない(115.3a)
      if (s.winner !== null || s.skipTurn) {
        endAttack(c, f);
        return;
      }
      const target = v.target as { kind: 'player' } | { kind: 'creature'; pid: number };
      // バトルの当事者(置き換えられていなければ、攻撃したクリーチャーと攻撃先)
      const pm = permByPid(s, v.ba ?? v.pid);
      const dm = target.kind === 'creature' ? permByPid(s, v.bd ?? target.pid) : null;
      if (!pm || !dm) {
        endAttack(c, f);
        return;
      }
      const bi = resolveBattleCore(c, pm, dm);
      // 「バトルの後」の誘発のために、バトルの当事者を残す(聞き手がいる時だけ)
      if (listens(c, 'afterBattle')) v.battle = bi;
      f.stage = 5;
      pushProc(c, 'settle');
      return;
    }
    case 5: {
      // 「バトルの後」の誘発(総合ルール 701.13d)。勝敗の誘発を解決し終えた後に誘発する
      if (listens(c, 'afterBattle') && v.battle && s.winner === null && !s.skipTurn) {
        const eva = emit(c, 'afterBattle', { ...v.battle });
        s.batchNo++;
        collectBatch(c, [eva]);
        f.stage = 3;
        pushProc(c, 'settle');
        return;
      }
      endAttack(c, f);
      return;
    }
    case 3:
      endAttack(c, f);
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
        // 攻撃先が変更されないまま、シールドが0枚の相手プレイヤーへの攻撃が成立 → 勝利。
        // 負ける側の「ゲームに負ける時、かわりに〜してもよい」(ジャオウガ)を使えるなら、勝敗は決まらず攻撃は終わる
        if (lossReplacement(c, defender, false)) {
          f.stage = 2;
          pushProc(c, 'settle');
          return;
        }
        if (playerCannotLose(c, defender)) {
          popFrame(c, f); // ゲームに負けない効果を受けている: 攻撃は終わる
          return;
        }
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
      // 「ブレイクする前に」の誘発は、ブレイクするシールドを選んだ後、ブレイクする前に解決する(総合ルール 509.3 / 509.4)。
      // 聞き手のいるカードがある時だけ、イベントを発行する(既存の対戦の記録を変えない)
      f.stage = 3;
      if (listens(c, 'beforeBreak')) {
        const evb = emit(c, 'beforeBreak', { attacker: v.pid, owner: attackerOwner, defenderOwner: defender, cards: broken.slice() });
        s.batchNo++;
        collectBatch(c, [evb]);
        pushProc(c, 'settle');
      }
      return;
    }
    case 3: {
      // 「ブレイクする前に」の効果の解決でクリーチャーが場を離れても、すでに選んだシールドはブレイクされる(509.4c)。
      // シールドゾーンから離れたカードだけは、ブレイクできない
      // 「ブレイクする前に」の効果で、ブレイクするシールドの上にカードが重ねられていたら、山の一番上のカードをブレイクする
      const underOf = new Map<number, number>();
      for (const [top, under] of Object.entries(s.piles ?? {})) for (const u of under) underOf.set(u, Number(top));
      const broken: number[] = [...new Set((v.broken as number[]).map((u) => underOf.get(u) ?? u))].filter((u) => s.cards[u].zone === 'shield' && s.cards[u].owner === defender);
      v.broken = broken;
      if (broken.length === 0) {
        popFrame(c, f);
        return;
      }
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
      // ボルメテウス・サファイア・ドラゴン: シールドを手札に加えるかわりに墓地に置く(S・トリガーは使えない)
      const atkPerm = permByPid(s, v.pid);
      if (atkPerm && infoOf(c, atkPerm.perm.cards[0]).statics.some((st) => st.ability.mod.type === 'burnShields')) {
        moveCards(c, broken, { to: 'grave', cause: 'burn', noReplace: true });
        s.breaking = [];
        f.stage = 2;
        pushProc(c, 'settle');
        return;
      }
      // Q.Q.QX.(5.S.D.): シールドを手札に加えるかわりに、相手の山札の上から4枚目の位置に、横向きに刺す
      if (atkPerm && infoOf(c, atkPerm.perm.cards[0]).statics.some((st) => st.ability.mod.type === 'stab5sd')) {
        s.breaking = [];
        stabIntoDeck(c, broken, 4);
        f.stage = 2;
        pushProc(c, 'settle');
        return;
      }
      // S・トリガー/G・ストライクを宣言できるカード(革命2は、ブレイク後の枚数で判定)
      const cands: number[] = [];
      // 重ねられたシールドは、山の全部のカードが手札に加わる。S・トリガーは、それぞれのカードで宣言できる
      const withUnder = broken.flatMap((u) => [u, ...(s.piles?.[u] ?? [])]);
      for (const u of withUnder) {
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
      // S・バック: 宣言しなかったシールドのカードを捨てて、手札の呪文をコストを支払わずに唱える
      const sbacks: { u: number; back: number }[] = [];
      if (gameHas(c, 'sBack')) {
        for (const u of broken) {
          if (declared.includes(u)) continue;
          const back = s.players[defender].hand.find((h) => !sbacks.some((x) => x.back === h) && sBackMatches(c, defender, h, u));
          if (back === undefined) continue;
          const yes = ask<boolean>(c, {
            player: defender,
            why: 'may',
            input: { shape: 'yesno' },
            source: { uid: back, ep: s.cards[back].ep },
            prompt: `S・バック: 《${c.reg.defs[s.cards[u].defId].name}》を捨てて、手札の《${c.reg.defs[s.cards[back].defId].name}》をコストを支払わずに唱えますか?`,
          });
          if (yes) sbacks.push({ u, back });
        }
      }
      // 宣言がすべて終わってから、手札に加える(112.3a)
      const kinds = declared.map((u) => ({ u, d: declaration(c, u)! }));
      moveCards(c, sbacks.length ? broken.filter((u) => !sbacks.some((x) => x.u === u)) : broken, { to: 'hand', cause: 'break', noReplace: true });
      if (sbacks.length) moveCards(c, sbacks.map((x) => x.u), { to: 'grave', cause: 'discard', noReplace: true });
      for (const { back } of sbacks) {
        const bc = s.cards[back];
        const sf = c.reg.defs[bc.defId].faces.findIndex((x) => x.type === 'spell');
        if (sf < 0) continue;
        s.cont.push({ kind: 'proc', id: nextId(s), causedBy: c.cause, name: 'play', stage: 0, vars: { uid: back, ep: bc.ep, from: 'hand', face: sf, free: true, after: null, settle: false } });
      }
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

/** S・バック: 手札のカード back が、シールドから手札に加わるカード u に対して使えるか */
function sBackMatches(c: Ctx, owner: PlayerId, back: number, u: number): boolean {
  if (back === u) return false;
  const def = c.reg.defs[c.s.cards[back].defId];
  for (const face of def.faces) {
    for (const a of face.abilities) {
      if (a.kind === 'keyword' && a.name === 'sBack' && a.attacker && evalCond({ ...mkCC(c, owner, { self: back }), it: u, itFace: -1 }, a.attacker)) return true;
    }
  }
  return false;
}

/** シールドゾーンから手札に加わる時に宣言できる能力(S・トリガー / G・ストライク)。 */
export function declaration(c: Ctx, uid: number): { kind: 'shieldTrigger' | 'gStrike'; ref: AbilityRef; face: number } | null {
  const s = c.s;
  const card = s.cards[uid];
  const def = c.reg.defs[card.defId];
  const cc = mkCC(c, card.owner, { self: uid });
  // 豪龍の記憶: 「S・トリガー」を与えられたシールド(次の持ち主のターンのはじめまで)
  const grantedTurn = s.usage[`stg:${uid}:${card.ep}`];
  const granted = grantedTurn !== undefined && card.zone === 'shield' && s.turn - grantedTurn <= 1;
  // 「自分のシールドゾーンから手札に加える呪文すべてに、S・トリガーを与える」(天雷龍姫エリザベス)
  const spellGranted = gameHas(c, 'spellShieldTrigger') && activeStatics(c, 'spellShieldTrigger').some((st) => st.controller === card.owner);
  // 攻撃中の相手のクリーチャーの「このクリーチャーの攻撃中、相手は G・ストライクを使えない」(覇帝なき侵略 レッドゾーンF)
  const gBanned =
    gameHas(c, 'noGStrike') &&
    activeStatics(c, 'noGStrike').some((st) => st.controller !== card.owner && isAttacking(c, s.cards[st.src].pid));
  // 相手の「自身の S・トリガーを使えない」(バイラス・カースド)
  const stBanned = gameHas(c, 'noOppShieldTrigger') && activeStatics(c, 'noOppShieldTrigger').some((st) => st.controller !== card.owner);
  for (let fi = 0; fi < def.faces.length; fi++) {
    const info = c.reg.getInfo(card.defId, fi);
    for (const st of stBanned ? [] : info.shieldTriggers) {
      if (st.ability.while && !evalCond(cc, st.ability.while)) continue;
      return { kind: 'shieldTrigger', ref: { defId: card.defId, face: fi, idx: st.idx }, face: fi };
    }
    if (spellGranted && !stBanned && def.faces[fi].type === 'spell') {
      return { kind: 'shieldTrigger', ref: { defId: card.defId, face: fi, idx: 0 }, face: fi };
    }
    if (granted && !stBanned && def.faces.length > 0 && fi === (def.faces.findIndex((x) => x.type === 'spell') >= 0 ? def.faces.findIndex((x) => x.type === 'spell') : 0)) {
      return { kind: 'shieldTrigger', ref: { defId: card.defId, face: fi, idx: 0 }, face: fi };
    }
    if (info.gStrike && !gBanned) return { kind: 'gStrike', ref: { defId: card.defId, face: fi, idx: info.gStrike.idx }, face: fi };
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

/** 使用宣言が必要な、非公開ゾーン(手札・山札・シールド)で誘発する能力のいるゾーン */
const HIDDEN_ZONES: ReadonlySet<string> = new Set(['hand', 'deck', 'shield']);

/**
 * 非公開ゾーンで誘発した「してもよい」の能力(侵略・革命チェンジなど)は、どれも解決する前に、
 * まとめて使用宣言する。ターン・プレイヤー側から宣言し、宣言したものは解決時に取りやめられない。
 * 宣言しなかったものは、誘発しなかったことになる(総合ルール 506.3b・507.3、公式Q&A 40435 / 42940)。
 * 質問(ask)は、状態を変更する前に、全員分をまとめて行う。
 */
function declareHidden(c: Ctx): boolean {
  const s = c.s;
  const need: PoolEntry[] = [];
  for (const e of s.pool) {
    if (e.kind !== 'ability' || e.declared || !e.ability) continue;
    const a = c.reg.ability(e.ability);
    if (a.kind !== 'trigger' || !a.optional) continue;
    const card = s.cards[e.source.uid];
    if (card.ep !== e.source.ep || !HIDDEN_ZONES.has(card.zone)) continue;
    // いま条件を満たさない能力は、解決しても何も起こらないので、宣言を聞かない(選択の余地がない質問は出さない)
    if (!triggerConditionHolds(c, e)) continue;
    need.push(e);
  }
  if (need.length === 0) return false;
  // ターン・プレイヤー側が先に宣言し、その待機中の効果を解決し終えてから、非ターン・プレイヤー側が宣言する(506.3b〜e)
  const tp = s.active;
  let group = need.filter((e) => e.controller === tp);
  if (group.length === 0) {
    if (s.pool.some((e) => e.controller === tp)) return false; // ターン・プレイヤーの効果を先に解決する
    group = need;
  }
  const answers = new Map<number, boolean>();
  for (const player of [tp, opponentOf(tp)]) {
    for (const e of group) {
      if (e.controller !== player) continue;
      const a = c.reg.ability(e.ability!) as { label?: string };
      answers.set(
        e.id,
        ask<boolean>(c, {
          player,
          why: 'may',
          input: { shape: 'yesno' },
          source: e.source,
          prompt: `${c.reg.defs[e.lki.defId]?.name ?? ''}: ${a.label ?? '効果を使いますか?'}`,
        }),
      );
    }
  }
  // プールの要素は、元の状態と共有されている(step は入力を書き換えない)ので、置き換える
  for (const e of group) {
    const i = s.pool.indexOf(e);
    if (answers.get(e.id)) s.pool[i] = { ...e, declared: true };
    else s.pool.splice(i, 1);
  }
  return true;
}

function runSettle(c: Ctx, f: ProcFrame): void {
  const s = c.s;
  // 状況起因処理(1回につき1つの変更を行い、再びここへ戻る)
  if (runSba(c)) return;
  if (s.winner !== null) {
    popFrame(c, f);
    return;
  }
  // 宣言を確定したら、いったんここで終える(質問は状態を変更する前に行う規約。次の回で解決順を聞く)
  if (declareHidden(c)) return;
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

function triggerLabel(on: Pattern | Pattern[]): string {
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
/**
 * 条件を持つ誘発型能力が、いま条件を満たしているか。解決の時点で満たしていれば解決される
 * (総合ルール 603.4。誘発した時点で満たしているかは問わない)。
 */
function triggerConditionHolds(c: Ctx, e: PoolEntry): boolean {
  if (e.kind !== 'ability' || !e.ability) return true;
  const a0 = c.reg.ability(e.ability);
  if (a0.kind === 'trigger' && (a0.spec.if || a0.spec.ifAtResolve)) {
    const cc0 = { ...mkCC(c, e.controller, { self: e.source.uid, selfSnap: e.lki, event: e.event }), it: e.event?.card ?? null, itFace: -1 };
    if (a0.spec.if && !evalCond(cc0, a0.spec.if)) return false;
    if (a0.spec.ifAtResolve && !evalCond(cc0, a0.spec.ifAtResolve)) return false;
  }
  return true;
}

function resolveEntry(c: Ctx, e: PoolEntry): void {
  const s = c.s;
  const card = s.cards[e.source.uid];
  // 条件を満たさなければ、何も起こさず(ログにも出さず)終える
  if (!triggerConditionHolds(c, e)) return;
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
      vars: { uid: e.source.uid, ep: card.ep, from: 'hand', face, free: true, after: null, st: true },
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
    // 使用宣言したものは、解決時に取りやめられない(「してもよい」の確認を重ねない)
    ...(e.declared ? { noOptional: true } : {}),
  });
}

// ───────────────────────── 状況起因処理 ─────────────────────────

/** 1つの変更を行ったら true を返す(呼び出し側は再度チェックする)。 */
export function runSba(c: Ctx): boolean {
  const s = c.s;
  if (!s.dirtySba) return false;
  if (s.winner !== null) return false;
  // 山札の横向きのカードを手札に加えたプレイヤーは、ゲームに負ける(「ゲームに負ける時」の置換・負けない効果が使える)
  if (s.pendingLoss && s.pendingLoss.length > 0) {
    const p = s.pendingLoss[0];
    if (lossReplacement(c, p, false)) {
      s.pendingLoss.shift();
      return true;
    }
    s.pendingLoss.shift();
    if (!playerCannotLose(c, p)) {
      s.winner = opponentOf(p);
      s.loseReason = '山札の横向きのカードを手札に加えた';
      emit(c, 'gameOver', { winner: s.winner, reason: s.loseReason });
    }
    return true;
  }
  // 山札が0枚のプレイヤーは敗北(104.2b)
  // 山札が0枚の敗北は、0枚になった出来事に対して1回(置換された後は、山札が増えるまで再度は起きない)
  for (const p of [0, 1] as PlayerId[]) if (s.players[p].deck.length > 0) delete s.usage['deckOutHandled' + p];
  const losers = ([0, 1] as PlayerId[]).filter(
    (p) => s.players[p].deck.length === 0 && s.turn >= 1 && !(s.cfg.solitaire && p === 1) && !s.usage['deckOutHandled' + p] && !playerCannotLose(c, p) && !activeStatics(c, 'noDeckOutLoss').some((st) => st.controller === p),
  );
  if (losers.length) {
    for (const p of losers) {
      const sacrifice = lossReplacement(c, p, true);
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
    // 「離れない」クリーチャーは、破壊されない(破壊しようとしても何も起きないので、状況起因処理が終わらなくなるのを避ける)
    for (const perm of s.players[p].battle) if (isCreatureType(faceTypeOf(c, perm.cards[0])) && powerOf(c, perm) <= 0 && !cannotLeave(c, perm.cards[0], 'destroy')) dead.push(perm.cards[0]);
  }
  if (dead.length) {
    moveCards(c, dead, { to: 'grave', cause: 'destroy' });
    return true;
  }
  // S-MAX進化クリーチャーが2体以上いる場合、1体を残して手札に戻す
  for (const p of [0, 1] as PlayerId[]) {
    const smax = s.players[p].battle.filter((perm) => faceTypeOf(c, perm.cards[0]) === 'smaxEvolution').map((x) => x.cards[0]);
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

/**
 * 「ゲームに負ける時、かわりに〜してもよい」(ジャオウガ)。置換したら true。
 * deckOut: 山札切れによる敗北か(置換後、山札が増えるまで再度は起きないので、記録する)。
 * ダイレクトアタックによる敗北は、攻撃のたびに起きる出来事なので記録しない。
 */
function lossReplacement(c: Ctx, p: PlayerId, deckOut: boolean): boolean {
  const s = c.s;
  const key = `deckOutHandled${p}`;
  for (const perm of s.players[p].battle) {
    const uid = perm.cards[0];
    const info = infoOf(c, uid);
    for (const r of info.replaces) {
      if (r.ability.apply.type !== 'smaxSacrifice' || r.ability.match.type !== 'gameLoss') continue;
      const pool = smaxVictims(c, p, uid);
      if (!pool) continue;
      const use = ask<number[]>(c, {
        player: p,
        why: 'replaceChoice',
        input: { shape: 'option', options: ['かわりに表向きのカード3枚を破壊する', '置換しない'], pick: 1, repeat: false, allIf: false },
        source: { uid, ep: s.cards[uid].ep },
        prompt: `${c.reg.defs[s.cards[uid].defId].name}: ゲームに負ける時、かわりに表向きのカード3枚を破壊してもよい`,
      });
      if (use[0] !== 0) return false;
      // 3枚ちょうどなら選択の余地がない。それより多ければ、破壊する3枚を選ぶ(破壊できるのはバトルゾーンのカードだけ)
      const scored =
        pool.length === 3
          ? pool
          : ask<number[]>(c, {
              player: p,
              why: 'select',
              input: { shape: 'pick', candidates: pool, min: 3, max: 3 },
              source: { uid, ep: s.cards[uid].ep },
              prompt: `${c.reg.defs[s.cards[uid].defId].name}: かわりに破壊する表向きのカードを3枚選んでください`,
            });
      if (deckOut) s.usage[key] = 1;
      moveCards(c, scored, { to: 'grave', cause: 'destroy', noReplace: true });
      return true;
    }
  }
  // 「ゲームに負ける時、かわりに〜してもよい」(手順を行う置換): バトルゾーンと手札のカードが持つ
  const cands: { uid: number; idx: number; ab: Extract<Ability, { kind: 'replace' }> }[] = [];
  const holders = [...s.players[p].battle.map((x) => x.cards[0]), ...s.players[p].hand];
  for (const uid of holders) {
    const card = s.cards[uid];
    const info = card.zone === 'battle' ? infoOf(c, uid) : c.reg.getInfo(card.defId, 0);
    for (const r of info.replaces) {
      const a = r.ability;
      if (a.apply.type !== 'steps' || a.match.type !== 'gameLoss') continue;
      if (a.match.turn === 'opponent' && s.active === p) continue;
      if (a.match.turn === 'own' && s.active !== p) continue;
      if (a.match.reason === 'deckOut' && !deckOut) continue; // 山札切れによる敗北だけ
      if (a.while && !evalCond(mkCC(c, p, { self: uid }), a.while)) continue;
      cands.push({ uid, idx: r.idx, ab: a });
    }
  }
  if (cands.length === 0) return false;
  let pickIdx = 0;
  if (cands.length > 1 || cands[0].ab.optional) {
    const labels = cands.map((x) => x.ab.label ?? 'かわりの処理を行う');
    const ans = ask<number[]>(c, {
      player: p,
      why: 'replaceChoice',
      input: { shape: 'option', options: [...labels, '置換しない'], pick: 1, repeat: false, allIf: false },
      source: { uid: cands[0].uid, ep: s.cards[cands[0].uid].ep },
      prompt: 'ゲームに負ける時、かわりの処理を行えます',
    });
    pickIdx = ans[0];
    if (pickIdx >= cands.length) return false;
  }
  const chosen = cands[pickIdx];
  const card = s.cards[chosen.uid];
  if (deckOut) s.usage[key] = 1;
  s.cont.push({
    kind: 'effect',
    id: nextId(s),
    causedBy: c.cause,
    ability: { defId: card.defId, face: card.zone === 'battle' ? card.face : 0, idx: chosen.idx },
    source: { uid: chosen.uid, ep: card.ep },
    lki: snapOf(c, chosen.uid),
    controller: p,
    pc: 0,
    vars: {},
    trigger: null,
    noOptional: true,
  });
  return true;
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
    case 'battle':
      return runBattle(c, f);
    default:
      throw new Error('未知の手続き: ' + f.name);
  }
}

export { hasKeyword, canAttack };
