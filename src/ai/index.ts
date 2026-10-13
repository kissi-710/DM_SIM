// エージェントの生成(設定 → Agent)。UI・CLI・Worker から共通で使う。
import type { InfoPolicy } from '../engine/view';
import { makeMcts } from './mcts';
import { randomAgent } from './random';
import { makeRuleBased } from './rulebased';
import type { Agent } from './types';

export type AgentKind = 'random' | 'rule' | 'mcts';

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
};

export function makeAgent(spec: AgentSpec): Agent {
  switch (spec.kind) {
    case 'random':
      return randomAgent;
    case 'rule':
      return makeRuleBased({ policy: spec.policy, candidateDecks: spec.candidateDecks });
    case 'mcts':
      return makeMcts({ policy: spec.policy, iterations: spec.iterations, ms: spec.ms, candidateDecks: spec.candidateDecks });
  }
}

export { randomAgent, makeRuleBased, makeMcts };
export type { Agent };
