// Rust 版エンジンの差分テスト用の正解データを書き出す(TS 版が基準)。
//   npx tsx scripts/dump-fixtures.ts rust/fixtures/games.json
// 内容: 展開済みのカード定義(registry.defs)と、数試合の「状態 → 合法手 → 行動」の列。
import { writeFileSync } from 'node:fs';
import { CARD_DB, deckCards } from '../src/cards';
import { makeRuleBased } from '../src/ai/rulebased';
import { randomAgent } from '../src/ai/random';
import type { Agent } from '../src/ai/types';
import { createGame, legalActions, step } from '../src/engine/engine';
import { loadRegistry } from '../src/engine/registry';
import { FAIR, toPlayerView } from '../src/engine/view';
import { mulberry } from '../src/sim/playGame';

const out = process.argv[2] ?? 'rust/fixtures/games.json';
const reg = loadRegistry(CARD_DB);
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

interface Rec {
  decks: [string, string];
  seed: number;
  kinds: [string, string];
  states: unknown[];
  legal: unknown[];
  actions: unknown[];
}

function play(deckA: string, deckB: string, seed: number, kinds: ['rule' | 'random', 'rule' | 'random']): Rec {
  const agents: Agent[] = kinds.map((k) => (k === 'rule' ? makeRuleBased({}) : randomAgent));
  let { state: s } = createGame(reg, { decks: [deckCards(deckA), deckCards(deckB)], seed, first: 'random' });
  const rand = mulberry(seed * 7 + 1);
  const rec: Rec = { decks: [deckA, deckB], seed, kinds, states: [], legal: [], actions: [] };
  for (let i = 0; i < 4000 && s.winner === null; i++) {
    const legal = legalActions(s, reg);
    if (legal.length === 0) break;
    rec.states.push(plain(s));
    rec.legal.push(plain(legal));
    const who = s.pending!.player;
    const ag = agents[who];
    const view = ag.needsView === false ? s : toPlayerView(s, who, ag.policy ?? FAIR, reg);
    const a = legal.length === 1 ? legal[0] : ag.chooseAction(view, legal, { rand, reg }) as any;
    rec.actions.push(plain(a));
    s = step(s, a, reg).state;
  }
  rec.states.push(plain(s));
  return rec;
}

const games: Rec[] = [];
for (const [a, b, seed, k] of [
  ['maruru', 'zardy', 3, ['rule', 'rule']],
  ['zardy', 'maruru', 4, ['rule', 'rule']],
  ['maruru', 'maruru', 5, ['random', 'random']],
  ['zardy', 'zardy', 6, ['random', 'random']],
  ['maruru', 'zardy', 7, ['random', 'rule']],
  ['zardy', 'maruru', 8, ['rule', 'random']],
] as const) {
  games.push(play(a, b, seed, [k[0], k[1]]));
}
const defs = plain(reg.defs);
writeFileSync(out, JSON.stringify({ defs, games }));
console.log('games', games.map((g) => g.actions.length).join(','), 'bytes', JSON.stringify({ defs, games }).length);
