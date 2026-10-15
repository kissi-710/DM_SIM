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
import { PairedTree, treeSearch } from '../src/ai/tree';

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
  let nThis = 0;
  for (let i = 0; i < g.states.length - 1; i += 3) {
    if (nThis >= 15) break; // 1試合から取る数(デッキの組が偏らないように)
    const st: any = g.states[i];
    const legal: any[] = g.legal[i] as any[];
    if (!st.pending || legal.length < 2) continue;
    const me = st.pending.player;
    const view = toPlayerView(st, me, FAIR, reg);
    // 4つに1つはゲーム終了まで(horizon 99)、2つに1つは価値関数で報酬を出す
    const k = rounds.length;
    // 5つに1つは ε 乱択 + 軌跡平均(減衰つき)、5つに1つは軌跡平均だけ
    const wts: Record<string, unknown> = k % 2 === 1 ? { model: TEST_MODEL } : {};
    if (k % 5 === 2) Object.assign(wts, { eps: 0.2, traj: 0.7, trajDecay: 0.6 });
    if (k % 5 === 4) Object.assign(wts, { traj: 1 });
    if (k % 7 === 3) Object.assign(wts, { anti: 1 });
    const env: SearchEnv = { view, legal, me, policy: FAIR, candidateDecks: undefined, horizon: k % 4 === 3 ? 99 : 3, weights: Object.keys(wts).length ? (wts as SearchEnv['weights']) : undefined };
    const seeds = [1, 2, 3, 4].map((r) => roundSeed(77 + i, r));
    const alive = legal.map((_, k) => k);
    const rows = seeds.map((sd) => evalRound(env, reg, sd, alive).map((x) => (Number.isNaN(x) ? null : x)));
    rounds.push({ env: plain(env), seeds, alive, rows });
    nThis++;
    if (rounds.length >= 120) break;
  }
  if (rounds.length >= 120) break;
}
// 木の探索の正解: 同じ入力・同じ種・同じ反復数で、根の手ごとの訪問回数と報酬の合計
const trees: { env: SearchEnv; base: number; iterations: number; c: number; maxDepth: number; visits: number[]; sums: number[] }[] = [];
for (let i = 0; i < rounds.length && trees.length < 24; i += 3) {
  const env = rounds[i].env;
  const c = trees.length % 2 === 0 ? 0.3 : 0.8;
  const maxDepth = trees.length % 3 === 0 ? 4 : 24;
  const base = 1000 + i;
  const iterations = 60;
  const st = treeSearch(env, reg, base, iterations, { c, maxDepth });
  trees.push({ env, base, iterations, c, maxDepth, visits: st.visits, sums: st.sums });
}
// ペア比較の木の正解: 同じ木を保ったまま、数ラウンドを順に評価した報酬の行(alive は、2ラウンド目から減らす)
const pairedTrees: { env: SearchEnv; c: number; maxDepth: number; seeds: number[]; alives: number[][]; rows: (number | null)[][] }[] = [];
for (let i = 1; i < rounds.length && pairedTrees.length < 16; i += 4) {
  const env = rounds[i].env;
  const c = pairedTrees.length % 2 === 0 ? 0.3 : 0.6;
  const maxDepth = 24;
  const tree = new PairedTree(env, reg, { c, maxDepth });
  const seeds = [0, 1, 2, 3, 4, 5].map((r) => roundSeed(500 + i, r));
  let alive = env.legal.map((_, k) => k);
  const alives: number[][] = [];
  const rows: (number | null)[][] = [];
  seeds.forEach((sd, r) => {
    if (r === 3 && alive.length > 2) alive = alive.slice(0, Math.ceil(alive.length / 2));
    alives.push(alive.slice());
    rows.push(tree.round(sd, alive).map((x) => (Number.isNaN(x) ? null : x)));
  });
  pairedTrees.push({ env, c, maxDepth, seeds, alives, rows });
}
const defs = plain(reg.defs);
writeFileSync(out, JSON.stringify({ defs, games, rounds, trees, pairedTrees }));
console.log('games', games.map((g) => g.actions.length).join(','), 'rounds', rounds.length);
