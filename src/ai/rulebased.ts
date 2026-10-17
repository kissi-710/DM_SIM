// L1 ルールベースAI(design 7.2): 優先度つきの手続き。
// ターン中の行動はルールで決め、効果の選択(対象・選択肢・任意)は1手先読みで決める。
import { breakerCount, canBlock, charsLite, costOf, hasKeyword, isUnblockable, payNeed, powerOf } from '../engine/derive';
import { legalActions, step } from '../engine/engine';
import { mkCtx } from '../engine/state';
import type { Registry } from '../engine/registry';
import type { Action, GameState, PlayerId } from '../engine/types';
import { FAIR, type InfoPolicy } from '../engine/view';
import { determinize } from './determinize';
import { L1_DEFAULT, withL1, type L1Params } from './l1params';
import { evaluate, RULE_WEIGHTS } from './eval';
import { spellNeedsOpponentCreature } from './spellTargets';
import type { Agent, AgentCtx } from './types';

export interface RuleOpts {
  policy?: InfoPolicy;
  candidateDecks?: string[][];
  /**
   * 効果の選択を先読みする時に、エンジンが例外を投げた手を知らせる(その手は候補から外す)。
   * エンジンの不具合や非合法手があっても、AI が弱く見えるだけで気づけないのを防ぐ(テスト・CLI で数える)。
   */
  onError?: (error: unknown, action: Action) => void;
  /** 優先度・しきい値の調整値(既定は L1_DEFAULT。自己対戦での調整・比較用) */
  params?: Partial<L1Params>;
}

/**
 * マナに置く優先度(小さいほど置きたい)。重みは、旧版との自己対戦(勝率)で調整した値。
 * 方針: 呪文(特にS・トリガー)を先にマナへ置き、盤面に残るクリーチャーを手札に残す。
 * 文明が足りなければ、その文明のカードを優先して置く。
 */
export function keepScore(view: GameState, reg: Registry, uid: number, me: PlayerId, p: L1Params): number {
  const c = mkCtx(view, reg);
  const card = view.cards[uid];
  const ch = charsLite(c, uid, -1);
  const manaN = view.players[me].mana.length;
  let v = ch.cost <= manaN + 2 ? p.keepNear : p.keepFar;
  v -= ch.cost * p.keepCost;
  if (ch.cost <= manaN) v += p.keepCastable; // 今でも使えるカードは、先にマナへ回してよい
  const info = reg.getInfo(card.defId, ch.faceIdx);
  if (info.shieldTriggers.length) v += p.keepTrigger;
  const have = new Set<string>();
  for (const m of view.players[me].mana) for (const cv of charsLite(c, m, -1).civs) have.add(cv);
  const need = new Set<string>();
  for (const h of view.players[me].hand) {
    if (h === uid) continue;
    for (const cv of charsLite(c, h, -1).civs) if (!have.has(cv)) need.add(cv);
  }
  // 手札の他のカードが必要とする文明は、マナに足せるなら置きたい。マナにない文明を足すのも良い
  for (const cv of ch.civs) {
    if (need.has(cv)) v += p.keepCivNeed;
    if (!have.has(cv)) v += p.keepCivNew;
  }
  // 同じカードが複数あれば1枚は置いてよい
  const dup = view.players[me].hand.filter((h) => view.cards[h].defId === card.defId).length;
  if (dup > 1) v += p.keepDup;
  v += ch.face.type === 'spell' ? p.keepSpell : p.keepCreature;
  v += p.cardKeep[card.defId] ?? 0;
  return v;
}

