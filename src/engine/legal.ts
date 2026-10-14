// 合法手の列挙と検証(design 5 / effects 12)。
import { canAttack } from './derive';
import { charsOf, costOf, hasKeyword, isSick } from './derive';
import { evalCond, mkCC } from './cond';
import { planPlay } from './procs';
import type { Registry } from './registry';
import type { Ctx } from './state';
import { mkCtx, opponentOf } from './state';
import type { Action, AnswerValue, GameState, InputSpec, Pending, PlayerId, PlayExtra, ZoneName } from './types';

export const ENUM_LIMIT = 200;

/** 現在、行動できるプレイヤー(いなければ null) */
export function actor(s: GameState): PlayerId | null {
  if (s.winner !== null) return null;
  return s.pending ? s.pending.player : null;
}

export function legalActions(s: GameState, reg: Registry): Action[] {
  if (s.winner !== null || !s.pending) return [];
  const c = mkCtx(s, reg);
  const p = s.pending;
  if (p.why === 'turnAction') return turnActions(c, p.player);
  return enumerateAnswers(p).map((value) => ({ type: 'ANSWER', id: p.id, value }));
}

// ───────────────────────── ターン中の行動 ─────────────────────────

function turnActions(c: Ctx, player: PlayerId): Action[] {
  const s = c.s;
  const out: Action[] = [];
  const seen = new Set<string>();
  const add = (a: Action, key?: string) => {
    if (key !== undefined) {
      if (seen.has(key)) return;
      seen.add(key);
    }
    out.push(a);
  };
  if (s.step === 'mana') {
    if (!s.manaCharged) {
      for (const u of s.players[player].hand) add({ type: 'CHARGE_MANA', uid: u }, 'cm:' + s.cards[u].defId);
    }
    add({ type: 'SKIP_MANA' });
    return out;
  }
  if (s.step === 'main') {
    for (const a of playActions(c, player)) add(a, JSON.stringify([a.type, s.cards[(a as any).uid].defId, (a as any).from, (a as any).face, (a as any).extra]));
    add({ type: 'END_MAIN' });
  }
  if (s.step === 'main' || s.step === 'attack') {
    for (const a of attackActions(c, player)) add(a);
    add({ type: 'END_TURN' });
  }
  return out;
}

export function attackActions(c: Ctx, player: PlayerId): Action[] {
  const s = c.s;
  const out: Action[] = [];
  const opp = opponentOf(player);
  for (const perm of s.players[player].battle) {
    if (canAttack(c, perm, { kind: 'player' })) out.push({ type: 'ATTACK', attacker: perm.pid, target: { kind: 'player' } });
    for (const t of s.players[opp].battle) {
      if (canAttack(c, perm, { kind: 'creature', pid: t.pid })) {
        out.push({ type: 'ATTACK', attacker: perm.pid, target: { kind: 'creature', pid: t.pid } });
      }
    }
  }
  return out;
}

/** 使えるカード(召喚・詠唱)の行動を列挙する。各カードの種類・面・進化先・ハイパーエナジーの組み合わせ。 */
export function playActions(c: Ctx, player: PlayerId): Action[] {
  const s = c.s;
  const out: Action[] = [];
  const zones: ZoneName[] = ['hand', 'mana', 'grave'];
  for (const z of zones) {
    const list = z === 'battle' ? [] : (s.players[player] as any)[z] as number[];
    for (const uid of list) {
      const def = c.reg.defs[s.cards[uid].defId];
      for (let fi = 0; fi < def.faces.length; fi++) {
        const face = def.faces[fi];
        const info = c.reg.getInfo(def.id, fi);
        if (z !== 'hand' && !info.permissions.some((p) => p.from === z && p.play === (face.type === 'spell' ? 'cast' : 'summon'))) continue;
        for (const extra of extraVariants(c, player, uid, z, fi)) {
          const plan = planPlay(c, player, uid, z, fi, extra, false);
          if (plan.ok) out.push({ type: 'PLAY_CARD', uid, from: z, face: fi, extra });
        }
      }
    }
  }
  return out;
}

