// L1(ルールベース)と、探索(高予算)の手が食い違う局面を集めて、どの種類の手で違うかを数える(L1 の改善点の診断)。
//   npx tsx scripts/l1-diff.ts [局面数] [探索の反復]
import { CARD_DB, deckCards } from '../src/cards';
import { makeAgent } from '../src/ai';
import { legalActions } from '../src/engine/engine';
import { loadRegistry } from '../src/engine/registry';
import type { Action, GameState } from '../src/engine/types';
import { FAIR, toPlayerView } from '../src/engine/view';
import { collectPositions } from '../src/sim/aiEval';
import { mulberry } from '../src/sim/playGame';
import { installNativeFromEnv } from '../src/wasm/installNode';

installNativeFromEnv();
const reg = loadRegistry(CARD_DB);
const N = Number(process.argv[2] ?? 400);
const IT = Number(process.argv[3] ?? 1400);
const ids = ['maruru', 'zardy', 'lost-maruru'];
const pairs = [];
for (const x of ids) for (const y of ids) pairs.push({ id: `${x}/${y}`, a: deckCards(x), b: deckCards(y) });
const pos = collectPositions(reg, pairs, N, 77);
const l1 = makeAgent({ kind: 'rule' });
const mc = makeAgent({ kind: 'mcts', iterations: IT });
const name = (a: Action, s: GameState): string => {
  const card = (uid: number) => s.cards[uid].defId;
  switch (a.type) {
    case 'CHARGE_MANA':
      return 'CHARGE:' + card(a.uid);
    case 'PLAY_CARD':
      return 'PLAY:' + card(a.uid);
    case 'ATTACK':
      return 'ATTACK:' + (a.target.kind === 'player' ? 'player' : 'creature');
    default:
      return a.type;
  }
};
const kind = (a: Action) => (a.type === 'ANSWER' ? 'ANSWER' : a.type);
const conf: Record<string, number> = {};
let total = 0;
let diff = 0;
const examples: string[] = [];
let k = 0;
for (const p of pos) {
  const s = p.state;
  if (!s.pending || s.pending.why !== 'turnAction') continue;
  const who = s.pending.player;
  const legal = legalActions(s, reg);
  if (legal.length < 2) continue;
  const view = toPlayerView(s, who, FAIR, reg);
  const a1 = l1.chooseAction(view, legal, { rand: mulberry(1), reg }) as Action;
  const a2 = mc.chooseAction(view, legal, { rand: mulberry(2), reg }) as Action;
  total++;
  if (JSON.stringify(a1) !== JSON.stringify(a2)) {
    diff++;
    const key = `${kind(a1)} → ${kind(a2)}`;
    conf[key] = (conf[key] ?? 0) + 1;
    if (k++ < 40) examples.push(`T${s.turn} ${name(a1, s)}  →  ${name(a2, s)}  (手札${s.players[who].hand.length} マナ${s.players[who].mana.length} 自盤${s.players[who].battle.length} 敵盤${s.players[1 - who].battle.length} 自盾${s.players[who].shield.length} 敵盾${s.players[1 - who].shield.length})`);
  }
}
console.log(`ターン中の行動 ${total} 局面のうち、探索(反復${IT})が L1 と違う手を選んだ: ${diff}(${((diff / total) * 100).toFixed(1)}%)`);
for (const [kk, v] of Object.entries(conf).sort((a, b) => b[1] - a[1])) console.log(`  ${kk}: ${v}`);
console.log(examples.join('\n'));