export function playScore(view: GameState, reg: Registry, a: Extract<Action, { type: 'PLAY_CARD' }>, me: PlayerId, p: L1Params): number {
  const c = mkCtx(view, reg);
  const card = view.cards[a.uid];
  const def = reg.defs[card.defId];
  const fi = a.face ?? 0;
  const face = def.faces[fi];
  const taps = a.extra?.tap?.length ?? 0;
  const cost = costOf(c, a.uid, fi, { taps: a.extra?.tap });
  let v = payNeed(cost, face.civs.length) * p.playNeed + (face.cost - cost) * p.playDiscount;
  if (face.type !== 'spell') v += p.playBoard; // 盤面に残るものを優先
  // タップする分、攻撃できる数が減る
  v += taps * p.playTap;
  // 墓地・マナからのプレイは手札を使わないので、同じコストなら少し優先
  if ((a.from ?? 'hand') !== 'hand') v += p.playFromOther;
  // 呪文は、対象がいなくて空振りしやすいものを避ける(相手の盤面が空)
  if (face.type === 'spell') {
    const opp = (1 - me) as PlayerId;
    if (view.players[opp].battle.length === 0 && spellNeedsOpponentCreature(reg, card.defId, fi)) v += p.playNoTarget;
  }
  v += p.cardPlay[card.defId] ?? 0;
  return v;
}

