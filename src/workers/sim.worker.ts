// 重い調査(確率・パターン・バッチ・カード強さ)を UI スレッドの外で実行する Worker。
import { CARD_DB } from '../cards';
import { loadRegistry } from '../engine/registry';
import { runMatches, type MatchOpts, type MatchStats } from '../sim/batch';
import { runPatterns, runProbability, type PatternGranularity, type PatternResult, type ProbResult, type SolitaireParams } from '../sim/solitaire';
import { measureCardStrength, type CardStrength } from '../sim/strength';
import type { AgentSpec } from '../ai';

export type SimJob =
  | { type: 'prob'; params: SolitaireParams }
  | { type: 'patterns'; params: SolitaireParams; opts: { granularity: PatternGranularity; maxHistoriesPerTrial: number } }
  | { type: 'batch'; opts: Omit<MatchOpts, 'onProgress' | 'shouldCancel'>[] }
  | { type: 'strength'; deck: string[]; opponent: string[]; agent: AgentSpec; games: number; seed: number };

export type SimOut =
  | { kind: 'progress'; done: number; total: number }
  | { kind: 'result'; job: 'prob'; result: ProbResult }
  | { kind: 'result'; job: 'patterns'; result: PatternResult }
  | { kind: 'result'; job: 'batch'; result: MatchStats[] }
  | { kind: 'result'; job: 'strength'; result: CardStrength[] }
  | { kind: 'error'; message: string };

const reg = loadRegistry(CARD_DB);
let lastPost = 0;
const post = (m: SimOut) => (self as unknown as Worker).postMessage(m);
const progress = (done: number, total: number) => {
  const now = Date.now();
  if (now - lastPost > 80 || done === total) {
    lastPost = now;
    post({ kind: 'progress', done, total });
  }
};

self.onmessage = (e: MessageEvent<SimJob>) => {
  const job = e.data;
  try {
    switch (job.type) {
      case 'prob':
        post({ kind: 'result', job: 'prob', result: runProbability(reg, job.params, { onProgress: progress }) });
        break;
      case 'patterns':
        post({ kind: 'result', job: 'patterns', result: runPatterns(reg, job.params, job.opts, { onProgress: progress }) });
        break;
      case 'batch': {
        const out: MatchStats[] = [];
        job.opts.forEach((o, i) => {
          out.push(
            runMatches(reg, {
              ...o,
              onProgress: (d, t) => progress(i * t + d, job.opts.length * t),
            }),
          );
        });
        post({ kind: 'result', job: 'batch', result: out });
        break;
      }
      case 'strength':
        post({
          kind: 'result',
          job: 'strength',
          result: measureCardStrength(reg, { deck: job.deck, opponent: job.opponent, agent: job.agent, games: job.games, seed: job.seed, onProgress: progress }),
        });
        break;
    }
  } catch (err: any) {
    post({ kind: 'error', message: String(err?.message ?? err) });
  }
};
