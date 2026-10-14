// 重い調査(確率・パターン・バッチ・カード強さ)の「ジョブ」。実行・分割・統合をまとめる。
//  - runJob: 1つのジョブをその場で実行する(Worker の中身・テスト・CLI 共通)
//  - planJob: ジョブを独立な小さなジョブ(チャンク)に分け、結果を統合する merge を返す。
//    試合・試行はシードが seed + i で独立なので、範囲を分けて実行しても、統合した結果は直列実行と一致する。
import type { AgentSpec } from '../ai';
import type { Registry } from '../engine/registry';
import { runMatches, type MatchOpts, type MatchStats } from './batch';
import {
  runPatterns,
  runProbability,
  type Pattern,
  type PatternGranularity,
  type PatternResult,
  type ProbResult,
  type SolitaireParams,
} from './solitaire';
import { wilson } from './stats';
import { composeStrength, strengthVariants, type CardStrength } from './strength';

export type MatchJobOpts = Omit<MatchOpts, 'onProgress' | 'shouldCancel'>;

export type SimJob =
  | { type: 'prob'; params: SolitaireParams }
  | { type: 'patterns'; params: SolitaireParams; opts: { granularity: PatternGranularity; maxHistoriesPerTrial: number } }
  | { type: 'batch'; opts: MatchJobOpts[] }
  | { type: 'strength'; deck: string[]; opponent: string[]; agent: AgentSpec; games: number; seed: number };

export type JobResult = ProbResult | PatternResult | MatchStats[] | CardStrength[];

export type SimOut =
  | { kind: 'progress'; done: number; total: number }
  | { kind: 'result'; job: 'prob'; result: ProbResult }
  | { kind: 'result'; job: 'patterns'; result: PatternResult }
  | { kind: 'result'; job: 'batch'; result: MatchStats[] }
  | { kind: 'result'; job: 'strength'; result: CardStrength[] }
  | { kind: 'error'; message: string };

type Progress = (done: number, total: number) => void;

// ───────────────────────── 実行 ─────────────────────────

export function runJob(reg: Registry, job: SimJob, onProgress?: Progress): JobResult {
  switch (job.type) {
    case 'prob':
      return runProbability(reg, job.params, { onProgress });
    case 'patterns':
      return runPatterns(reg, job.params, job.opts, { onProgress });
    case 'batch': {
      const total = job.opts.reduce((t, o) => t + o.games, 0);
      let base = 0;
      return job.opts.map((o) => {
        const b = base;
        const r = runMatches(reg, { ...o, onProgress: (d) => onProgress?.(b + d, total) });
        base += o.games;
        return r;
      });
    }
    case 'strength': {
      const { decks } = strengthVariants(job.deck);
      const total = (decks.length + 1) * job.games;
      let base = 0;
      const run = (deckA: string[]) => {
        const b = base;
        const r = runMatches(reg, {
          deckA,
          deckB: job.opponent,
          agentA: job.agent,
          agentB: job.agent,
          games: job.games,
          seed: job.seed,
          first: 'alternate',
          onProgress: (d) => onProgress?.(b + d, total),
        });
        base += job.games;
        return r.winRateA;
      };
      const baseRate = run(job.deck);
      const rates = decks.map(run);
      return composeStrength(reg, job, baseRate, rates);
    }
  }
}

// ───────────────────────── 分割 ─────────────────────────

export interface JobPlan {
  /** 独立に実行できる小さなジョブ */
  chunks: SimJob[];
  /** 各チャンクの進捗の単位数(試合数・試行数) */
  units: number[];
  /** チャンクの結果(chunks と同じ並び)を、元のジョブの結果に統合する。ms は実時間で上書きできる */
  merge(results: JobResult[], ms?: number): JobResult;
}

/** total を parts 個程度に分ける(各片は 1 以上)。even なら、最後以外の片を偶数にする(先攻後攻の交互の位相を保つ) */
export function splitCounts(total: number, parts: number, even = false): number[] {
  if (total <= 0) return [];
  const unit = even ? 2 : 1;
  const pieces = Math.max(1, Math.min(parts, Math.ceil(total / unit)));
  const per = Math.ceil(total / unit / pieces) * unit;
  const out: number[] = [];
  let left = total;
  while (left > 0) {
    const n = Math.min(per, left);
    out.push(n);
    left -= n;
  }
  return out;
}

