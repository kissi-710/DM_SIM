// 多段階の制御変量(途中の局面の価値関数の予測で、勝敗の分散を減らす)の見込み: ρ²(勝敗と予測の相関の2乗)。
//   npx tsx scripts/cv-probe.ts [試合数] [デッキA] [デッキB]
import { readFileSync } from 'node:fs';
import { CARD_DB, deckCards } from '../src/cards';
import { loadRegistry } from '../src/engine/registry';
import { deriveSeed } from '../src/engine/prng';
import { playGameSync } from '../src/sim/playGame';
import { makeAgent } from '../src/ai';
import { modelProb, type ValueModel } from '../src/ai/valueModel';
import type { PlayerId } from '../src/engine/types';

const reg = loadRegistry(CARD_DB);
const N = Number(process.argv[2] ?? 3000);
const a = deckCards(process.argv[3] ?? 'maruru');
const b = deckCards(process.argv[4] ?? 'zardy');
const { meta: _m, ...model } = JSON.parse(readFileSync('node_modules/.cache/dm-sim/v2.json', 'utf8'));
const rule = makeAgent({ kind: 'rule' });
const TURNS = [3, 4, 5, 6, 8];
const rows: { y: number; v: Record<number, number>; ply: number }[] = [];
for (let i = 0; i < N; i++) {
  const aSeat = (i % 2) as PlayerId;
  const decks: [string[], string[]] = aSeat === 0 ? [a, b] : [b, a];
  const got: Record<number, number> = {};
  const r = playGameSync(reg, [rule, rule], {
    decks,
    seed: deriveSeed(99, i),
    first: 0,
    onStep: (s) => {
      if (s.winner === null && TURNS.includes(s.turn) && got[s.turn] === undefined) got[s.turn] = modelProb(model as ValueModel, s, reg, aSeat);
    },
  });
  rows.push({ y: r.winner === aSeat ? 1 : 0, v: got, ply: r.turns });
}
const corr = (xs: number[], ys: number[]) => {
  const n = xs.length, mx = xs.reduce((p, q) => p + q, 0) / n, my = ys.reduce((p, q) => p + q, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
};
for (const t of TURNS) {
  const rs = rows.filter((r) => r.v[t] !== undefined);
  const c = corr(rs.map((r) => r.v[t]), rs.map((r) => r.y));
  console.log(`ターン${t}開始時の予測: 対象 ${rs.length}/${N} 試合(残りはそれ以前に決着)  ρ=${c.toFixed(3)}  ρ²=${(c * c).toFixed(3)}  → 分散が ${((1 - c * c) * 100).toFixed(0)}% に`);
}
console.log('平均ターン', (rows.reduce((p, r) => p + r.ply, 0) / N).toFixed(1));
