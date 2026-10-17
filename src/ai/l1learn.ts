// 実験: ターン中の行動(マナチャージ・召喚・攻撃・ターン終了)を、学習した線形の評価で選ぶ方針。
// 目標は「その手のあと L1 で続けた時の勝率」(教師の手の価値)。ルールベース(L1)の1回分の方針改善(policy iteration)。
import { breakerCount, canBlock, charsLite, costOf, hasKeyword, isUnblockable, payNeed, powerOf } from '../engine/derive';
import { mkCtx } from '../engine/state';
import type { Registry } from '../engine/registry';
import type { Action, GameState, PlayerId } from '../engine/types';
import { spellNeedsOpponentCreature } from './spellTargets';

const CIVS = ['light', 'water', 'darkness', 'fire', 'nature'];

const defIndexCache = new WeakMap<Registry, Map<string, number>>();
function defIndex(reg: Registry): Map<string, number> {
  let m = defIndexCache.get(reg);
  if (!m) {
    m = new Map();
    for (const id of Object.keys(reg.defs).sort()) if (id !== '?' && id !== 'dummy' && !id.startsWith('blank')) m.set(id, m.size);
    defIndexCache.set(reg, m);
  }
  return m;
}

// 特徴量の並び(ブロックごと)
const N_ATTR = 8 + 5; // コスト/10・呪文・S・ブロッカー・スピードアタッカー・パワー/10000・多色・クリーチャー + 文明5
const B_CHARGE = 0;
const N_CHARGE = 1 + N_ATTR + 8; // 定数 + 属性 + 文脈
const B_SKIP = B_CHARGE + N_CHARGE;
const N_SKIP = 5;
const B_PLAY = B_SKIP + N_SKIP;
/** 召喚の特徴量ブロックの先頭(定数項 = 1 が立つ)。召喚の手だけを選ぶ方針(choosePlayLearned)と学習が使う */
export const PLAY_BLOCK = B_PLAY;
const N_PLAY = 1 + N_ATTR + 10;
const B_ATK_P = B_PLAY + N_PLAY;
const N_ATK_P = 12;
const B_ATK_C = B_ATK_P + N_ATK_P;
const N_ATK_C = 12;
const B_END = B_ATK_C + N_ATK_C;
const N_END = 6;
const B_ID = B_END + N_END; // カード別: マナチャージ / 召喚 / 攻撃者 の3系統
export const n_features = (reg: Registry): number => B_ID + 3 * defIndex(reg).size;

export interface L1Model {
  /** 特徴量の重み(長さ n_features) */
  w: number[];
}

type Ctx = ReturnType<typeof mkCtx>;

function attrs(c: Ctx, reg: Registry, uid: number, out: number[], at: number): void {
  const ch = charsLite(c, uid, -1);
  const info = reg.getInfo(c.s.cards[uid].defId, ch.faceIdx);
  out[at] = Math.min(ch.cost, 12) / 10;
  out[at + 1] = ch.face.type === 'spell' ? 1 : 0;
  out[at + 2] = info.shieldTriggers.length ? 1 : 0;
  out[at + 3] = info.blocker ? 1 : 0;
  out[at + 4] = info.speedAttacker ? 1 : 0;
  out[at + 5] = (ch.face.power ?? 0) / 10000;
  out[at + 6] = ch.civs.length > 1 ? 1 : 0;
  out[at + 7] = ch.face.type !== 'spell' ? 1 : 0;
  for (let i = 0; i < 5; i++) out[at + 8 + i] = ch.civs.includes(CIVS[i] as never) ? 1 : 0;
}

/** 局面の文脈(1回の決定で共通) */
interface Situation {
  c: Ctx;
  me: PlayerId;
  opp: PlayerId;
  mana: number;
  untapped: number;
  handN: number;
  turn: number;
  oppShield: number;
  myShield: number;
  oppBlockers: number;
  maxBlock: number;
  myCreatures: number;
  oppCreatures: number;
  maxHandCost: number;
  castable: number;
}

export function situationOf(view: GameState, reg: Registry): Situation {
  const c = mkCtx(view, reg);
  const me = view.pending!.player;
  const opp = (1 - me) as PlayerId;
  const z = view.players[me];
  const oppBl = view.players[opp].battle.filter((p) => canBlock(c, p));
  let maxHandCost = 0;
  let castable = 0;
  const untapped = z.mana.filter((u) => !view.cards[u].tapped).length;
  for (const u of z.hand) {
    const cost = charsLite(c, u, -1).cost;
    if (cost < 99) maxHandCost = Math.max(maxHandCost, cost);
    if (cost <= untapped) castable++;
  }
  return {
    c,
    me,
    opp,
    mana: z.mana.length,
    untapped,
    handN: z.hand.length,
    turn: view.turn,
    oppShield: view.players[opp].shield.length,
    myShield: z.shield.length,
    oppBlockers: oppBl.length,
    maxBlock: oppBl.reduce((m, p) => Math.max(m, powerOf(c, p)), 0),
    myCreatures: z.battle.length,
    oppCreatures: view.players[opp].battle.length,
    maxHandCost,
    castable,
  };
}

