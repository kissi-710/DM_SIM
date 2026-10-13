// 1回の意思決定(状態 → 行動)。Worker からも Node からも同じ関数を呼ぶ。
import { legalActions, registryOf } from '../engine/engine';
import type { Action, CardDB, GameState } from '../engine/types';
import { FAIR, toPlayerView } from '../engine/view';
import type { Registry } from '../engine/registry';
import { mulberry } from '../sim/playGame';
import { makeAgent, type AgentSpec } from './index';

export interface DecideReq {
  state: GameState;
  spec: AgentSpec;
  /** 乱数のシード(再現用) */
  seed: number;
  budget?: { iterations?: number; ms?: number };
}

export function decide(db: CardDB | Registry, req: DecideReq): Action {
  const reg = registryOf(db);
  const s = req.state;
  if (!s.pending) throw new Error('入力待ちではありません');
  const legal = legalActions(s, reg);
  if (legal.length === 0) throw new Error('合法手がありません');
  if (legal.length === 1) return legal[0];
  const agent = makeAgent(req.spec);
  const who = s.pending.player;
  const view = agent.needsView === false ? s : toPlayerView(s, who, agent.policy ?? FAIR, reg);
  const a = agent.chooseAction(view, legal, { rand: mulberry(req.seed), reg, budget: req.budget });
  if (a instanceof Promise) throw new Error('非同期のAIは decide では使えません');
  return a;
}
