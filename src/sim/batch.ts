// AI同士のバッチ対戦(design 8.1 / spec 7)。試合ごとのシードを seed + i から派生させ、再現できる。
import { makeAgent, type AgentSpec } from '../ai';
import { registryOf } from '../engine/engine';
import type { Registry } from '../engine/registry';
import type { CardDB, GameConfig, PlayerId } from '../engine/types';
import { mulberry, playGameSync } from './playGame';
import { wilson } from './stats';

export type FirstMode = 'fixed' | 'alternate' | 'random';

export interface MatchOpts {
  deckA: string[];
  deckB: string[];
  agentA: AgentSpec;
  agentB: AgentSpec;
  games: number;
  seed: number;
  /** fixed: Aが常に先攻 / alternate: 交互 / random: 乱数 */
  first?: FirstMode;
  cfg?: Partial<GameConfig>;
  onProgress?: (done: number, total: number) => void;
  shouldCancel?: () => boolean;
}

export interface MatchStats {
  games: number;
  winsA: number;
  winsB: number;
  draws: number;
  winRateA: number;
  ci95A: [number, number];
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
}

export function runMatches(db: CardDB | Registry, o: MatchOpts): MatchStats {
  const reg = registryOf(db);
  const agentA = makeAgent(o.agentA);
  const agentB = makeAgent(o.agentB);
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
  const reasons: Record<string, number> = {};
  let done = 0;
  for (let i = 0; i < o.games; i++) {
    if (o.shouldCancel?.()) break;
    // seat0 にだれを置くか
    // random は、試合のシードとは独立に派生した乱数で決める(連続する値の偶奇だと、交互と区別できない)
    const aSeat: PlayerId =
      first === 'alternate' ? ((i % 2) as PlayerId) : first === 'fixed' ? 0 : ((mulberry((o.seed + i) ^ 0x7f4a7c15)() < 0.5 ? 0 : 1) as PlayerId);
    const decks: [string[], string[]] = aSeat === 0 ? [o.deckA, o.deckB] : [o.deckB, o.deckA];
    const agents = aSeat === 0 ? [agentA, agentB] : [agentB, agentA];
    // 先攻は席0
    const r = playGameSync(reg, agents as [typeof agentA, typeof agentB], {
      decks,
      seed: o.seed + i,
      first: 0,
      cfg: o.cfg,
    });
    turns += r.turns;
    const rs = r.reason ?? '不明';
    reasons[rs] = (reasons[rs] ?? 0) + 1;
    const aFirst = aSeat === 0;
    if (aFirst) aFirstGames++;
    else aSecondGames++;
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
  return {
    games: done,
    winsA,
    winsB,
    draws,
    winRateA: winsA / n,
    ci95A: wilson(winsA, done),
    avgTurns: turns / n,
    firstPlayerWinRate: firstWins / n,
    winRateAFirst: aFirstGames ? aFirstWins / aFirstGames : null,
    winRateASecond: aSecondGames ? aSecondWins / aSecondGames : null,
    gamesAFirst: aFirstGames,
    gamesASecond: aSecondGames,
    ms: Date.now() - t0,
    reasons,
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