export function chooseTurnAction(view: GameState, legal: Action[], ctx: Pick<AgentCtx, 'reg' | 'rand'>, p: L1Params = L1_DEFAULT): Action {
  const reg = ctx.reg;
  const me = view.pending!.player;
  const opp = (1 - me) as PlayerId;
  const c = mkCtx(view, reg);
  const byType = (t: Action['type']) => legal.filter((a) => a.type === t);

  // マナチャージ
  const charges = byType('CHARGE_MANA') as Extract<Action, { type: 'CHARGE_MANA' }>[];
  if (charges.length > 0) {
    // マナが十分にあり、手札のどのカードも払えるなら、これ以上マナを増やしても使い道がない(カードを手札に残す)
    const skip = legal.find((a) => a.type === 'SKIP_MANA');
    const manaN = view.players[me].mana.length;
    if (skip && manaN >= p.skipManaFrom) {
      let maxCost = 0;
      for (const u of view.players[me].hand) {
        const cost = charsLite(c, u, -1).cost;
        if (cost < 99) maxCost = Math.max(maxCost, cost);
      }
      if (manaN >= maxCost) return skip;
    }
    let best = charges[0];
    let bs = Infinity;
    for (const a of charges) {
      const s = keepScore(view, reg, a.uid, me, p);
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
      const s = playScore(view, reg, a, me, p);
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
    // 勝ちが確定する攻撃(S・トリガーは考えない)。ブロッカーに止められない攻撃のうち、
    // 最後の1体(ダイレクトアタック役。ブレイク数の最小のもの)を除いたブレイク数が、シールド以上
    const mine = view.players[me].battle.filter((p) => attacks.some((a) => a.target.kind === 'player' && a.attacker === p.pid));
    const byBreaks = mine.map((p) => ({ p, b: breakerCount(c, p), open: isUnblockable(c, p) })).sort((x, y) => y.b - x.b);
    // ブロックされるのは、ブロックされない攻撃を除き、ブレイク数の多い順(ブロッカー1体で1回だけ止められる)
    const through = [...byBreaks.filter((x) => x.open), ...byBreaks.filter((x) => !x.open).slice(oppBlockers.length)];
    const throughBreaks = through.map((x) => x.b);
    const lastBreak = Math.min(...throughBreaks);
    const lethalNow =
      through.length > 0 && (oppShield === 0 || (through.length >= 2 && throughBreaks.reduce((n, b) => n + b, 0) - lastBreak >= oppShield));
    if (lethalNow) {
      // 先にブレイク数の多いものから攻撃し、最後の1体を残す(攻撃のたびに、この判定をやり直す)
      const first = through.sort((x, y) => y.b - x.b)[0];
      const lethal = attacks.find((x) => x.attacker === first.p.pid && x.target.kind === 'player');
      if (lethal) return lethal;
    }
    let best: Action | null = null;
    let bs = 0;
    for (const a of attacks) {
      const pm = view.players[me].battle.find((p) => p.pid === a.attacker)!;
      const pa = powerOf(c, pm);
      let score = -1;
      if (a.target.kind === 'player') {
        const breakers = breakerCount(c, pm);
        // 「ブロックされない」攻撃は、相手のブロッカーに止められない
        const noBlockers = oppBlockers.length === 0 || isUnblockable(c, pm);
        if (oppShield === 0 && noBlockers) score = 100;
        else if (noBlockers) score = p.atkOpen + breakers;
        else if (maxBlock < pa) score = p.atkOverBlock + breakers; // ブロックされても負けない
        else if (oppShield === 0) score = p.atkBait; // ブロッカーを引きつける
        // 自分のブロッカーは、シールドが少ない時は残す
        if (hasKeyword(c, pm, 'blocker') && myShield <= p.keepBlockerShield && score < 100) score = -1;
      } else {
        const targetPid = a.target.pid;
        const tp = view.players[opp].battle.find((p) => p.pid === targetPid);
        if (tp) {
          const pt = powerOf(c, tp);
          const tcost = charsLite(c, tp.cards[0], -1).cost;
          if (pa > pt) score = p.atkCreature + Math.min(tcost, 12) + pt / 2000;
          else if (pa === pt && tcost - charsLite(c, pm.cards[0], -1).cost >= p.atkTrade) score = p.atkCreature - 10 + Math.min(tcost, 12); // 相打ち(自分より高いコストの相手なら、損にならない)
          if (hasKeyword(c, pm, 'blocker') && score > 0 && myShield <= p.keepBlockerShield) score -= p.atkCreatureBlockerPenalty;
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
function chooseAnswer(view: GameState, legalAll: Action[], ctx: AgentCtx, o: RuleOpts): Action {
  let legal = legalAll;
  if (legal.length === 1) return legal[0];
  const me = view.pending!.player;
  // 任意効果の「使うか + 対象」の1問(0枚 = 使わない)。評価関数は1手先の盤面の差しか見ず、使う/使わないの得失を
  // 見分けられない(従来の「使いますか?」も、はいの評価が同点で乱数まかせだった)ので、従来どおり半々で使い、
  // 使う時の対象だけを評価で選ぶ(評価で使う/使わないを決めると、EXライフのシールドを手放す効果などを使いすぎて勝率が下がる)
  if (view.pending!.why === 'may' && view.pending!.input?.shape === 'pick') {
    const none = legal.find((a) => a.type === 'ANSWER' && Array.isArray(a.value) && a.value.length === 0);
    if (none && ctx.rand() < 0.5) return none;
    const use = legal.filter((a) => a.type === 'ANSWER' && Array.isArray(a.value) && a.value.length > 0);
    if (use.length > 0) legal = use;
    if (legal.length === 1) return legal[0];
  }
  const pr = withL1(o.params);
  const w = pr.ansMana === RULE_WEIGHTS.mana ? RULE_WEIGHTS : { ...RULE_WEIGHTS, mana: pr.ansMana };
  const det = determinize(view, me, { rand: ctx.rand, reg: ctx.reg, policy: o.policy ?? FAIR, candidateDecks: o.candidateDecks });
  let best = legal[0];
  let bs = -Infinity;
  for (const a of legal) {
    let v: number;
    try {
      let st = step(det, a, ctx.reg).state;
      // 使用宣言(革命チェンジ・侵略)は解決より前に聞かれる。解決順の質問で止まって見分けがつかなくならないよう、
      // 順序は結果に影響しないものとして、先頭の候補で先へ進めてから評価する
      for (let i = 0; i < 4 && st.pending?.why === 'pickNext' && st.winner === null; i++) {
        st = step(st, legalActions(st, ctx.reg)[0], ctx.reg).state;
      }
      v = evaluate(st, ctx.reg, me, w);
    } catch (e) {
      o.onError?.(e, a);
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
  const params = withL1(o.params);
  return {
    name: 'ルールベース',
    policy: o.policy ?? FAIR,
    // ターン中の行動は、数と自分の手札・場だけを見る(相手の手札・シールド・山札の中身は読まない)ので、ビューの複製を省ける
    viewless: (s) => s.pending?.why === 'turnAction',
    chooseAction(view, legal, ctx) {
      if (legal.length === 1) return legal[0];
      const p = view.pending!;
      if (p.why === 'turnAction') return chooseTurnAction(view, legal, ctx, params);
      return chooseAnswer(view, legal, ctx, o);
    },
  };
}
