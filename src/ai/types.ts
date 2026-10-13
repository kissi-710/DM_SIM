// エージェントの共通インターフェース(design 7.1)。
import type { Action, GameState } from '../engine/types';
import type { Registry } from '../engine/registry';

/** 自分から見える情報(隠れたカードの defId は '?')。形は GameState と同じ。 */
export type PlayerView = GameState;

export interface AgentCtx {
  /** 0〜1 の乱数 */
  rand: () => number;
  reg: Registry;
  budget?: { iterations?: number; ms?: number };
}

export interface Agent {
  name: string;
  chooseAction(view: PlayerView, legal: Action[], ctx: AgentCtx): Action | Promise<Action>;
}