/** 分割後の片の、元の並びでの開始位置 */
const starts = (sizes: number[]): number[] => {
  let t = 0;
  return sizes.map((n) => {
    const s = t;
    t += n;
    return s;
  });
};

/** 分割に必要なのはカード名の解決だけ(強さの統合)。メインスレッドでは CARD_DB を {defs} として渡せる */
export function planJob(reg: Pick<Registry, 'defs'>, job: SimJob, parts: number): JobPlan {
  const plan = planChunks(reg, job, parts);
  // 試行・試合が0なら、そのまま1つのジョブとして実行する
  if (plan.chunks.length === 0) return { chunks: [job], units: [1], merge: (r) => r[0] };
  return plan;
}

function planChunks(reg: Pick<Registry, 'defs'>, job: SimJob, parts: number): JobPlan {
  switch (job.type) {
    case 'prob': {
      const sizes = splitCounts(job.params.trials, parts);
      const st = starts(sizes);
      const chunks: SimJob[] = sizes.map((n, i) => ({ type: 'prob', params: { ...job.params, trials: n, seed: job.params.seed + st[i] } }));
      return { chunks, units: sizes, merge: (r, ms) => mergeProb(r as ProbResult[], ms) };
    }
    case 'patterns': {
      const sizes = splitCounts(job.params.trials, parts);
      const st = starts(sizes);
      const chunks: SimJob[] = sizes.map((n, i) => ({
        type: 'patterns',
        params: { ...job.params, trials: n, seed: job.params.seed + st[i] },
        opts: job.opts,
      }));
      return { chunks, units: sizes, merge: (r, ms) => mergePatterns(r as PatternResult[], ms) };
    }
    case 'batch': {
      // 設定ごとに、試合の範囲を分ける
      const per = Math.max(1, Math.ceil(parts / Math.max(1, job.opts.length)));
      const chunks: SimJob[] = [];
      const units: number[] = [];
      const owner: number[] = [];
      job.opts.forEach((o, k) => {
        const sizes = splitCounts(o.games, per, true);
        const st = starts(sizes);
        sizes.forEach((n, i) => {
          chunks.push({ type: 'batch', opts: [{ ...o, games: n, seed: o.seed + st[i] }] });
          units.push(n);
          owner.push(k);
        });
      });
      return {
        chunks,
        units,
        merge: (r, ms) => job.opts.map((_, k) => mergeMatches(r.flatMap((x, i) => (owner[i] === k ? (x as MatchStats[]) : [])), ms)),
      };
    }
    case 'strength': {
      // 基準デッキと各変種を、それぞれ1チャンクにする
      const { decks } = strengthVariants(job.deck);
      const mk = (deckA: string[]): SimJob => ({
        type: 'batch',
        opts: [{ deckA, deckB: job.opponent, agentA: job.agent, agentB: job.agent, games: job.games, seed: job.seed, first: 'alternate' }],
      });
      const chunks = [job.deck, ...decks].map(mk);
      return {
        chunks,
        units: chunks.map(() => job.games),
        merge: (r) => {
          const rates = (r as MatchStats[][]).map((x) => x[0].winRateA);
          return composeStrength(reg, job, rates[0], rates.slice(1));
        },
      };
    }
  }
}

// ───────────────────────── 統合 ─────────────────────────

