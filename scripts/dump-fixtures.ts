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
import { BASE_FEATURES, type ValueModel } from '../src/ai/valueModel';

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
// 差分テスト用の価値関数(重みは決め打ち。全特徴量・手番・一部のカードに非零の値を入れる)
const TEST_MODEL: ValueModel = {
  v: 1,
  base: Object.fromEntries(BASE_FEATURES.map((n, i) => [n, ((i * 37) % 11 - 5) / 10])) as ValueModel['base'],
  tempo: 0.3,
  battle: Object.fromEntries(Object.keys(reg.defs).slice(0, 40).map((d, i) => [d, ((i * 7) % 9 - 4) / 8])),
  hand: Object.fromEntries(Object.keys(reg.defs).slice(5, 45).map((d, i) => [d, ((i * 5) % 7 - 3) / 6])),
};
// プレイアウトの正解: 途中の局面(自分から見た PlayerView)で、手ごとの報酬を数ラウンド
const rounds: { env: SearchEnv; seeds: number[]; alive: number[]; rows: (number | null)[][] }[] = [];
for (const g of games) {
  for (let i = 0; i < g.states.length - 1; i += 3) {
    const st: any = g.states[i];
    const legal: any[] = g.legal[i] as any[];
    if (!st.pending || legal.length < 2) continue;
    const me = st.pending.player;
    const view = toPlayerView(st, me, FAIR, reg);
    // 4つに1つはゲーム終了まで(horizon 99)、2つに1つは価値関数で報酬を出す
    const k = rounds.length;
    const env: SearchEnv = { view, legal, me, policy: FAIR, candidateDecks: undefined, horizon: k % 4 === 3 ? 99 : 3, weights: k % 2 === 1 ? { model: TEST_MODEL } : undefined };
    const seeds = [1, 2, 3, 4].map((r) => roundSeed(77 + i, r));
    const alive = legal.map((_, k) => k);
    const rows = seeds.map((sd) => evalRound(env, reg, sd, alive).map((x) => (Number.isNaN(x) ? null : x)));
    rounds.push({ env: plain(env), seeds, alive, rows });
    if (rounds.length >= 90) break;
  }
  if (rounds.length >= 90) break;
}
const defs = plain(reg.defs);
writeFileSync(out, JSON.stringify({ defs, games, rounds }));
console.log('games', games.map((g) => g.actions.length).join(','), 'rounds', rounds.length);
