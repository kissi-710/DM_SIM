// AI同士のバッチ対戦(design 8.1 / spec 7)。試合ごとのシードを seed + i から派生させ、再現できる。
import { makeAgent, type Agent, type AgentSpec } from '../ai';
import { registryOf } from '../engine/engine';
import type { Registry } from '../engine/registry';
import type { CardDB, GameConfig, PlayerId } from '../engine/types';
import { deriveSeed } from '../engine/prng';
import { mulberry, playGameSync } from './playGame';
import { emptyAcc, estimateRate, type RateAcc } from './stats';

/** duplicate: 同じシードの対局を、A の席を入れ替えて2回行う(同じデッキ同士なら配られる手札が同一になり、運の差が打ち消される)。games は偶数 */
export type FirstMode = 'fixed' | 'alternate' | 'random' | 'duplicate';

export interface MatchOpts {
  deckA: string[];
  deckB: string[];
  agentA: AgentSpec;
  agentB: AgentSpec;
  games: number;
  seed: number;
  /** 試合の通し番号の開始位置(範囲を分けて並列に実行する時に、同じ試合が同じシードになるようにする。既定 0) */
  startIndex?: number;
  /** fixed: Aが常に先攻 / alternate: 交互 / random: 乱数 / duplicate: 同じシードで席を入れ替えて2回ずつ */
  first?: FirstMode;
  cfg?: Partial<GameConfig>;
  /** 手を選ぶ思考時間を測って MatchStats.think に入れる(測定用。結果の勝敗には影響しない) */
  timing?: boolean;
  onProgress?: (done: number, total: number) => void;
  shouldCancel?: () => boolean;
}

export interface MatchStats {
  games: number;
  winsA: number;
  winsB: number;
  draws: number;
  /** A の勝率の推定値(引分は 0.5。席で層化・複製対局はペア単位。stats.ts の estimateRate) */
  winRateA: number;
  ci95A: [number, number];
  /** 推定の十分統計量(範囲を分けた実行の統合に使う) */
  acc: RateAcc;
  avgTurns: number;
  /** 先攻側の勝率 */
  firstPlayerWinRate: number;
  /** Aが先攻のとき / 後攻のときのAの勝率 */
  winRateAFirst: number | null;
  winRateASecond: number | null;
  gamesAFirst: number;
  gamesASecond: number;
  ms: number;
  reasons: Record<string, number>;
  /** 手を選ぶ思考の合計時間(ms)と回数(合法手が2つ以上の意思決定)。MatchOpts.timing の時だけ */
  think?: { msA: number; nA: number; msB: number; nB: number };
}

