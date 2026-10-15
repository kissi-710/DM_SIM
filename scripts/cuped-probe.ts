// 分散削減(回帰調整)の見込みの測定: 開始時の状態の特徴量で、勝敗をどれだけ説明できるか(R²)。
//   npx tsx scripts/cuped-probe.ts [試合数]
import { CARD_DB, deckCards } from '../src/cards';
import { createGame } from '../src/engine/engine';
import { loadRegistry } from '../src/engine/registry';
import { deriveSeed } from '../src/engine/prng';
import { playGameSync } from '../src/sim/playGame';
import { makeAgent } from '../src/ai';
import type { GameState, PlayerId } from '../src/engine/types';

const reg = loadRegistry(CARD_DB);
const N = Number(process.argv[2] ?? 4000);
const a = deckCards(process.argv[3] ?? 'maruru');
const b = deckCards(process.argv[4] ?? 'zardy');
const rule = makeAgent({ kind: 'rule' });

function feats(s: GameState, p: PlayerId): number[] {
  const z = s.players[p];
  const info = (u: number) => reg.defs[s.cards[u].defId].faces[0] as { cost: number; type: string };
  const seen = [...z.hand, ...z.deck.slice(0, 5)]; // 初手 + 最初の数ターンの引き
  const cost = (u: number) => info(u).cost;
  const cheap = seen.filter((u) => cost(u) <= 3).length;
  const mid = seen.filter((u) => cost(u) >= 4 && cost(u) <= 5).length;
  const big = seen.filter((u) => cost(u) >= 6).length;
  const spell = seen.filter((u) => info(u).type === 'spell').length;
  const shieldCost = z.shield.reduce((x, u) => x + cost(u), 0) / Math.max(1, z.shield.length);
  return [cheap, mid, big, spell, shieldCost];
}
const X: number[][] = [];
const Y: number[] = [];
for (let i = 0; i < N; i++) {
  const aSeat = (i % 2) as PlayerId;
  const decks: [string[], string[]] = aSeat === 0 ? [a, b] : [b, a];
  const seed = deriveSeed(99, i);
  const { state } = createGame(reg, { decks, seed, first: 0 });
  const r = playGameSync(reg, [rule, rule], { decks, seed, first: 0 });
  const fa = feats(state, aSeat);
  const fb = feats(state, (1 - aSeat) as PlayerId);
  X.push([1, aSeat === 0 ? 1 : 0, ...fa.map((v, k) => v - fb[k])]);
  Y.push(r.winner === aSeat ? 1 : 0);
}
// OLS(正規方程式)
const k = X[0].length;
const A = Array.from({ length: k }, () => new Array(k).fill(0));
const B = new Array(k).fill(0);
for (let i = 0; i < N; i++) for (let p = 0; p < k; p++) { B[p] += X[i][p] * Y[i]; for (let q = 0; q < k; q++) A[p][q] += X[i][p] * X[i][q]; }
for (let p = 0; p < k; p++) A[p][p] += 1e-6;
// ガウスの消去
const M = A.map((row, i) => [...row, B[i]]);
for (let c = 0; c < k; c++) {
  let piv = c; for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
  [M[c], M[piv]] = [M[piv], M[c]];
  for (let r = 0; r < k; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let q = c; q <= k; q++) M[r][q] -= f * M[c][q]; }
}
const beta = M.map((row, i) => row[k] / row[i]);
const mean = Y.reduce((x, y) => x + y, 0) / N;
let ssT = 0, ssR = 0;
for (let i = 0; i < N; i++) { const pred = X[i].reduce((s, v, j) => s + v * beta[j], 0); ssT += (Y[i] - mean) ** 2; ssR += (Y[i] - pred) ** 2; }
console.log(`N=${N} ${process.argv[3] ?? 'maruru'} 対 ${process.argv[4] ?? 'zardy'}: A勝率 ${(mean * 100).toFixed(1)}%  R²(席+特徴量) = ${(1 - ssR / ssT).toFixed(3)}  → 分散 ${(ssR / ssT * 100).toFixed(1)}% に`);
// 席だけ
const seat = [0, 0, 0, 0]; // 先攻/後攻の勝率
for (let i = 0; i < N; i++) { const s = X[i][1]; seat[s * 2] += Y[i]; seat[s * 2 + 1]++; }
const pr = (w: number, n: number) => w / n;
let ssS = 0; for (let i = 0; i < N; i++) { const s = X[i][1]; const pr_ = pr(seat[s * 2], seat[s * 2 + 1]); ssS += (Y[i] - pr_) ** 2; }
console.log(`  席だけ: R² = ${(1 - ssS / ssT).toFixed(3)}`);
