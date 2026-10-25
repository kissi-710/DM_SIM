// 同じ攻撃を何度も選び続けて、ターンが終わらない(試合が止まらない)のを防ぐ。
// 攻撃したあとにアンタップするクリーチャーなどで、結果が変わらない攻撃(ブロックされる・相打ちにならない)を、探索が毎回「END_TURN と同じ価値」と見て選び続けることがある
// (再クロスと同じ種類。mcts.ts の dropRecross)。同じ(攻撃者, 対象)の攻撃を、1 ターンに上限回までにする。
// クリーチャーへの攻撃は、1 回で決着するので 2 回まで。プレイヤーへの攻撃は、シールドを順に割る正当な連続攻撃があるので 8 回まで。
import type { Action } from '../engine/types';
import type { Agent } from './types';

const LIMIT_CREATURE = 2;
const LIMIT_PLAYER = 8;

type TurnView = { turn?: number };
const keyOf = (a: Extract<Action, { type: 'ATTACK' }>) => `${a.attacker}>${a.target.kind === 'player' ? 'p' : a.target.pid}`;

export function withLoopGuard(agent: Agent): Agent {
  let turn = -1;
  let seen = new Map<string, number>();
  const sync = (view: TurnView) => {
    const t = view.turn ?? 0;
    if (t !== turn) {
      turn = t;
      seen = new Map();
    }
  };
  const note = (a: Action) => {
    if (a.type === 'ATTACK') seen.set(keyOf(a), (seen.get(keyOf(a)) ?? 0) + 1);
    return a;
  };
  return {
    ...agent,
    chooseAction(view, legal, ctx) {
      sync(view as TurnView);
      if (seen.size > 0) {
        const out = legal.filter((a) => !(a.type === 'ATTACK' && (seen.get(keyOf(a)) ?? 0) >= (a.target.kind === 'player' ? LIMIT_PLAYER : LIMIT_CREATURE)));
        if (out.length > 0) legal = out;
      }
      const r = agent.chooseAction(view, legal, ctx);
      return r instanceof Promise ? r.then(note) : note(r);
    },
  };
}
