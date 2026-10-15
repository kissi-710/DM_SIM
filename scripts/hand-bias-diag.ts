// 相手の手札は、未公開カードの一様サンプルより高コスト側に偏るか(決定化の信念の診断)。
//   npx tsx scripts/hand-bias-diag.ts [局面数]
// 実際の相手の手札の平均コストと、未公開カード全体(手札+シールド+山札)の平均コストを比べる。
import { CARD_DB, DECK_PRESETS, deckCards } from '../src/cards';
import { loadRegistry } from '../src/engine/registry';
import { collectPositions } from '../src/sim/aiEval';
import { toPlayerView, FAIR } from '../src/engine/view';
import type { PlayerId } from '../src/engine/types';

const reg = loadRegistry(CARD_DB);
const N = Number(process.argv[2] ?? 1500);
const pairs = [];
for (const x of DECK_PRESETS) for (const y of DECK_PRESETS) pairs.push({ id: `${x.id}/${y.id}`, a: deckCards(x.id), b: deckCards(y.id) });
const pos = collectPositions(reg, pairs, N, 4242);
const costOf = (d: string) => {
  const f = reg.defs[d]?.faces[0] as { cost?: number } | undefined;
  return f?.cost ?? 0;
};
let n = 0;
let dHand = 0;
let dSq = 0;
const byTurn: Record<string, { n: number; d: number }> = {};
for (const p of pos) {
  const s = p.state;
  if (!s.pending || s.turn < 3) continue;
  const who = s.pending.player as PlayerId;
  const opp = (1 - who) as PlayerId;
  const view = toPlayerView(s, who, FAIR, reg);
  const z = s.players[opp];
  const hand = z.hand.filter((u) => view.cards[u].defId === '?');
  if (hand.length === 0) continue;
  const unseen = [...z.hand, ...z.shield, ...z.deck].filter((u) => view.cards[u].defId === '?');
  const m = (us: number[]) => us.reduce((a, u) => a + costOf(s.cards[u].defId), 0) / us.length;
  const d = m(hand) - m(unseen);
  n++;
  dHand += d;
  dSq += d * d;
  const k = s.turn <= 5 ? '3-5' : s.turn <= 8 ? '6-8' : '9+';
  (byTurn[k] ??= { n: 0, d: 0 }).n++;
  byTurn[k].d += d;
}
const mean = dHand / n;
const se = Math.sqrt(dSq / n - mean * mean) / Math.sqrt(n);
console.log(`局面 ${n}: 相手の手札の平均コスト − 未公開全体の平均コスト = ${mean.toFixed(3)}(±${(1.96 * se).toFixed(3)})`);
for (const [k, v] of Object.entries(byTurn)) console.log(`  ターン${k}: ${(v.d / v.n).toFixed(3)}(${v.n}局面)`);
