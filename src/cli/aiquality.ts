// AI の質の測定 CLI(docs/ai-quality-plan.md §3)。
//   npx tsx src/cli/aiquality.ts match   --a "mcts:iter=120,horizon=99" --b "mcts:iter=120" --games 100
//   npx tsx src/cli/aiquality.ts teacher --agents "mcts:iter=120;mcts:iter=120,horizon=99" --positions 300
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { CARD_DB, DECK_PRESETS, deckCards } from '../cards';
import { specLabel, parseSpec } from '../ai/specString';
import { loadRegistry } from '../engine/registry';
import { collectPositions, summarize, type Judgement, type Position, type TeacherEntry } from '../sim/aiEval';
import type { MatchStats } from '../sim/batch';
import { wilson } from '../sim/stats';
import { installNativeFromEnv } from '../wasm/installNode';
import { parseArgs } from './args';
import { runParallel } from './parallel';
import { runPool } from './pool';
import type { QualityOut, QualityTask } from './qualityWorker';

const { opts, positional } = parseArgs(process.argv.slice(2));
const cmd = positional[0] ?? '';

function usage(): never {
  console.log(`使い方: npx tsx src/cli/aiquality.ts <match|teacher> [オプション]

  match    A と B の直接対戦(複製対局: 同じシードで席を入れ替えて2回ずつ。デッキの組は全順列)
    --a <設定>        A の設定(例 mcts:iter=120,horizon=99)
    --b <設定>        B の設定(既定 mcts:iter=120)
    --games <n>       デッキの組ごとの試合数(偶数。既定 100)
    --seed <n>        シード(既定 1)
    --decks <ids>     デッキ(カンマ区切り。既定: 全プリセット)
  teacher  教師との一致率・損失
    --agents <設定;設定;...>  測る AI(既定 mcts:iter=120)
    --positions <n>   局面の数(既定 300)
    --rounds <n>      教師のラウンド数(既定 400)
    --horizon <n>     教師の先読みターン数(既定 99 = ゲーム終了まで)
    --seed <n>        シード(既定 1)
    --decks <ids>     デッキ(既定: 全プリセット)
  共通
    --jobs <n>        並列数(既定: コア数-1、最大8)
    --json            JSON で出力

  設定の書き方: rule / random / mcts:iter=120,ms=...,horizon=3,prior=0.005,w.mana=3.5`);
  process.exit(0);
}
if (!cmd || opts.help) usage();

const fail = (m: string): never => {
  console.error('エラー: ' + m);
  process.exit(1);
};
const num = (k: string, d: number, min = -Infinity): number => {
  const raw = opts[k];
  if (raw === undefined) return d;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) fail(`--${k} は ${min === -Infinity ? '' : min + ' 以上の'}数で指定してください(指定値: ${raw})`);
  return n;
};
const jobs = Math.max(1, Math.min(8, opts.jobs ? num('jobs', 1, 1) : availableParallelism() - 1));
const deckIds = opts.decks ? opts.decks.split(',') : DECK_PRESETS.map((d) => d.id);
for (const id of deckIds) if (!DECK_PRESETS.some((d) => d.id === id)) fail(`未知のデッキ: ${id}`);
const pct = (x: number, d = 1) => (x * 100).toFixed(d) + '%';

// ───────────────────────── match ─────────────────────────

async function runMatch() {
  const a = parseSpec(opts.a ?? fail('--a を指定してください'));
  const b = parseSpec(opts.b ?? 'mcts:iter=120');
  const games = num('games', 100, 2);
  if (games % 2 !== 0) fail('--games は偶数にしてください(複製対局は2試合で1組)');
  const seed = num('seed', 1);
  const pairs: [string, string][] = [];
  for (const x of deckIds) for (const y of deckIds) pairs.push([x, y]);
  const t0 = Date.now();
  const stats = (await runParallel(
    {
      type: 'batch',
      opts: pairs.map(([x, y]) => ({ deckA: deckCards(x), deckB: deckCards(y), agentA: a, agentB: b, games, seed, first: 'duplicate' as const, timing: true })),
    },
    jobs,
  )) as MatchStats[];
  let wins = 0;
  let n = 0;
  const rows = stats.map((s, i) => {
    wins += s.winsA + s.draws * 0.5;
    n += s.games;
    return { deckA: pairs[i][0], deckB: pairs[i][1], rate: (s.winsA + s.draws * 0.5) / s.games, games: s.games };
  });
  const ci = wilson(Math.round(wins), n);
  const think = stats.reduce(
    (t, s) => ({ msA: t.msA + (s.think?.msA ?? 0), nA: t.nA + (s.think?.nA ?? 0), msB: t.msB + (s.think?.msB ?? 0), nB: t.nB + (s.think?.nB ?? 0) }),
    { msA: 0, nA: 0, msB: 0, nB: 0 },
  );
  const res = {
    a: specLabel(a),
    b: specLabel(b),
    games: n,
    winsA: wins,
    rate: wins / n,
    ci95: ci,
    pairs: rows,
    msPerDecisionA: think.nA ? think.msA / think.nA : null,
    msPerDecisionB: think.nB ? think.msB / think.nB : null,
    sec: (Date.now() - t0) / 1000,
  };
  if (opts.json) return console.log(JSON.stringify(res, null, 2));
  console.log(`■ A=${res.a}  対  B=${res.b}  seed=${seed} 複製対局`);
  for (const r of res.pairs) console.log(`  ${r.deckA}(A) vs ${r.deckB}(B): ${pct(r.rate)}(${r.games}試合)`);
  console.log(
    `  合計: Aの勝ち ${wins}/${n} = ${pct(res.rate)}(95%区間 ${pct(ci[0])}〜${pct(ci[1])})  ` +
      `1手あたり A ${res.msPerDecisionA?.toFixed(1)}ms / B ${res.msPerDecisionB?.toFixed(1)}ms  ${res.sec.toFixed(0)}秒`,
  );
}

