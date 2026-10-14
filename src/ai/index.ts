// エージェントの生成(設定 → Agent)。UI・CLI・Worker から共通で使う。
import type { InfoPolicy } from '../engine/view';
import type { RewardWeights } from './eval';
import { makeMcts, type TreeOpts } from './mcts';
import { DEFAULT_TREE_OPTS, makeTreeMcts } from './tree';
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
  weights?: Partial<RewardWeights>;
  /** flat: 全候補手を同じ世界で比べる平坦なモンテカルロ(既定) / tree: ターン内の行動列を木にする(決定化つき UCT) / ptree: 根はペア比較のまま、2手目以降を木にする */
  algo?: 'flat' | 'tree' | 'ptree';
  /** tree: UCB の探索定数 */
  treeC?: number;
  /** tree: 木の深さの上限 */
  treeDepth?: number;
}

/** 探索の方式の既定(docs/ai-quality-plan.md §6.4 の結果で決める) */
export const DEFAULT_ALGO: NonNullable<AiTuning['algo']> = 'ptree';

/** ペア比較の木(algo=ptree)の設定。それ以外は undefined */
export function treeOptsOf(t: AiTuning | undefined): TreeOpts | undefined {
  if ((t?.algo ?? DEFAULT_ALGO) !== 'ptree') return undefined;
  return { c: t?.treeC ?? DEFAULT_TREE_OPTS.c, maxDepth: t?.treeDepth ?? DEFAULT_TREE_OPTS.maxDepth };
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
    case 'mcts': {
      const { algo = DEFAULT_ALGO, treeC, treeDepth, ...tuning } = spec.tuning ?? {};
      const base = { policy: spec.policy, iterations: spec.iterations, ms: spec.ms, candidateDecks: spec.candidateDecks, ...tuning };
      return algo === 'tree' || algo === 'ptree' ? makeTreeMcts({ ...base, c: treeC, maxDepth: treeDepth, paired: algo === 'ptree' }) : makeMcts(base);
    }
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
