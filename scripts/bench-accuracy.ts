// バッチ対戦の精度の測定: 同じ設定を、別のシードで R 回繰り返し、勝率の推定のばらつき(SD)と、
// 報告される信頼区間の幅・被覆率(真の値を含んだ割合。真の値は多数試合で近似)を出す。
//   npx tsx scripts/bench-accuracy.ts [1回の試合数 N] [繰り返し R]
import { CARD_DB, deckCards } from '../src/cards';
import { runMatches, type FirstMode } from '../src/sim/batch';
import { loadRegistry } from '../src/engine/registry';
import { installNativeFromEnv } from '../src/wasm/installNode';

installNativeFromEnv();
const N = Number(process.argv[2] ?? 200);
const R = Number(process.argv[3] ?? 30);
const reg = loadRegistry(CARD_DB);
const cases: [string, string, string][] = [
  ['maruru', 'zardy', '異デッキ'],
  ['zardy', 'zardy', 'ミラー'],
];
const rule = { kind: 'rule' as const };
for (const [a, b, label] of cases) {
  // 真の値: 多数試合(seat 交互)
  const big = runMatches(reg, { deckA: deckCards(a), deckB: deckCards(b), agentA: rule, agentB: rule, games: 6000, seed: 424242, first: 'alternate' });
  const truth = (big.winsA + big.draws * 0.5) / big.games;
  console.log(`■ ${label}(${a} 対 ${b}、rule 同士)真の値 ≈ ${(truth * 100).toFixed(1)}%`);
  for (const first of ['alternate', 'random', 'duplicate'] as FirstMode[]) {
    const est: number[] = [];
    let half = 0;
    let cover = 0;
    for (let r = 0; r < R; r++) {
      const s = runMatches(reg, { deckA: deckCards(a), deckB: deckCards(b), agentA: rule, agentB: rule, games: N, seed: 1000 + r * 7919, first });
      const p = s.winRateA;
      est.push(p);
      half += (s.ci95A[1] - s.ci95A[0]) / 2;
      if (s.ci95A[0] <= truth && truth <= s.ci95A[1]) cover++;
    }
    const m = est.reduce((x, y) => x + y, 0) / R;
    const sd = Math.sqrt(est.reduce((x, y) => x + (y - m) ** 2, 0) / (R - 1));
    console.log(`  ${first.padEnd(9)} SD ${(sd * 100).toFixed(2)}pt  報告の区間の半幅 ${((half / R) * 100).toFixed(2)}pt  被覆率 ${((cover / R) * 100).toFixed(0)}%`);
  }
}
