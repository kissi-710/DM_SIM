// L1 の方針改善の実験: 学習した方針(ターン中の行動のみ。効果の選択は L1)対 現行の L1 を、複製対局で測る。
//   npx tsx scripts/l1q-match.ts <モデルJSON> [組あたりの対数=300] [シード=1] [基準のモデルJSON]
import { readFileSync } from 'node:fs';
import { CARD_DB, DECK_PRESETS, deckCards } from '../src/cards';
import { makeRuleBased } from '../src/ai/rulebased';
import { chooseConservative } from '../src/ai/l1learn';
import { legalActions } from '../src/engine/engine';
import { loadRegistry } from '../src/engine/registry';
import { playGameSync } from '../src/sim/playGame';
import { wilson } from '../src/sim/stats';
import type { Agent } from '../src/ai/types';

const reg = loadRegistry(CARD_DB);
// モデルは 'play=<json>,attack=<json>' の形(判断の種類ごと)。基準側は 2 つ目の同じ形(省略で L1)
const [modelsArg, pairsN = '300', seed = '1', baseArg = '', minTurnArg = '0', minOppShieldArg = '0'] = process.argv.slice(2);
const minOppShield = Number(minOppShieldArg);
const DELTA = Number(process.env.DELTA ?? 0);
const minTurn = Number(minTurnArg);
const parseModels = (s: string): Record<string, { w: number[] }> => Object.fromEntries(s.split(',').filter(Boolean).map((kv) => { const [k, p] = kv.split('='); return [k, JSON.parse(readFileSync(p, 'utf8'))]; }));
function learnedAgent(arg: string): Agent {
  const rule = makeRuleBased();
  if (!arg) return rule;
  const models = parseModels(arg);
  return {
    ...rule,
    name: 'learned',
    viewless: (s) => s.pending?.why === 'turnAction',
    chooseAction(view, legal, ctx) {
      if (legal.length === 1) return legal[0];
      if (view.pending!.why === 'turnAction') {
        const cat = legal.some((a) => a.type === 'CHARGE_MANA') ? 'charge' : legal.some((a) => a.type === 'PLAY_CARD') ? 'play' : 'attack';
        if (models[cat] && view.turn >= minTurn && view.players[1 - view.pending!.player].shield.length >= minOppShield) return chooseConservative(view, legal, reg, models[cat], rule.chooseAction(view, legal, ctx) as never, DELTA);
        return rule.chooseAction(view, legal, ctx) as never;
      }
      return rule.chooseAction(view, legal, ctx) as never;
    },
  };
}
const A = learnedAgent(modelsArg);
const B = learnedAgent(baseArg);
const ids = DECK_PRESETS.map((d) => d.id);
let wins = 0;
let n = 0;
const t0 = Date.now();
const rows: string[] = [];
for (const x of ids) {
  for (const y of ids) {
    let w = 0;
    let m = 0;
    for (let g = 0; g < Number(pairsN); g++) {
      const sd = Number(seed) * 1000003 + g;
      // 複製: 同じシードで席を入れ替える
      for (const swap of [false, true]) {
        const agents: [Agent, Agent] = swap ? [B, A] : [A, B];
        const r = playGameSync(reg, agents, { decks: [deckCards(x), deckCards(y)], seed: sd, first: 0 });
        const aSeat = swap ? 1 : 0;
        if (r.winner === aSeat) w++;
        else if (r.winner === 'draw' || r.winner === null) w += 0.5;
        m++;
      }
    }
    wins += w;
    n += m;
    rows.push(`  ${x}(A) vs ${y}(B): ${((w / m) * 100).toFixed(1)}%(${m}試合)`);
  }
}
const ci = wilson(Math.round(wins), n);
console.log(rows.join('\n'));
console.log(`合計: A の勝ち ${wins}/${n} = ${((wins / n) * 100).toFixed(1)}%(95%区間 ${(ci[0] * 100).toFixed(1)}〜${(ci[1] * 100).toFixed(1)}%)  ${((Date.now() - t0) / 1000).toFixed(0)}秒`);
void legalActions;
