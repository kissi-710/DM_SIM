// エージェントの共通インターフェース(design 7.1)。
import type { Registry } from '../engine/registry';
import type { Action, GameState } from '../engine/types';
import type { InfoPolicy } from '../engine/view';

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
  /** 情報条件(既定は公平)。ランナーが toPlayerView に渡す */
  policy?: InfoPolicy;
  /** false なら、マスクしていない状態を渡す(ランダムAIなど、隠れた情報を読まないもの) */
  needsView?: boolean;
  chooseAction(view: PlayerView, legal: Action[], ctx: AgentCtx): Action | Promise<Action>;
}
