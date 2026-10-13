// エージェントの生成(設定 → Agent)。UI・CLI・Worker から共通で使う。
import type { InfoPolicy } from '../engine/view';
import { makeMcts } from './mcts';
import { randomAgent } from './random';
import { makeRuleBased } from './rulebased';
import type { Agent } from './types';

export type AgentKind = 'random' | 'rule' | 'mcts' | 'pass';

export interface AgentSpec {
  kind: AgentKind;
  policy?: InfoPolicy;
  /** mcts: 反復回数・時間(ms) */
  iterations?: number;
  ms?: number;
  candidateDecks?: string[][];
}

export const AGENT_LABEL: Record<AgentKind, string> = {
  random: 'ランダム',
  rule: 'ルールベース',
  mcts: 'モンテカルロ探索',
  pass: 'パス(何もしない)',
};

export function makeAgent(spec: AgentSpec): Agent {
  switch (spec.kind) {
    case 'random':
      return randomAgent;
    case 'pass':
      return passAgent;
    case 'rule':
      return makeRuleBased({ policy: spec.policy, candidateDecks: spec.candidateDecks });
    case 'mcts':
      return makeMcts({ policy: spec.policy, iterations: spec.iterations, ms: spec.ms, candidateDecks: spec.candidateDecks });
  }
}

/** 何もしない(マナチャージも使用もしない)。引く確率の検算用 */
export const passAgent: Agent = {
  name: 'パス',
  needsView: false,
  chooseAction(_v, legal) {
    return (
      legal.find((a) => a.type === 'SKIP_MANA') ??
      legal.find((a) => a.type === 'END_TURN') ??
      legal.find((a) => a.type === 'END_MAIN') ??
      legal[0]
    );
  },
};

export { randomAgent, makeRuleBased, makeMcts };
export type { Agent };