function extraVariants(c: Ctx, player: PlayerId, uid: number, from: ZoneName, fi: number): (PlayExtra | undefined)[] {
  const s = c.s;
  const def = c.reg.defs[s.cards[uid].defId];
  const face = def.faces[fi];
  const info = c.reg.getInfo(def.id, fi);
  const bases: (number | undefined)[] = [];
  if (face.type === 'evolution') {
    for (const perm of s.players[player].battle) {
      const top = perm.cards[0];
      const cc = mkCC(c, player, { self: uid, it: top, itFace: s.cards[top].face });
      if (face.evolveFrom && evalCond(cc, face.evolveFrom)) bases.push(perm.pid);
    }
  } else bases.push(undefined);
  const out: (PlayExtra | undefined)[] = [];
  for (const onto of bases) {
    if (face.type === 'evolution' && onto === undefined) continue;
    if (!info.hyperEnergy) {
      out.push(onto === undefined ? undefined : { onto });
      continue;
    }
    // ハイパーエナジー: コストが互いに異なるクリーチャーを j 体タップする代表的な選び方
    const free = s.players[player].battle.filter((p) => !p.tapped);
    const byCost = new Map<number, typeof free>();
    for (const p of free) {
      const cost = charsOf(c, p.cards[0], -1).cost;
      const l = byCost.get(cost) ?? [];
      l.push(p);
      byCost.set(cost, l);
    }
    // 各コストから、価値の低いもの(召喚酔いのもの→パワーの低いもの)を代表にする
    const reps = [...byCost.values()].map((l) =>
      l.slice().sort((a, b) => Number(isSick(c, b)) - Number(isSick(c, a)) || charsOf(c, a.cards[0], -1).power - charsOf(c, b.cards[0], -1).power)[0],
    );
    reps.sort((a, b) => Number(isSick(c, b)) - Number(isSick(c, a)) || charsOf(c, a.cards[0], -1).power - charsOf(c, b.cards[0], -1).power);
    const base = costOf(c, uid, fi, {});
    for (let j = 0; j <= reps.length; j++) {
      if (j > 0 && base - 2 * (j - 1) <= 0) break;
      const extra: PlayExtra = { tap: reps.slice(0, j).map((p) => p.pid) };
      if (onto !== undefined) extra.onto = onto;
      if (j === 0 && onto === undefined) out.push(undefined);
      else out.push(extra);
    }
  }
  void hasKeyword;
  return out;
}

// ───────────────────────── 回答の列挙・検証 ─────────────────────────

function combos(items: number[], min: number, max: number, limit: number): number[][] {
  const res: number[][] = [];
  const go = (start: number, cur: number[]) => {
    if (res.length >= limit) return;
    if (cur.length >= min && cur.length <= max) res.push(cur.slice());
    if (cur.length >= max) return;
    for (let i = start; i < items.length; i++) {
      cur.push(items[i]);
      go(i + 1, cur);
      cur.pop();
      if (res.length >= limit) return;
    }
  };
  go(0, []);
  return res;
}

let truncations = 0;

/**
 * 回答の列挙が上限(ENUM_LIMIT)で打ち切られた回数。合法手が先頭の候補に偏っていないかを、
 * テストや計測で確かめるための診断用(通常の対戦・調査では 0 のはず)。
 */
export function enumTruncations(): number {
  return truncations;
}
export function resetEnumTruncations(): void {
  truncations = 0;
}

/** 回答の合法手を列挙する(最大 limit 件)。上限を超えて打ち切った時は、診断のために数える */
export function enumerateAnswers(p: Pending, limit = ENUM_LIMIT): AnswerValue[] {
  const res = enumerateRaw(p, limit + 1);
  if (res.length > limit) {
    truncations++;
    return res.slice(0, limit);
  }
  return res;
}

function enumerateRaw(p: Pending, limit: number): AnswerValue[] {
  const inp = p.input;
  if (!inp) return [];
  switch (inp.shape) {
    case 'pick':
      return combos(inp.candidates, inp.min, inp.max, limit);
    case 'yesno':
      return [true, false];
    case 'order':
      return inp.candidates.slice();
    case 'ack':
      return [true];
    case 'option': {
      const res: number[][] = [];
      const n = inp.options.length;
      const go = (start: number, cur: number[]) => {
        if (res.length >= limit) return;
        if (cur.length === inp.pick) {
          res.push(cur.slice());
          return;
        }
        for (let i = inp.repeat ? start : start; i < n; i++) {
          cur.push(i);
          go(inp.repeat ? i : i + 1, cur);
          cur.pop();
        }
      };
      go(0, []);
      if (inp.allIf) res.push([...Array(n).keys()]);
      return res;
    }
    case 'assign':
      return enumerateAssign(inp, limit);
    case 'payment':
      return [inp.mana.slice(0, inp.need)];
  }
}

function enumerateAssign(inp: Extract<InputSpec, { shape: 'assign' }>, limit: number): AnswerValue[] {
  const items = inp.items;
  const slots = inp.slots;
  const cap = slots.reduce((t, x) => t + x.count, 0);
  const need = Math.min(items.length, cap);
  const res: Record<string, number[]>[] = [];
  const cur: Record<string, number[]> = {};
  for (const sl of slots) cur[sl.id] = [];
  const used = new Set<number>();
  const go = (i: number, assigned: number) => {
    if (res.length >= limit) return;
    if (i === items.length) {
      if (assigned === need) res.push(JSON.parse(JSON.stringify(cur)));
      return;
    }
    // この札を、どの枠に入れるか(または入れない)
    for (const sl of slots) {
      if (cur[sl.id].length >= sl.count) continue;
      cur[sl.id].push(items[i]);
      used.add(items[i]);
      go(i + 1, assigned + 1);
      cur[sl.id].pop();
      used.delete(items[i]);
    }
    if (items.length - i - 1 + assigned >= need) go(i + 1, assigned);
  };
  go(0, 0);
  return res;
}