export function mergeMatches(parts: MatchStats[], ms?: number): MatchStats {
  let games = 0;
  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  let turns = 0;
  let firstWins = 0;
  let aFirstGames = 0;
  let aFirstWins = 0;
  let aSecondGames = 0;
  let aSecondWins = 0;
  let msSum = 0;
  const reasons: Record<string, number> = {};
  for (const p of parts) {
    games += p.games;
    winsA += p.winsA;
    winsB += p.winsB;
    draws += p.draws;
    // 平均・割合は整数の合計から作られているので、元の個数に戻せる
    turns += Math.round(p.avgTurns * Math.max(1, p.games));
    firstWins += Math.round(p.firstPlayerWinRate * Math.max(1, p.games));
    aFirstGames += p.gamesAFirst;
    aSecondGames += p.gamesASecond;
    aFirstWins += Math.round((p.winRateAFirst ?? 0) * p.gamesAFirst);
    aSecondWins += Math.round((p.winRateASecond ?? 0) * p.gamesASecond);
    msSum += p.ms;
    for (const [k, v] of Object.entries(p.reasons)) reasons[k] = (reasons[k] ?? 0) + v;
  }
  const n = Math.max(1, games);
  return {
    games,
    winsA,
    winsB,
    draws,
    winRateA: winsA / n,
    ci95A: wilson(winsA, games),
    avgTurns: turns / n,
    firstPlayerWinRate: firstWins / n,
    winRateAFirst: aFirstGames ? aFirstWins / aFirstGames : null,
    winRateASecond: aSecondGames ? aSecondWins / aSecondGames : null,
    gamesAFirst: aFirstGames,
    gamesASecond: aSecondGames,
    ms: ms ?? msSum,
    reasons,
  };
}

export function mergeProb(parts: ProbResult[], ms?: number): ProbResult {
  const maxTurns = parts[0].maxTurns;
  const hits: number[] = new Array(maxTurns + 1).fill(0);
  let trials = 0;
  let achieved = 0;
  let sAchieved = 0;
  let sUnknown = 0;
  let sNodes = 0;
  let msSum = 0;
  const hasSearch = parts.every((p) => p.search);
  for (const p of parts) {
    trials += p.trials;
    achieved += p.policy.achieved;
    p.policy.byTurn.forEach((r, t) => (hits[t] += Math.round(r * Math.max(1, p.trials))));
    if (p.search) {
      sAchieved += p.search.achieved;
      sUnknown += p.search.unknown;
      sNodes += Math.round(p.search.avgNodes * Math.max(1, p.trials));
    }
    msSum += p.ms;
  }
  const n = Math.max(1, trials);
  const judged = trials - sUnknown;
  return {
    trials,
    maxTurns,
    policy: {
      achieved,
      rate: achieved / n,
      ci95: wilson(achieved, trials),
      byTurn: hits.map((c) => c / n),
      turnDist: hits.map((c, t) => (t === 0 ? c / n : (c - hits[t - 1]) / n)),
    },
    search: hasSearch
      ? {
          achieved: sAchieved,
          unknown: sUnknown,
          judged,
          rate: judged > 0 ? sAchieved / judged : 0,
          ci95: wilson(sAchieved, Math.max(1, judged)),
          avgNodes: sNodes / n,
          maxRate: (sAchieved + sUnknown) / n,
        }
      : undefined,
    exact: parts[0].exact,
    ms: ms ?? msSum,
  };
}

export function mergePatterns(parts: PatternResult[], ms?: number): PatternResult {
  let trials = 0;
  let achieved = 0;
  let unknown = 0;
  let msSum = 0;
  type Acc = { pat: Pattern; count: number; hands: Map<string, number> };
  const map = new Map<string, Acc>();
  for (const p of parts) {
    trials += p.trials;
    achieved += p.achievedTrials;
    unknown += p.unknownTrials;
    msSum += p.ms;
    for (const pat of p.patterns) {
      let a = map.get(pat.key);
      if (!a) {
        a = { pat, count: 0, hands: new Map() };
        map.set(pat.key, a);
      }
      a.count += pat.count;
      for (const [k, f] of Object.entries(pat.handFreq)) a.hands.set(k, (a.hands.get(k) ?? 0) + Math.round(f * pat.count));
    }
  }
  const n = Math.max(1, trials);
  const patterns: Pattern[] = [...map.values()]
    .map((a) => {
      const handFreq: Record<string, number> = {};
      for (const [k, v] of a.hands) handFreq[k] = v / a.count;
      return {
        key: a.pat.key,
        turns: a.pat.turns,
        count: a.count,
        ratioAll: a.count / n,
        ratioAchieved: achieved ? a.count / achieved : 0,
        sampleSeed: a.pat.sampleSeed,
        sampleActions: a.pat.sampleActions,
        handFreq,
      };
    })
    .sort((x, y) => y.count - x.count);
  return { trials, achievedTrials: achieved, unknownTrials: unknown, patterns, ms: ms ?? msSum };
}