/** 手 a の特徴量(密なベクトル) */
export function features(view: GameState, reg: Registry, sit: Situation, a: Action, out: number[]): void {
  const { c, me, opp } = sit;
  const idx = defIndex(reg);
  const D = n_features(reg);
  if (out.length !== D) out.length = D;
  out.fill(0);
  const manaN = sit.mana / 10;
  switch (a.type) {
    case 'CHARGE_MANA': {
      const card = view.cards[a.uid];
      const ch = charsLite(c, a.uid, -1);
      out[B_CHARGE] = 1;
      attrs(c, reg, a.uid, out, B_CHARGE + 1);
      const at = B_CHARGE + 1 + N_ATTR;
      const have = new Set<string>();
      for (const m of view.players[me].mana) for (const cv of charsLite(c, m, -1).civs) have.add(cv);
      const need = new Set<string>();
      for (const h of view.players[me].hand) {
        if (h === a.uid) continue;
        for (const cv of charsLite(c, h, -1).civs) if (!have.has(cv)) need.add(cv);
      }
      out[at] = ch.civs.some((cv) => need.has(cv)) ? 1 : 0;
      out[at + 1] = ch.civs.some((cv) => !have.has(cv)) ? 1 : 0;
      out[at + 2] = view.players[me].hand.filter((h) => view.cards[h].defId === card.defId).length > 1 ? 1 : 0;
      out[at + 3] = ch.cost <= sit.mana ? 1 : 0;
      out[at + 4] = ch.cost <= sit.mana + 2 ? 1 : 0;
      out[at + 5] = (ch.cost / 10) * manaN;
      out[at + 6] = ch.face.type === 'spell' ? manaN : 0;
      out[at + 7] = sit.turn / 20;
      const di = idx.get(card.defId);
      if (di !== undefined) out[B_ID + di] = 1;
      break;
    }
    case 'SKIP_MANA':
      out[B_SKIP] = 1;
      out[B_SKIP + 1] = manaN;
      out[B_SKIP + 2] = (sit.maxHandCost - sit.mana) / 10;
      out[B_SKIP + 3] = sit.handN / 10;
      out[B_SKIP + 4] = sit.castable / 5;
      break;
    case 'PLAY_CARD': {
      const card = view.cards[a.uid];
      const def = reg.defs[card.defId];
      const fi = a.face ?? 0;
      const face = def.faces[fi];
      const taps = a.extra?.tap?.length ?? 0;
      const cost = costOf(c, a.uid, fi, { taps: a.extra?.tap });
      out[B_PLAY] = 1;
      attrs(c, reg, a.uid, out, B_PLAY + 1);
      const at = B_PLAY + 1 + N_ATTR;
      out[at] = payNeed(cost, face.civs.length) / 5;
      out[at + 1] = (face.cost - cost) / 5;
      out[at + 2] = taps / 3;
      out[at + 3] = (a.from ?? 'hand') !== 'hand' ? 1 : 0;
      out[at + 4] = face.type === 'spell' && view.players[opp].battle.length === 0 && spellNeedsOpponentCreature(reg, card.defId, fi) ? 1 : 0;
      out[at + 5] = (sit.untapped - cost) / 10;
      out[at + 6] = sit.myCreatures / 5;
      out[at + 7] = sit.oppCreatures / 5;
      out[at + 8] = sit.oppShield / 5;
      out[at + 9] = face.type === 'spell' ? sit.oppCreatures / 5 : 0;
      const di = idx.get(card.defId);
      if (di !== undefined) out[B_ID + idx.size + di] = 1;
      break;
    }
    case 'ATTACK': {
      const pm = view.players[me].battle.find((p) => p.pid === a.attacker)!;
      const pa = powerOf(c, pm);
      const br = breakerCount(c, pm);
      const isBlocker = hasKeyword(c, pm, 'blocker');
      const di = idx.get(view.cards[pm.cards[0]].defId);
      if (di !== undefined) out[B_ID + 2 * idx.size + di] = 1;
      if (a.target.kind === 'player') {
        const noBlockers = sit.oppBlockers === 0 || isUnblockable(c, pm);
        const at = B_ATK_P;
        out[at] = 1;
        out[at + 1] = br / 3;
        out[at + 2] = noBlockers ? 1 : 0;
        out[at + 3] = sit.oppShield === 0 ? 1 : 0;
        out[at + 4] = pa / 10000;
        out[at + 5] = !noBlockers && sit.maxBlock < pa ? 1 : 0;
        out[at + 6] = isBlocker ? 1 : 0;
        out[at + 7] = isBlocker ? sit.myShield / 5 : 0;
        out[at + 8] = sit.oppShield / 5;
        out[at + 9] = sit.oppShield > 0 && br >= sit.oppShield ? 1 : 0;
        out[at + 10] = sit.myShield / 5;
        out[at + 11] = sit.oppBlockers / 3;
      } else {
        const targetPid = a.target.pid;
        const tp = view.players[opp].battle.find((p) => p.pid === targetPid);
        const at = B_ATK_C;
        out[at] = 1;
        if (tp) {
          const pt = powerOf(c, tp);
          const tcost = charsLite(c, tp.cards[0], -1).cost;
          const mycost = charsLite(c, pm.cards[0], -1).cost;
          out[at + 1] = pa > pt ? 1 : 0;
          out[at + 2] = pa === pt ? 1 : 0;
          out[at + 3] = Math.min(tcost, 12) / 10;
          out[at + 4] = pt / 10000;
          out[at + 5] = mycost / 10;
          out[at + 6] = isBlocker ? 1 : 0;
          out[at + 7] = isBlocker ? sit.myShield / 5 : 0;
          out[at + 8] = sit.myShield / 5;
          out[at + 9] = pa < pt ? 1 : 0;
          out[at + 10] = (tcost - mycost) / 10;
          out[at + 11] = hasKeyword(c, tp, 'blocker') ? 1 : 0;
        }
      }
      break;
    }
    case 'END_MAIN':
    case 'END_TURN': {
      out[B_END] = a.type === 'END_TURN' ? 1 : 0;
      out[B_END + 1] = a.type === 'END_MAIN' ? 1 : 0;
      out[B_END + 2] = sit.untapped / 10;
      out[B_END + 3] = sit.castable / 5;
      out[B_END + 4] = sit.myCreatures / 5;
      out[B_END + 5] = sit.oppShield / 5;
      break;
    }
    default:
      break;
  }
}

