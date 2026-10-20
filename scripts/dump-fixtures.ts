// Rust 版エンジンの差分テスト用の正解データを書き出す(TS 版が基準)。
//   npx tsx scripts/dump-fixtures.ts rust/fixtures/games.json
// 内容: 展開済みのカード定義(registry.defs)と、数試合の「状態 → 合法手 → 行動」の列。
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CARD_DB, deckCards } from '../src/cards';
import { makeRuleBased } from '../src/ai/rulebased';
import { randomAgent } from '../src/ai/random';
import type { Agent } from '../src/ai/types';
import { createGame, legalActions, step } from '../src/engine/engine';
import { loadRegistry } from '../src/engine/registry';
import { FAIR, toPlayerView } from '../src/engine/view';
import type { Action, GameState } from '../src/engine/types';
import { mulberry } from '../src/sim/playGame';
import { evalRound, roundSeed, type SearchEnv } from '../src/ai/mcts';
import { BASE_FEATURES, type ValueModel } from '../src/ai/valueModel';
import { PairedTree, treeSearch } from '../src/ai/tree';
import { ATTACK_TEST_CARDS } from '../tests/fixtures/attack-cards';
import { BATTLE_TEST_CARDS } from '../tests/fixtures/battle-cards';

const out = process.argv[2] ?? 'rust/fixtures/games.json';
// 攻撃まわりのイベント(バトルする時・バトルの後・ブレイクする前に)・呪文の置換・使用宣言を試すテスト用のカードも入れる
// 効果によるバトル・無限パワー・タップして出る・召喚封じ・G城のテスト用のカードも入れる
const reg = loadRegistry({ ...CARD_DB, ...Object.fromEntries([...ATTACK_TEST_CARDS, ...BATTLE_TEST_CARDS].map((c) => [c.id, c])) });
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

interface Rec {
  decks: [string | string[], string | string[]];
  seed: number;
  kinds: [string, string];
  states: unknown[];
  legal: unknown[];
  actions: unknown[];
}

