// 学習した召喚の方針を入れたルールベース 対 現行のルールベース(複製対局)。
//   npx tsx scripts/l1q-rulematch.ts <モデルJSON> [組あたりの対数=300] [シード=1]
import { readFileSync } from 'node:fs';
import { CARD_DB, DECK_PRESETS, deckCards } from '../src/cards';
import { makeRuleBased } from '../src/ai/rulebased';
import { loadRegistry } from '../src/engine/registry';
import { playGameSync } from '../src/sim/playGame';
import { wilson } from '../src/sim/stats';

const reg = loadRegistry(CARD_DB);
const [path, pairsN = '300', seed = '1'] = process.argv.slice(2);
const w = JSON.parse(readFileSync(path, 'utf8')).w as number[];
const A = makeRuleBased({ params: { playModel: w } });
const B = makeRuleBased();
const ids = DECK_PRESETS.map((d) => d.id);
let wins = 0;
let n = 0;
for (const x of ids) {
  for (const y of ids) {
    for (let g = 0; g < Number(pairsN); g++) {
      const sd = Number(seed) * 1000003 + g;
      for (const swap of [false, true]) {
        const r = playGameSync(reg, swap ? [B, A] : [A, B], { decks: [deckCards(x), deckCards(y)], seed: sd, first: 0 });
        if (r.winner === (swap ? 1 : 0)) wins++;
        else if (r.winner === 'draw' || r.winner === null) wins += 0.5;
        n++;
      }
    }
  }
}
const ci = wilson(Math.round(wins), n);
console.log(`合計: A の勝ち ${wins}/${n} = ${((wins / n) * 100).toFixed(1)}%(95%区間 ${(ci[0] * 100).toFixed(1)}〜${(ci[1] * 100).toFixed(1)}%)`);
