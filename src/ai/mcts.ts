// L2 モンテカルロ探索AI(design 7.2・7.3)。
// 決定化(隠れたカードの割り当て)+ ランダムに近いプレイアウトを繰り返し、各合法手の平均報酬で選ぶ。
// 計算量は「反復回数」と「時間(ms)」の両方で上限を設ける。
import { canBlock, charsOf, costOf, payNeed } from '../engine/derive';
import { legalActions, step } from '../engine/engine';
import { mkCtx } from '../engine/state';
import type { Registry } from '../engine/registry';
import type { Action, GameState, PlayerId } from '../engine/types';
import { FAIR, type InfoPolicy } from '../engine/view';
import { determinize } from './determinize';
import { reward } from './eval';
import type { Agent, AgentCtx } from './types';

export interface MctsOpts {
  policy?: InfoPolicy;
  candidateDecks?: string[][];
  iterations?: number;
  ms?: number;
  /** プレイアウトを何ターン先で打ち切るか */
  horizonTurns?: number;
  /** 探索の定数 */
  c?: number;
}

/** プレイアウト用の軽い方針(合法手から素早く選ぶ) */
export function rolloutPick(s: GameState, legal: Action[], reg: Registry, rand: () => number): Action {
  const p = s.pending!;
  if (p.why !== 'turnAction') {
    return legal[Math.floor(rand() * legal.length)];
  }
  const plays = legal.filter((a) => a.type === 'PLAY_CARD') as Extract<Action, { type: 'PLAY_CARD' }>[];
  const charges = legal.filter((a) => a.type === 'CHARGE_MANA');
  if (charges.length) return charges[Math.floor(rand() * charges.length)];
  if (plays.length && rand() < 0.92) {
    const c = mkCtx(s, reg);
    let best = plays[0];
    let bs = -1;
    for (const a of plays) {
      const fi = a.face ?? 0;
      const face = c.reg.defs[s.cards[a.uid].defId].faces[fi];
      const cost = costOf(c, a.uid, fi, { taps: a.extra?.tap });
      const v = payNeed(cost, face.civs.length) + rand() * 1.5 + (face.type !== 'spell' ? 1 : 0);
      if (v > bs) {
        bs = v;
        best = a;
      }
    }
    return best;
  }
  const attacks = legal.filter((a) => a.type === 'ATTACK') as Extract<Action, { type: 'ATTACK' }>[];
  if (attacks.length && rand() < 0.8) {
    const toPlayer = attacks.filter((a) => a.target.kind === 'player');
    const pool = toPlayer.length && rand() < 0.7 ? toPlayer : attacks;
    return pool[Math.floor(rand() * pool.length)];
  }
  const endTurn = legal.find((a) => a.type === 'END_TURN');
  if (endTurn) return endTurn;
  return legal.find((a) => a.type === 'END_MAIN') ?? legal.find((a) => a.type === 'SKIP_MANA') ?? legal[0];
}

function rollout(start: GameState, reg: Registry, me: PlayerId, rand: () => number, horizon: number): number {
  let s = start;
  const endTurn = s.turn + horizon;
  let guard = 0;
  while (s.winner === null && s.turn < endTurn && guard++ < 400) {
    const legal = legalActions(s, reg);
    if (legal.length === 0) break;
    const a = rolloutPick(s, legal, reg, rand);
    s = step(s, a, reg).state;
  }
  return reward(s, reg, me);
}

export function makeMcts(o: MctsOpts = {}): Agent {
  const policy = o.policy ?? FAIR;
  return {
    name: 'モンテカルロ',
    policy,
    chooseAction(view, legal, ctx: AgentCtx) {
      if (legal.length === 1) return legal[0];
      const reg = ctx.reg;
      const me = view.pending!.player;
      const iterations = ctx.budget?.iterations ?? o.iterations ?? 120;
      const ms = ctx.budget?.ms ?? o.ms ?? 1500;
      const horizon = o.horizonTurns ?? 4;
      const C = o.c ?? 0.7;
      const t0 = Date.now();
      const n = legal.length;
      const visits = new Array(n).fill(0);
      const total = new Array(n).fill(0);
      let it = 0;
      // 同じ盤面の別の決定化に対して、各手を試す(1反復 = 全ての手を1回ずつ、ではなく UCB で選ぶ)
      const maxIt = Math.max(iterations, n);
      while (it < maxIt && (it < n || Date.now() - t0 < ms)) {
        const det = determinize(view, me, { rand: ctx.rand, reg, policy, candidateDecks: o.candidateDecks });
        // どの手を試すか: まず全部を1回、その後 UCB1
        let k: number;
        if (it < n) k = it;
        else {
          k = 0;
          let bu = -Infinity;
          for (let i = 0; i < n; i++) {
            const u = total[i] / visits[i] + C * Math.sqrt(Math.log(it + 1) / visits[i]);
            if (u > bu) {
              bu = u;
              k = i;
            }
          }
        }
        let r: number;
        try {
          const s1 = step(det, legal[k], reg).state;
          r = rollout(s1, reg, me, ctx.rand, horizon);
        } catch {
          r = 0;
        }
        visits[k]++;
        total[k] += r;
        it++;
      }
      let best = 0;
      let bm = -1;
      for (let i = 0; i < n; i++) {
        const m = visits[i] ? total[i] / visits[i] : -1;
        if (m > bm) {
          bm = m;
          best = i;
        }
      }
      return legal[best];
    },
  };
}

void canBlock;
void charsOf;