const deckOf = (d: string | string[]): string[] => (typeof d === 'string' ? deckCards(d) : d);
function play(deckA: string | string[], deckB: string | string[], seed: number, kinds: ['rule' | 'random', 'rule' | 'random']): Rec {
  const agents: Agent[] = kinds.map((k) => (k === 'rule' ? makeRuleBased({}) : randomAgent));
  let { state: s } = createGame(reg, { decks: [deckOf(deckA), deckOf(deckB)], seed, first: 'random' });
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
    const a = legal.length === 1 ? legal[0] : ag.chooseAction(view, legal, { rand, reg }) as Action;
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
  // 革命5cザーディ(G城・効果バトル・革命チェンジ・ファイナル革命・タップして出る・召喚封じ)
  ['zardy-rev5c', 'zardy-rev5c', 51, ['random', 'random']],
  ['zardy-rev5c', 'zardy-rev5c', 52, ['rule', 'rule']],
  ['zardy-rev5c', 'zardy-rev5c', 53, ['random', 'random']],
  ['zardy-rev5c', 'maruru', 54, ['rule', 'rule']],
  ['interstellar-maruru', 'zardy-rev5c', 55, ['random', 'random']],
  ['zardy-rev5c', 'zardy-rev5c', 56, ['rule', 'random']],
  ['zardy-rev5c', 'zardy-rev5c', 57, ['random', 'random']],
  ['zardy-rev5c', 'zardy-rev5c', 58, ['random', 'rule']],
  ['zardy-rev5c', 'zardy-rev5c', 59, ['random', 'random']],
  ['zardy-rev5c', 'zardy-rev5c', 60, ['rule', 'rule']],
] as const) {
  games.push(play(a, b, seed, [k[0], k[1]]));
}
// テスト用のカードで組んだデッキ: バトルする時・バトルの後・ブレイクする前に・呪文の置換(チャージャー)・
// 非ターン・プレイヤーの使用宣言・複数ブロッカー・強制ブロックの手続きを、Rust 版と突き合わせる
const rep = (n: number, id: string): string[] => Array.from({ length: n }, () => id);
const DECK_T1 = [...rep(8, 't-atk'), ...rep(8, 't-after'), ...rep(6, 't-bs-bounce'), ...rep(6, 't-before-break'), ...rep(4, 't-charger'), ...rep(4, 'dm24rp3-020'), ...rep(4, 't-force')];
// ブロッカーだらけ(複数ブロッカーの同時選択を起こす)
const DECK_T3 = [...rep(20, 'dm24rp3-020'), ...rep(8, 't-atk'), ...rep(6, 't-after'), ...rep(6, 't-bs-bounce')];
const DECK_T2 = [...rep(8, 't-ntp-declare'), ...rep(8, 't-atk'), ...rep(6, 't-after'), ...rep(6, 't-bs-bounce'), ...rep(4, 't-before-break'), ...rep(8, 'dm24rp3-020')];
for (const [seed, k] of [
  [31, ['random', 'random']],
  [32, ['random', 'random']],
  [33, ['rule', 'rule']],
  [34, ['random', 'rule']],
  [35, ['random', 'random']],
] as const) {
  games.push(play(DECK_T1, DECK_T2, seed, [k[0], k[1]]));
}
for (const [seed, k] of [
  [72, ['random', 'random']], // 複数ブロッカーの同時選択が起きる種
  [159, ['random', 'random']],
  [163, ['random', 'random']],
  [38, ['random', 'rule']],
] as const) {
  games.push(play(DECK_T3, DECK_T2, seed, [k[0], k[1]]));
}
// 効果によるバトル・バトル時の無限パワー・踏み倒しへのバトル・多色が出た時・タップして出る・召喚封じ・G城(表向きのシールド・マナへの置換)を、Rust 版と突き合わせる
const DECK_B1 = [
  ...rep(4, 'tc-castle'), ...rep(4, 'tb-fighter'), ...rep(3, 'tb-inf'), ...rep(3, 'tb-slayer'), ...rep(3, 'tb-big'), ...rep(3, 'tb-mid'),
  ...rep(3, 'tb-small'), ...rep(3, 'tb-watch'), ...rep(2, 'tb-multi'), ...rep(3, 'tb-two'), ...rep(3, 'tb-fire'), ...rep(2, 'tb-tapin'),
  ...rep(2, 'tb-lock'), ...rep(2, 'tb-sweep'),
];
for (const [seed, k] of [
  [41, ['random', 'random']],
  [42, ['random', 'random']],
  [43, ['rule', 'rule']],
  [44, ['rule', 'random']],
  [45, ['random', 'rule']],
  [46, ['random', 'random']],
  [47, ['rule', 'rule']],
  [48, ['random', 'random']],
] as const) {
  games.push(play(DECK_B1, DECK_B1, seed, [k[0], k[1]]));
}
// ツインパクト・「マナゾーンに置く」効果を多く入れたデッキ: バトルゾーンからマナゾーンへ移るツインパクトのカードが、
// タップして置かれること(マナゾーンでは両面の文明で多色。spec 3.4.1 M-1)を、Rust 版と突き合わせる
const DECK_TWIN = [...rep(4, 'dm23rp1-070'), ...rep(4, 'dm24rp3-025'), ...rep(8, 'dm24ex2-096'), ...rep(4, 'dm24bd4-007'), ...rep(8, 'dmrp01-093'), ...rep(4, 'dmbd01-015'), ...rep(4, 'dm24rp3-S10'), ...rep(4, 'dm23bd1-014')];
for (const seed of [1, 14, 16]) games.push(play(DECK_TWIN, DECK_TWIN, seed, ['random', 'random']));
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
    const st = g.states[i] as GameState;
    const legal = g.legal[i] as Action[];
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
    // 相打ちの攻撃(既定 0)を、無効(99)・常に許す(-99)にした場合も確かめる
    if (k % 6 === 1) Object.assign(wts, { atkTrade: 99 });
    if (k % 6 === 4) Object.assign(wts, { atkTrade: -99 });
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
mkdirSync(dirname(out), { recursive: true }); // rust/fixtures/ は git の管理外(CI の新しい作業ツリーには無い)
writeFileSync(out, JSON.stringify({ defs, games, rounds, trees, pairedTrees }));
console.log('games', games.map((g) => g.actions.length).join(','), 'rounds', rounds.length);
