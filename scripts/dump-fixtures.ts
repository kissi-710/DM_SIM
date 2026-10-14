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
import { evalRound, roundSeed, type SearchEnv } from '../src/ai/mcts';

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
  // インターステラ型マルル(革命チェンジ・超次元ゾーン・スレイヤー・コスト封じなどの新しい仕組み)
  ['interstellar-maruru', 'zardy', 9, ['rule', 'rule']],
  ['maruru', 'interstellar-maruru', 10, ['rule', 'rule']],
  ['interstellar-maruru', 'interstellar-maruru', 11, ['random', 'random']],
  ['interstellar-maruru', 'interstellar-maruru', 12, ['rule', 'random']],
  ['interstellar-maruru', 'maruru', 13, ['random', 'random']],
  ['zardy', 'interstellar-maruru', 14, ['random', 'random']],
  ['interstellar-maruru', 'interstellar-maruru', 15, ['rule', 'random']],
  ['interstellar-maruru', 'interstellar-maruru', 16, ['random', 'random']],
  ['interstellar-maruru', 'interstellar-maruru', 17, ['random', 'random']],
  ['interstellar-maruru', 'interstellar-maruru', 18, ['rule', 'random']],
  ['interstellar-maruru', 'interstellar-maruru', 19, ['random', 'random']],
  ['interstellar-maruru', 'interstellar-maruru', 20, ['random', 'random']],
  ['interstellar-maruru', 'interstellar-maruru', 21, ['rule', 'random']],
  ['interstellar-maruru', 'interstellar-maruru', 22, ['random', 'random']],
  ['interstellar-maruru', 'interstellar-maruru', 23, ['random', 'random']],
  ['interstellar-maruru', 'interstellar-maruru', 24, ['rule', 'random']],
  ['interstellar-maruru', 'interstellar-maruru', 25, ['random', 'random']],
  ['interstellar-maruru', 'interstellar-maruru', 26, ['random', 'random']],
] as const) {
  games.push(play(a, b, seed, [k[0], k[1]]));
}
// プレイアウトの正解: 途中の局面(自分から見た PlayerView)で、手ごとの報酬を数ラウンド
const rounds: { env: SearchEnv; seeds: number[]; alive: number[]; rows: (number | null)[][] }[] = [];
for (const g of games) {
  let nThis = 0;
  for (let i = 0; i < g.states.length - 1; i += 3) {
    if (nThis >= 15) break; // 1試合から取る数(デッキの組が偏らないように)
    const st: any = g.states[i];
    const legal: any[] = g.legal[i] as any[];
    if (!st.pending || legal.length < 2) continue;
    const me = st.pending.player;
    const view = toPlayerView(st, me, FAIR, reg);
    const env: SearchEnv = { view, legal, me, policy: FAIR, candidateDecks: undefined, horizon: 3 };
    const seeds = [1, 2, 3, 4].map((r) => roundSeed(77 + i, r));
    const alive = legal.map((_, k) => k);
    const rows = seeds.map((sd) => evalRound(env, reg, sd, alive).map((x) => (Number.isNaN(x) ? null : x)));
    rounds.push({ env: plain(env), seeds, alive, rows });
    nThis++;
    if (rounds.length >= 120) break;
  }
  if (rounds.length >= 120) break;
}
const defs = plain(reg.defs);
writeFileSync(out, JSON.stringify({ defs, games, rounds }));
console.log('games', games.map((g) => g.actions.length).join(','), 'rounds', rounds.length);
