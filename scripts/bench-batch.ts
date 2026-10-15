// バッチ対戦の速度の測定(1スレッド・同一プロセス)。
//   npx tsx scripts/bench-batch.ts [rule|random|mcts] [games] [first]
// 出力: 試合/秒、1試合の平均ミリ秒、勝敗の要約(最適化の前後で勝敗が変わらないことの確認用)。
import { CARD_DB, deckCards } from '../src/cards';
import { runMatches } from '../src/sim/batch';
import { loadRegistry } from '../src/engine/registry';
import { installNativeFromEnv } from '../src/wasm/installNode';
import type { FirstMode } from '../src/sim/batch';
import type { AgentKind } from '../src/ai';

installNativeFromEnv();
const kind = (process.argv[2] ?? 'rule') as AgentKind;
const games = Number(process.argv[3] ?? 1000);
const first = (process.argv[4] ?? 'alternate') as FirstMode;
const reg = loadRegistry(CARD_DB);
const spec = kind === 'mcts' ? { kind, iterations: 120 } : { kind };
const other = kind === 'mcts' ? { kind: 'rule' as const } : spec;
const pairs: [string, string][] = [['maruru', 'zardy'], ['zardy', 'lost-maruru'], ['lost-maruru', 'maruru'], ['interstellar-maruru', 'zardy']];
let g = 0;
let wins = 0;
let turns = 0;
const t0 = performance.now();
const c0 = process.cpuUsage();
for (const [a, b] of pairs) {
  const s = runMatches(reg, { deckA: deckCards(a), deckB: deckCards(b), agentA: spec, agentB: other, games: games / pairs.length, seed: 7, first });
  g += s.games;
  wins += s.winsA;
  turns += s.avgTurns * s.games;
}
const ms = performance.now() - t0;
const cpu = process.cpuUsage(c0);
const cpuMs = (cpu.user + cpu.system) / 1000;
console.log(`${kind}: ${g} 試合 ${ms.toFixed(0)}ms = ${((g / ms) * 1000).toFixed(0)} 試合/秒(${(ms / g).toFixed(2)} ms/試合、CPU ${(cpuMs / g).toFixed(2)} ms/試合) A勝ち ${wins} 平均ターン ${(turns / g).toFixed(2)}`);
