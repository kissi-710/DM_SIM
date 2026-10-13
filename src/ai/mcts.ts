// L2 モンテカルロ探索AI(design 7.2・7.3)。
// 決定化(隠れたカードの割り当て)+ プレイアウトを繰り返し、各合法手の平均報酬で選ぶ。
// プレイアウトの方針は L1(ルールベース)の手順を使い、L1 の手を事前の候補として扱う
// (方針改善型: L1 より悪い手に動かないようにする)。計算量は反復回数と時間(ms)の両方で上限を設ける。
import { legalActions, step } from '../engine/engine';
import type { Registry } from '../engine/registry';
import type { Action, GameState, PlayerId } from '../engine/types';
import { FAIR, type InfoPolicy } from '../engine/view';
import { determinize } from './determinize';
import { reward } from './eval';
import { chooseTurnAction, makeRuleBased } from './rulebased';
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
  /** L1 の手に与える事前の上乗せ(報酬の単位) */
  priorBonus?: number;
}

/** プレイアウト用の素早い方針: ターン中の行動は L1 の手順、効果の選択は軽い規則 */
export function rolloutPick(s: GameState, legal: Action[], reg: Registry, rand: () => number): Action {
  const p = s.pending!;
  if (p.why === 'turnAction') return chooseTurnAction(s, legal, { reg, rand });
  const pick = (arr: Action[]) => arr[Math.floor(rand() * arr.length)];
  switch (p.why) {
    case 'triggerDeclare': {
      // S・トリガーは宣言できるだけ宣言する
      let best = legal[0];
      let bl = -1;
      for (const a of legal) {
        const n = a.type === 'ANSWER' && Array.isArray(a.value) ? a.value.length : 0;
        if (n > bl) {
          bl = n;
          best = a;
        }
      }
      return best;
    }
    case 'may': {
      const yes = legal.find((a) => a.type === 'ANSWER' && a.value === true);
      return yes && rand() < 0.75 ? yes : pick(legal);
    }
    case 'block': {
      // 半分はブロックする
      const blocks = legal.filter((a) => a.type === 'ANSWER' && Array.isArray(a.value) && a.value.length > 0);
      return blocks.length && rand() < 0.5 ? pick(blocks) : legal[0];
    }
    default:
      return pick(legal);
  }
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
  const l1 = makeRuleBased({ policy, candidateDecks: o.candidateDecks });
  return {
    name: 'モンテカルロ',
    policy,
    chooseAction(view, legal, ctx: AgentCtx) {
      if (legal.length === 1) return legal[0];
      const reg = ctx.reg;
      const me = view.pending!.player;
      const iterations = ctx.budget?.iterations ?? o.iterations ?? 120;
      const ms = ctx.budget?.ms ?? o.ms ?? 1500;
      const horizon = o.horizonTurns ?? 3;
      const C = o.c ?? 0.5;
      const prior = o.priorBonus ?? 0.08;
      const t0 = Date.now();
      const n = legal.length;
      const visits = new Array(n).fill(0);
      const total = new Array(n).fill(0);

      // L1 が選ぶ手(事前の候補)
      const baseAct = l1.chooseAction(view, legal, ctx) as Action;
      let baseIdx = legal.findIndex((a) => JSON.stringify(a) === JSON.stringify(baseAct));
      if (baseIdx < 0) baseIdx = 0;

      let it = 0;
      const maxIt = Math.max(iterations, n);
      while (it < maxIt && (it < n || Date.now() - t0 < ms)) {
        const det = determinize(view, me, { rand: ctx.rand, reg, policy, candidateDecks: o.candidateDecks });
        let k: number;
        if (it < n) k = it;
        else {
          k = 0;
          let bu = -Infinity;
          for (let i = 0; i < n; i++) {
            const mean = total[i] / visits[i] + (i === baseIdx ? prior : 0);
            const u = mean + C * Math.sqrt(Math.log(it + 1) / visits[i]);
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
      let best = baseIdx;
      let bm = visits[baseIdx] ? total[baseIdx] / visits[baseIdx] + prior : -1;
      for (let i = 0; i < n; i++) {
        if (!visits[i]) continue;
        const m = total[i] / visits[i];
        if (m > bm) {
          bm = m;
          best = i;
        }
      }
      return legal[best];
    },
  };
}
