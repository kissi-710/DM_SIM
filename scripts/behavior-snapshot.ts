// 挙動の固定(リファクタリングの検証用): シード固定の対局を、全デッキの組・全 AI の種類で行い、
// 手順・イベント列・最終状態を hash にして JSON に書く。リファクタリングの前後で同じ JSON になれば、ルール・カード・AI の挙動は変わっていない。
// 使い方: npx tsx scripts/behavior-snapshot.ts [出力先 JSON]   (出力先が無ければ標準出力)
// 比較: npx tsx scripts/behavior-snapshot.ts --check tests/fixtures/behavior-snapshot.json
// 時間主導(ms)の探索は再現しないので、反復回数で決める AI だけを使う。
import { readFileSync, writeFileSync } from 'node:fs';
import { CARD_DB, DECK_PRESETS, deckCards } from '../src/cards';
import { makeAgent, type AgentSpec } from '../src/ai';
import { legalActions } from '../src/engine/engine';
import { loadRegistry } from '../src/engine/registry';
import { playGameSync } from '../src/sim/playGame';
import { runPatterns, runProbability } from '../src/sim/solitaire';
import type { Goal } from '../src/sim/goal';

const reg = loadRegistry(CARD_DB);

const hash = (s: string) => {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
};

/** 合法手の列挙の広い確認に使う対局数 */
const LEGAL_FUZZ_GAMES = 800;

const AGENTS: [string, AgentSpec][] = [
  ['random', { kind: 'random' }],
  ['rule', { kind: 'rule' }],
  ['mcts12-flat', { kind: 'mcts', iterations: 12, ms: 1e9, tuning: { algo: 'flat' } }],
  ['mcts12-ptree', { kind: 'mcts', iterations: 12, ms: 1e9 }],
  ['mcts12-tree', { kind: 'mcts', iterations: 12, ms: 1e9, tuning: { algo: 'tree' } }],
];

/**
 * 1試合 → [手数, 手順の hash, イベント列の hash, 勝者, ターン, seq, rng, カードの hash, 終了理由, 合法手の列の hash]
 * 合法手の列の hash は、毎手のあとの legalActions(選ばれなかった手も含む)の並び全体。選ばれた手の列だけでは見えない、列挙の変化を捉える。
 */
function play(a: AgentSpec, b: AgentSpec, da: string, db: string, seed: number): unknown[] {
  const ev: string[] = [];
  const legal: string[] = [];
  const r = playGameSync(reg, [makeAgent(a), makeAgent(b)], {
    decks: [deckCards(da), deckCards(db)],
    seed,
    onStep: (st, _a, events) => {
      ev.push(JSON.stringify(events));
      legal.push(String(hash(JSON.stringify(legalActions(st, reg)))));
    },
  });
  return [r.actions.length, hash(JSON.stringify(r.actions)), hash(ev.join('|')), r.winner, r.turns, r.state.seq, r.state.rng, hash(JSON.stringify(r.state.cards)), r.reason, hash(legal.join(','))];
}

export function snapshot(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const ids = DECK_PRESETS.map((d) => d.id);
  // 全デッキの組(総当たり)× ルールベース/ランダム × 4 シード
  for (const [an, as] of AGENTS.slice(0, 2)) {
    for (const da of ids) {
      for (const db of ids) {
        for (let seed = 1; seed <= 4; seed++) out[`${an}|${da}|${db}|${seed}`] = play(as, as, da, db, seed);
      }
    }
  }
  // 異なる AI の組み合わせ
  for (const [an, as] of AGENTS) {
    for (const [bn, bs] of AGENTS) {
      if (an === bn && an.startsWith('rule')) continue;
      if (!(an.startsWith('mcts') || bn.startsWith('mcts'))) continue;
      out[`mix|${an}|${bn}|maruru|zardy|7`] = play(as, bs, 'maruru', 'zardy', 7);
      out[`mix|${an}|${bn}|interstellar-maruru|lost-maruru|8`] = play(as, bs, 'interstellar-maruru', 'lost-maruru', 8);
    }
  }
  // 合法手の列挙の広い確認: 多数の対局(全デッキの組・ランダム/ルールベース)で、毎手のあとの合法手の列の hash を 1 つにまとめる。
  // まれな局面(同名の札のタップ状態が違うなど)での列挙の変化を拾う
  const pairs: [string, string][] = ids.flatMap((a) => ids.map((b) => [a, b] as [string, string]));
  for (let i = 0; i < LEGAL_FUZZ_GAMES; i++) {
    const [da, db] = pairs[i % pairs.length];
    const kind = i % 2 === 0 ? 'random' : 'rule';
    const legal: string[] = [];
    const r = playGameSync(reg, [makeAgent({ kind }), makeAgent({ kind })], {
      decks: [deckCards(da), deckCards(db)],
      seed: 1000 + i,
      onStep: (st) => legal.push(String(hash(JSON.stringify(legalActions(st, reg))))),
    });
    out[`legalfuzz|${i}`] = [kind, da, db, r.actions.length, hash(legal.join(','))];
  }
  // 確率調査・パターン調査
  const goal: Goal = { op: 'pred', timing: { turn: 6, at: 'byTurn' }, pred: { kind: 'zoneHas', zone: 'battle', card: { names: ['ヨビニオン・マルル'] } } };
  for (const id of ids) {
    const deck = deckCards(id);
    const p = runProbability(reg, { deck, first: 0, goal, trials: 24, seed: 3, maxNodes: 2000 });
    out[`prob|${id}`] = [p.policy.achieved, p.policy.byTurn, p.search?.achieved, p.search?.unknown, p.search?.avgNodes, p.exact ?? null];
    const q = runPatterns(reg, { deck, first: 0, goal, trials: 8, seed: 3, maxNodes: 2000 }, { granularity: 'set', maxHistoriesPerTrial: 2 });
    out[`pattern|${id}`] = [q.patterns.length, q.achievedTrials, q.unknownTrials, hash(JSON.stringify(q.patterns.map((x) => [x.key, x.count, x.sampleSeed])))];
  }
  return out;
}

const args = process.argv.slice(2);
const t0 = Date.now();
const snap = snapshot();
if (args[0] === '--check') {
  const want = JSON.parse(readFileSync(args[1], 'utf8')) as Record<string, unknown>;
  const bad = Object.keys({ ...want, ...snap }).filter((k) => JSON.stringify(want[k]) !== JSON.stringify(snap[k]));
  console.log(bad.length === 0 ? `一致(${Object.keys(snap).length} 件, ${Date.now() - t0}ms)` : `不一致 ${bad.length} 件:\n` + bad.map((k) => `  ${k}\n    期待 ${JSON.stringify(want[k])}\n    実際 ${JSON.stringify(snap[k])}`).join('\n'));
  process.exit(bad.length === 0 ? 0 : 1);
} else if (args[0]) {
  writeFileSync(args[0], JSON.stringify(snap, null, 1) + '\n');
  console.log(`書き出し ${args[0]}(${Object.keys(snap).length} 件, ${Date.now() - t0}ms)`);
} else console.log(JSON.stringify(snap, null, 1));