// ───────────────────────── teacher ─────────────────────────

function runTasks(tasks: QualityTask[], workers: number): Promise<QualityOut[]> {
  return runPool<QualityTask, QualityOut>(new URL('./qualityWorker.ts', import.meta.url), tasks, workers, {
    unwrap: (m) => {
      if (!m.ok) throw new Error(m.error);
      return m;
    },
  });
}

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** キャッシュの鍵に混ぜる、AI・エンジンのソースの指紋(ルールや方針を変えたら、教師の値を作り直す) */
function sourceFingerprint(): string {
  const h = createHash('sha1');
  const files = ['ai/rulebased.ts', 'ai/eval.ts', 'ai/mcts.ts', 'ai/determinize.ts', 'engine/engine.ts', 'engine/legal.ts', 'engine/derive.ts', 'cards/data/cards.json'];
  for (const f of files) {
    const p = new URL(`../${f}`, import.meta.url);
    if (existsSync(p)) h.update(readFileSync(p));
  }
  return h.digest('hex').slice(0, 12);
}

async function runTeacher() {
  const specs = (opts.agents ?? 'mcts:iter=120').split(';').map((s) => parseSpec(s));
  const count = num('positions', 300, 1);
  const rounds = num('rounds', 400, 1);
  const horizon = num('horizon', 99, 1);
  const seed = num('seed', 1);
  installNativeFromEnv();
  const reg = loadRegistry(CARD_DB);
  const pairs = [];
  for (const x of deckIds) for (const y of deckIds) pairs.push({ id: `${x}/${y}`, a: deckCards(x), b: deckCards(y) });
  const t0 = Date.now();
  const positions: Position[] = collectPositions(reg, pairs, count, seed);
  const key = createHash('sha1')
    .update(JSON.stringify({ rounds, horizon, seed, fp: sourceFingerprint(), st: positions.map((p) => [p.pair, p.turn, p.state.rng, p.state.pending, p.state.players.map((z) => z.hand.length)]) }))
    .digest('hex')
    .slice(0, 16);
  const cacheDir = join(process.cwd(), 'node_modules', '.cache', 'dm-sim');
  const cacheFile = join(cacheDir, `teacher-${key}.json`);
  let teacher: TeacherEntry[];
  if (existsSync(cacheFile)) {
    teacher = JSON.parse(readFileSync(cacheFile, 'utf8')) as TeacherEntry[];
    console.error(`教師の値: キャッシュを使用(${cacheFile})`);
  } else {
    console.error(`教師の値を計算(局面 ${positions.length}、ラウンド ${rounds}、先読み ${horizon}、並列 ${jobs})...`);
    const tasks: QualityTask[] = chunk(positions, Math.max(1, Math.ceil(positions.length / (jobs * 4)))).map((ps) => ({ kind: 'teacher', positions: ps, opts: { rounds, horizon, seed } }));
    const outs = await runTasks(tasks, jobs);
    teacher = outs.flatMap((o) => (o.ok ? (o.teacher ?? []) : []));
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(teacher));
  }
  const summaries = [];
  for (const spec of specs) {
    const items = positions.map((pos, i) => ({ pos, teacher: teacher[i] }));
    const tasks: QualityTask[] = chunk(items, Math.max(1, Math.ceil(items.length / (jobs * 4)))).map((its, k) => ({
      kind: 'judge',
      items: its,
      spec,
      seed: seed * 1000 + k * 100000,
    }));
    const outs = await runTasks(tasks, jobs);
    const js: Judgement[] = outs.flatMap((o) => (o.ok ? (o.judged ?? []) : []));
    summaries.push({ spec: specLabel(spec), ...summarize(js) });
  }
  if (opts.json) return console.log(JSON.stringify({ positions: positions.length, rounds, horizon, summaries }, null, 2));
  console.log(`■ 教師: 先読み${horizon}ターン・${rounds}ラウンド・局面${positions.length}  seed=${seed}  (${((Date.now() - t0) / 1000).toFixed(0)}秒)`);
  for (const s of summaries) {
    console.log(
      `  ${s.spec}: 損失 ${(s.regret * 100).toFixed(2)}pt(±${(s.regretSe * 100).toFixed(2)})  一致 ${pct(s.agree)}  ` +
        `接戦を除く一致 ${pct(s.agreeDecisive)}(${s.nDecisive}局面)  1手 ${s.avgMs.toFixed(0)}ms`,
    );
    for (const [why, e] of Object.entries(s.byWhy).sort((x, y) => y[1].n - x[1].n)) {
      console.log(`      ${why.padEnd(14)} n=${String(e.n).padStart(3)}  損失 ${(e.regret * 100).toFixed(2)}pt  一致 ${pct(e.agree, 0)}`);
    }
  }
}

if (cmd === 'match') await runMatch();
else if (cmd === 'teacher') await runTeacher();
else usage();
