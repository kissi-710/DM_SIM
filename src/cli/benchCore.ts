// AI の強さの測定(モンテカルロ探索 対 基準のAI)。バッチ対戦を、デッキの組ごとに並列で実行して集計する。
// 同じシード・同じ組なら、並列数によらず同じ結果になる(sim/jobs.ts)。AI の変更の前後を比べる時は、同じ条件で測る。
import { deckCards } from '../cards';
import type { AgentSpec, AiTuning } from '../ai';
import type { MatchStats } from '../sim/batch';
import { wilson } from '../sim/stats';
import { runParallel } from './parallel';

export interface BenchOpts {
  /** 試合数(デッキの組ごと) */
  games: number;
  seed: number;
  /** A(測る側)の反復回数 */
  iterations: number;
  /** A の調整 */
  tuning?: AiTuning;
  /** B(基準)。既定はルールベース */
  opponent?: AgentSpec;
  /** デッキの組(A のデッキ, B のデッキ) */
  pairs?: [string, string][];
  jobs?: number;
}

export const DEFAULT_PAIRS: [string, string][] = [
  ['maruru', 'maruru'],
  ['zardy', 'zardy'],
  ['maruru', 'zardy'],
  ['zardy', 'maruru'],
];

export interface BenchResult {
  wins: number;
  games: number;
  rate: number;
  ci95: [number, number];
  ms: number;
  pairs: { deckA: string; deckB: string; wins: number; games: number; draws: number }[];
}

export async function benchAi(o: BenchOpts): Promise<BenchResult> {
  const pairs = o.pairs ?? DEFAULT_PAIRS;
  const t0 = Date.now();
  const stats = (await runParallel(
    {
      type: 'batch',
      opts: pairs.map(([a, b]) => ({
        deckA: deckCards(a),
        deckB: deckCards(b),
        agentA: { kind: 'mcts', iterations: o.iterations, tuning: o.tuning },
        agentB: o.opponent ?? { kind: 'rule' },
        games: o.games,
        seed: o.seed,
        first: 'alternate',
      })),
    },
    o.jobs,
  )) as MatchStats[];
  let wins = 0;
  let games = 0;
  const per = stats.map((s, i) => {
    wins += s.winsA + s.draws * 0.5;
    games += s.games;
    return { deckA: pairs[i][0], deckB: pairs[i][1], wins: s.winsA, games: s.games, draws: s.draws };
  });
  return { wins, games, rate: wins / games, ci95: wilson(Math.round(wins), games), ms: Date.now() - t0, pairs: per };
}

export function formatBench(r: BenchResult): string {
  const lines = r.pairs.map((p) => `  ${p.deckA}(A) vs ${p.deckB}(B): ${p.wins}/${p.games}${p.draws ? ` 引分${p.draws}` : ''} = ${((p.wins / p.games) * 100).toFixed(1)}%`);
  lines.push(`  合計: ${r.wins}/${r.games} = ${(r.rate * 100).toFixed(1)}%(95%区間 ${(r.ci95[0] * 100).toFixed(1)}〜${(r.ci95[1] * 100).toFixed(1)}%) ${(r.ms / 1000).toFixed(0)}秒`);
  return lines.join('\n');
}
