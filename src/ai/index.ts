// エージェントの生成(設定 → Agent)。UI・CLI・Worker から共通で使う。
import type { InfoPolicy } from '../engine/view';
import type { EvalWeights } from './eval';
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
  /** mcts: 調整用の設定(測定・自己対戦で使う。既定のままなら指定しない) */
  tuning?: AiTuning;
}

export interface AiTuning {
  /** プレイアウトを何ターン先で打ち切るか */
  horizonTurns?: number;
  /** L1 の手に与える事前の上乗せ */
  priorBonus?: number;
  /** 評価関数の重み(差し替える分だけ) */
  weights?: Partial<EvalWeights>;
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
      return makeMcts({ policy: spec.policy, iterations: spec.iterations, ms: spec.ms, candidateDecks: spec.candidateDecks, ...spec.tuning });
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