/** 回答の形式が正しいか(列挙せずに判定)。エラー文字列か null。 */
export function validateAnswer(p: Pending, v: AnswerValue): string | null {
  const inp = p.input;
  if (!inp) return '入力を受け付けていません';
  switch (inp.shape) {
    case 'pick': {
      if (!Array.isArray(v)) return '配列で答えてください';
      const a = v as number[];
      if (a.length < inp.min || a.length > inp.max) return `${inp.min}〜${inp.max}個選んでください`;
      if (new Set(a).size !== a.length) return '重複しています';
      if (!a.every((x) => inp.candidates.includes(x))) return '候補にないものを選んでいます';
      return null;
    }
    case 'yesno':
      return typeof v === 'boolean' ? null : 'はい/いいえで答えてください';
    case 'ack':
      return null;
    case 'order':
      return typeof v === 'number' && inp.candidates.includes(v) ? null : '候補から選んでください';
    case 'option': {
      if (!Array.isArray(v)) return '配列で答えてください';
      const a = v as number[];
      const n = inp.options.length;
      if (!a.every((x) => Number.isInteger(x) && x >= 0 && x < n)) return '選択肢が範囲外です';
      const isAll = inp.allIf && a.length === n && new Set(a).size === n;
      if (isAll) return null;
      if (a.length !== inp.pick) return `${inp.pick}個選んでください`;
      if (!inp.repeat && new Set(a).size !== a.length) return '同じものは選べません';
      return null;
    }
    case 'assign': {
      if (typeof v !== 'object' || Array.isArray(v) || v === null) return '割り振りが不正です';
      const m = v as Record<string, number[]>;
      const cap = inp.slots.reduce((t, x) => t + x.count, 0);
      const need = Math.min(inp.items.length, cap);
      const all: number[] = [];
      for (const sl of inp.slots) {
        const l = m[sl.id] ?? [];
        if (l.length > sl.count) return `${sl.label}は${sl.count}枚までです`;
        all.push(...l);
      }
      for (const k of Object.keys(m)) if (!inp.slots.some((x) => x.id === k)) return '未知の枠です';
      if (all.length !== need) return `${need}枚を割り振ってください`;
      if (new Set(all).size !== all.length) return '重複しています';
      if (!all.every((x) => inp.items.includes(x))) return '対象外のカードです';
      return null;
    }
    case 'payment':
      return Array.isArray(v) ? null : '配列で答えてください';
  }
}

/** 行動が合法かを検証する(エラー文字列か null) */
export function validateAction(s: GameState, reg: Registry, a: Action): string | null {
  if (s.winner !== null) return 'ゲームは終了しています';
  const p = s.pending;
  if (!p) return '入力待ちではありません';
  if (a.type === 'ANSWER') {
    if (p.why === 'turnAction') return '今は回答ではなく行動を選ぶ場面です';
    if (a.id !== p.id) return '古い入力です';
    return validateAnswer(p, a.value);
  }
  if (p.why !== 'turnAction') return '今は回答を求められています';
  const c = mkCtx(s, reg);
  const player = p.player;
  switch (a.type) {
    case 'CHARGE_MANA': {
      if (s.step !== 'mana' || s.manaCharged) return '今はマナチャージできません';
      const card = s.cards[a.uid];
      if (!card || card.owner !== player || card.zone !== 'hand') return '手札のカードではありません';
      return null;
    }
    case 'SKIP_MANA':
      return s.step === 'mana' ? null : '今はマナチャージのステップではありません';
    case 'END_MAIN':
      return s.step === 'main' ? null : '今はメインステップではありません';
    case 'END_TURN':
      return s.step === 'main' || s.step === 'attack' ? null : '今はターンを終えられません';
    case 'PLAY_CARD': {
      if (s.step !== 'main') return '今はカードを使えません';
      const card = s.cards[a.uid];
      if (!card) return 'カードがありません';
      const from = a.from ?? 'hand';
      const def = reg.defs[card.defId];
      const fi = a.face ?? (def.faces.findIndex((f) => f.type !== 'spell') >= 0 ? def.faces.findIndex((f) => f.type !== 'spell') : 0);
      const plan = planPlay(c, player, a.uid, from, fi, a.extra, false);
      return plan.ok ? null : plan.err ?? '使えません';
    }
    case 'ATTACK': {
      if (s.step !== 'main' && s.step !== 'attack') return '今は攻撃できません';
      const pm = s.players[player].battle.find((x) => x.pid === a.attacker);
      if (!pm) return '攻撃できるクリーチャーではありません';
      return canAttack(c, pm, a.target) ? null : 'その対象は攻撃できません';
    }
  }
}
