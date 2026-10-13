// L1 ルールベースAI(design 7.2): 優先度つきの手続き。
// ターン中の行動はルールで決め、効果の選択(対象・選択肢・任意)は1手先読みで決める。
import { canBlock, charsOf, costOf, hasKeyword, payNeed, powerOf } from '../engine/derive';
import { step } from '../engine/engine';
import { mkCtx } from '../engine/state';
import type { Registry } from '../engine/registry';
import type { Action, GameState, PlayerId } from '../engine/types';
import { FAIR, type InfoPolicy } from '../engine/view';
import { determinize } from './determinize';
import { evaluate } from './eval';
import type { Agent, AgentCtx } from './types';

export interface RuleOpts {
  policy?: InfoPolicy;
  candidateDecks?: string[][];
}

/** マナに置く優先度(小さいほど置きたい) */
function keepScore(view: GameState, reg: Registry, uid: number, me: PlayerId): number {
  const c = mkCtx(view, reg);
  const card = view.cards[uid];
  const ch = charsOf(c, uid, -1);
  const manaN = view.players[me].mana.length;
  let v = ch.cost <= manaN + 2 ? 6 : 3;
  v -= ch.cost * 0.15;
  const info = reg.getInfo(card.defId, ch.faceIdx);
  if (info.shieldTriggers.length) v += 1.5;
  // 手札の他のカードが必要とする文明を、マナに足せるなら置きたい
  const have = new Set<string>();
  for (const m of view.players[me].mana) for (const cv of charsOf(c, m, -1).civs) have.add(cv);
  const need = new Set<string>();
  for (const h of view.players[me].hand) {
    if (h === uid) continue;
    for (const cv of charsOf(c, h, -1).civs) if (!have.has(cv)) need.add(cv);
  }
  for (const cv of ch.civs) if (need.has(cv)) v -= 2;
  // 同じカードが複数あれば1枚は置いてよい
  const dup = view.players[me].hand.filter((h) => view.cards[h].defId === card.defId).length;
  if (dup > 1) v -= 1.5;
  return v;
}

function playScore(view: GameState, reg: Registry, a: Extract<Action, { type: 'PLAY_CARD' }>, me: PlayerId): number {
  const c = mkCtx(view, reg);
  const card = view.cards[a.uid];
  const def = reg.defs[card.defId];
  const fi = a.face ?? 0;
  const face = def.faces[fi];
  const taps = a.extra?.tap?.length ?? 0;
  const cost = costOf(c, a.uid, fi, { taps: a.extra?.tap });
  let v = payNeed(cost, face.civs.length) * 1.0 + taps * 0.0 + (face.cost - cost) * 0.4;
  if (face.type !== 'spell') v += 1.5; // 盤面に残るものを優先
  // タップする分、攻撃できる数が減る
  v -= taps * 0.8;
  // 墓地・マナからのプレイは手札を使わないので、同じコストなら少し優先
  if ((a.from ?? 'hand') !== 'hand') v += 0.5;
  // 呪文は、対象がいなくて空振りしやすいものを避ける(相手の盤面が空)
  if (face.type === 'spell') {
    const opp = (1 - me) as PlayerId;
    if (view.players[opp].battle.length === 0 && /戻|破壊|選び/.test(def.text ?? '')) v -= 3;
  }
  return v;
}

