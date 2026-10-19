// エージェントの生成(設定 → Agent)。UI・CLI・Worker から共通で使う。
import type { InfoPolicy } from '../engine/view';
import type { RewardWeights } from './eval';
import { makeMcts, type TreeOpts } from './mcts';
import { DEFAULT_TREE_OPTS, makeTreeMcts } from './tree';
import { randomAgent } from './random';
import type { L1Params } from './l1params';
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
  /** rule: 優先度・しきい値の調整値(自己対戦での調整・比較用。既定のままなら指定しない) */
  l1?: Partial<L1Params>;
}

export interface AiTuning {
  /** プレイアウトを何ターン先で打ち切るか */
  horizonTurns?: number;
  /** マナチャージの判断だけ、先読みのターン数を変える(どのカードをマナに置くかは、数ターン先で効く)。未指定なら horizonTurns */
  chargeHorizon?: number;
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
  /** 劣る手を外す判定の厳しさ(既定 2.5) */
  elimZ?: number;
  /** 近い手の比較を打ち切る精度(報酬の単位。小さいほど、僅差の判断に長く考える。既定 0.012) */
  precision?: number;
  /** 時間主導の探索で、1位と2位の判定による早期終了をしない反復数の下限(僅差の判断に、最低限これだけは考えさせる。既定 0) */
  minIterations?: number;
  /** 予算を段階に分け、段階ごとに下位の半分を外す(反復回数を決めた時) */
  halving?: boolean;
  /** 学習した価値関数のファイル(測定用。仕様文字列 value=<path> で指定する) */
  modelPath?: string;
}

/** 探索の方式の既定(docs/ai-quality-plan.md §6.4 の結果で決める) */
export const DEFAULT_ALGO: NonNullable<AiTuning['algo']> = 'ptree';

/** ペア比較の木(algo=ptree)の設定。それ以外は undefined */
export function treeOptsOf(t: AiTuning | undefined): TreeOpts | undefined {
  if ((t?.algo ?? DEFAULT_ALGO) !== 'ptree') return undefined;
  return { c: t?.treeC ?? DEFAULT_TREE_OPTS.c, maxDepth: t?.treeDepth ?? DEFAULT_TREE_OPTS.maxDepth };
}

/**
 * 「強い」CPU の設定(docs/ai-replay-analysis.md)。手を外す判定をせず(elimZ=99)、近い手の比較を細かい精度まで続ける(precision=0.003)。
 * 時間主導(ms)の探索に重ねると、通常の設定に 56.8%(960 試合、区間 53.6〜59.9%)で勝つ。1 手の平均は約 675ms(通常の約 18 倍)。
 * 1 手の上限(ms)を小さくすると、強さも落ちる(既定の 1200ms 以上を勧める)。
 */
export const STRONG_TUNING: Pick<AiTuning, 'elimZ' | 'precision'> = { elimZ: 99, precision: 0.003 };

/** mcts の設定に、「強い」CPU の設定を重ねる(spec.tuning に明示した値が優先)。mcts 以外はそのまま */
export function withStrong(spec: AgentSpec): AgentSpec {
  return spec.kind === 'mcts' ? { ...spec, tuning: { ...STRONG_TUNING, ...spec.tuning } } : spec;
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
      return makeRuleBased({ policy: spec.policy, candidateDecks: spec.candidateDecks, params: spec.l1 });
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