export function runMatches(db: CardDB | Registry, o: MatchOpts): MatchStats {
  const reg = registryOf(db);
  const think = { msA: 0, nA: 0, msB: 0, nB: 0 };
  const timed = (ag: Agent, side: 'A' | 'B'): Agent =>
    o.timing
      ? {
          ...ag,
          chooseAction(v, l, c) {
            const t = performance.now();
            const r = ag.chooseAction(v, l, c);
            if (l.length > 1) {
              think['ms' + side as 'msA' | 'msB'] += performance.now() - t;
              think['n' + side as 'nA' | 'nB']++;
            }
            return r;
          },
        }
      : ag;
  const agentA = timed(makeAgent(o.agentA), 'A');
  const agentB = timed(makeAgent(o.agentB), 'B');
  const first = o.first ?? 'alternate';
  const t0 = Date.now();
  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  let turns = 0;
  let firstWins = 0;
  let aFirstGames = 0;
  let aFirstWins = 0;
  let aSecondGames = 0;
  let aSecondWins = 0;
  const acc = emptyAcc();
  let pairScore = 0;
  const reasons: Record<string, number> = {};
  let done = 0;
  for (let i = 0; i < o.games; i++) {
    if (o.shouldCancel?.()) break;
    // seat0 にだれを置くか
    // random は、試合のシードとは独立に派生した乱数で決める(連続する値の偶奇だと、交互と区別できない)
    // 試合の通し番号(範囲を分けて実行しても、同じ試合は同じ番号になる)
    const idx = (o.startIndex ?? 0) + i;
    const aSeat: PlayerId =
      first === 'alternate' || first === 'duplicate'
        ? ((idx % 2) as PlayerId)
        : first === 'fixed'
          ? 0
          : ((mulberry(deriveSeed(o.seed, idx) ^ 0x7f4a7c15)() < 0.5 ? 0 : 1) as PlayerId);
    const gameSeed = deriveSeed(o.seed, first === 'duplicate' ? idx >> 1 : idx);
    const decks: [string[], string[]] = aSeat === 0 ? [o.deckA, o.deckB] : [o.deckB, o.deckA];
    const agents = aSeat === 0 ? [agentA, agentB] : [agentB, agentA];
    // 先攻は席0
    const r = playGameSync(reg, agents as [typeof agentA, typeof agentB], {
      decks,
      seed: gameSeed,
      first: 0,
      cfg: o.cfg,
    });
    turns += r.turns;
    const rs = r.reason ?? '不明';
    reasons[rs] = (reasons[rs] ?? 0) + 1;
    const aFirst = aSeat === 0;
    if (aFirst) aFirstGames++;
    else aSecondGames++;
    const score = r.winner === 'draw' || r.winner === null ? 0.5 : r.winner === aSeat ? 1 : 0;
    if (aFirst) {
      acc.nF++;
      acc.sF += score;
    } else {
      acc.nS++;
      acc.sS += score;
    }
    if (first === 'duplicate') {
      // 2試合(席を入れ替えた同じシード)で1ペア。範囲の先頭が奇数番号なら、最初の1試合は相方が範囲外なので数えない
      if (idx % 2 === 0) pairScore = score;
      else if (i > 0) {
        const ps = (pairScore + score) / 2;
        acc.m++;
        acc.pSum += ps;
        acc.pSq += ps * ps;
      }
    }
    if (r.winner === 'draw' || r.winner === null) draws++;
    else {
      if (r.winner === 0) firstWins++;
      if (r.winner === aSeat) {
        winsA++;
        if (aFirst) aFirstWins++;
        else aSecondWins++;
      } else winsB++;
    }
    done++;
    o.onProgress?.(done, o.games);
  }
  const n = Math.max(1, done);
  const est = estimateRate(acc);
  return {
    games: done,
    winsA,
    winsB,
    draws,
    winRateA: est.rate,
    ci95A: est.ci,
    acc,
    avgTurns: turns / n,
    firstPlayerWinRate: firstWins / n,
    winRateAFirst: aFirstGames ? aFirstWins / aFirstGames : null,
    winRateASecond: aSecondGames ? aSecondWins / aSecondGames : null,
    gamesAFirst: aFirstGames,
    gamesASecond: aSecondGames,
    ms: Date.now() - t0,
    reasons,
    ...(o.timing ? { think } : {}),
  };
}

export function formatStats(label: string, s: MatchStats): string {
  const pct = (x: number) => (x * 100).toFixed(1) + '%';
  const lines = [
    `■ ${label}`,
    `  試合数 ${s.games} / A勝ち ${s.winsA} / B勝ち ${s.winsB} / 引き分け ${s.draws}`,
    `  Aの勝率 ${pct(s.winRateA)}(95%信頼区間 ${pct(s.ci95A[0])} 〜 ${pct(s.ci95A[1])})`,
    `  先攻の勝率 ${pct(s.firstPlayerWinRate)} / 平均ターン ${s.avgTurns.toFixed(1)} / ${s.ms}ms`,
  ];
  if (s.winRateAFirst !== null) lines.push(`  Aが先攻の時 ${pct(s.winRateAFirst)}(${s.gamesAFirst}試合)`);
  if (s.winRateASecond !== null) lines.push(`  Aが後攻の時 ${pct(s.winRateASecond)}(${s.gamesASecond}試合)`);
  return lines.join('\n');
}