function chooseTurnAction(view: GameState, legal: Action[], ctx: AgentCtx): Action {
  const reg = ctx.reg;
  const me = view.pending!.player;
  const opp = (1 - me) as PlayerId;
  const c = mkCtx(view, reg);
  const byType = (t: Action['type']) => legal.filter((a) => a.type === t);

  // マナチャージ
  const charges = byType('CHARGE_MANA') as Extract<Action, { type: 'CHARGE_MANA' }>[];
  if (charges.length > 0) {
    let best = charges[0];
    let bs = Infinity;
    for (const a of charges) {
      const s = keepScore(view, reg, a.uid, me);
      if (s < bs) {
        bs = s;
        best = a;
      }
    }
    return best;
  }

  // 攻撃の評価(メインでも攻撃は可能。召喚を先に行う)
  const plays = byType('PLAY_CARD') as Extract<Action, { type: 'PLAY_CARD' }>[];
  if (plays.length > 0) {
    let best = plays[0];
    let bs = -Infinity;
    for (const a of plays) {
      const s = playScore(view, reg, a, me);
      if (s > bs) {
        bs = s;
        best = a;
      }
    }
    return best;
  }

  const attacks = byType('ATTACK') as Extract<Action, { type: 'ATTACK' }>[];
  if (attacks.length > 0) {
    const oppBlockers = view.players[opp].battle.filter((p) => canBlock(c, p));
    const maxBlock = oppBlockers.reduce((m, p) => Math.max(m, powerOf(c, p)), 0);
    const oppShield = view.players[opp].shield.length;
    const myShield = view.players[me].shield.length;
    let best: Action | null = null;
    let bs = 0;
    for (const a of attacks) {
      const pm = view.players[me].battle.find((p) => p.pid === a.attacker)!;
      const pa = powerOf(c, pm);
      let score = -1;
      if (a.target.kind === 'player') {
        const breakers = charsOf(c, pm.cards[0], -1).face.abilities.some((x) => x.kind === 'keyword' && x.name === 'breaker') ? 2 : 1;
        if (oppShield === 0 && oppBlockers.length === 0) score = 100;
        else if (oppBlockers.length === 0) score = 20 + breakers;
        else if (maxBlock < pa) score = 12 + breakers; // ブロックされても負けない
        else if (oppShield === 0) score = 8; // ブロッカーを引きつける
        // 自分のブロッカーは、シールドが少ない時は残す
        if (hasKeyword(c, pm, 'blocker') && myShield <= 3 && score < 100) score = -1;
      } else {
        const tp = view.players[opp].battle.find((p) => p.pid === (a.target as any).pid);
        if (tp) {
          const pt = powerOf(c, tp);
          const tcost = charsOf(c, tp.cards[0], -1).cost;
          if (pa > pt) score = 30 + Math.min(tcost, 12) + pt / 2000;
          if (hasKeyword(c, pm, 'blocker') && score > 0 && myShield <= 3) score -= 8;
        }
      }
      if (score > bs) {
        bs = score;
        best = a;
      }
    }
    if (best) return best;
  }

  const endTurn = legal.find((a) => a.type === 'END_TURN');
  if (endTurn) return endTurn;
  return legal.find((a) => a.type === 'END_MAIN') ?? legal.find((a) => a.type === 'SKIP_MANA') ?? legal[0];
}

/** 効果の選択: 実際に1手進めてみて、評価が最も高いものを選ぶ */
function chooseAnswer(view: GameState, legal: Action[], ctx: AgentCtx, o: RuleOpts): Action {
  if (legal.length === 1) return legal[0];
  const me = view.pending!.player;
  const det = determinize(view, me, { rand: ctx.rand, reg: ctx.reg, policy: o.policy ?? FAIR, candidateDecks: o.candidateDecks });
  let best = legal[0];
  let bs = -Infinity;
  for (const a of legal) {
    let v: number;
    try {
      const r = step(det, a, ctx.reg);
      v = evaluate(r.state, ctx.reg, me);
    } catch {
      continue;
    }
    // 評価が同点なら、乱数でばらつかせる
    v += ctx.rand() * 0.01;
    if (v > bs) {
      bs = v;
      best = a;
    }
  }
  return best;
}

export function makeRuleBased(o: RuleOpts = {}): Agent {
  return {
    name: 'ルールベース',
    policy: o.policy ?? FAIR,
    chooseAction(view, legal, ctx) {
      if (legal.length === 1) return legal[0];
      const p = view.pending!;
      if (p.why === 'turnAction') return chooseTurnAction(view, legal, ctx);
      return chooseAnswer(view, legal, ctx, o);
    },
  };
}

export const ruleBasedAgent: Agent = makeRuleBased();