const dot = (w: number[], x: number[]) => {
  let s = 0;
  for (let i = 0; i < x.length; i++) if (x[i] !== 0) s += w[i] * x[i];
  return s;
};

/** 学習した評価で、最も高い手を選ぶ(同点は先頭) */
export function chooseLearned(view: GameState, legal: Action[], reg: Registry, model: L1Model): Action {
  const sit = situationOf(view, reg);
  const x: number[] = [];
  let best = legal[0];
  let bs = -Infinity;
  for (const a of legal) {
    features(view, reg, sit, a, x);
    const s = dot(model.w, x);
    if (s > bs) {
      bs = s;
      best = a;
    }
  }
  return best;
}

/**
 * 保守的な選び方: 学習した評価で、L1 の手より delta 以上良いと予測される手があるときだけ、そちらに替える。
 * (近い手のノイズに引きずられて、L1 の良い手を壊さないため)
 */
export function chooseConservative(view: GameState, legal: Action[], reg: Registry, model: L1Model, l1pick: Action, delta: number): Action {
  const sit = situationOf(view, reg);
  const x: number[] = [];
  const key = JSON.stringify(l1pick);
  let l1s = -Infinity;
  let best = l1pick;
  let bs = -Infinity;
  for (const a of legal) {
    features(view, reg, sit, a, x);
    const s = dot(model.w, x);
    if (JSON.stringify(a) === key) l1s = s;
    if (s > bs) {
      bs = s;
      best = a;
    }
  }
  return bs - l1s > delta ? best : l1pick;
}

/** 召喚・詠唱の手だけを、学習した評価で選ぶ(手が無ければ -1)。同点は先頭。Rust 版(rust/src/ai.rs の learned_play)と同じ式 */
export function choosePlayLearned(view: GameState, legal: Action[], reg: Registry, w: number[]): number {
  // カードの一覧が学習時と変わった(重みの長さが合わない)時は使わない(Rust 版も同じ)
  if (w.length !== n_features(reg)) return -1;
  const sit = situationOf(view, reg);
  const x: number[] = [];
  let best = -1;
  let bs = -Infinity;
  for (let i = 0; i < legal.length; i++) {
    if (legal[i].type !== 'PLAY_CARD') continue;
    features(view, reg, sit, legal[i], x);
    const s = dot(w, x);
    if (best < 0 || s > bs) {
      bs = s;
      best = i;
    }
  }
  return best;
}
