// 価値関数の学習 CLI(docs/ai-quality-plan.md §4.2)。
//   npx tsx src/cli/trainValue.ts --games 6000 --out src/ai/models/v1.json
// ルールベース同士の自己対戦の、ターン開始時の局面 → 最終の勝敗 を、L2 正則化つきロジスティック回帰で学習する。
// 保留(対局単位で 20%)での対数損失・正解率を、手作りの評価(尺度だけ当てはめたもの)と比べて出す。
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { parseSpec } from '../ai/specString';
import type { TrainOut, TrainTask } from './trainWorker';
import { dirname } from 'node:path';
import { CARD_DB, DECK_PRESETS, deckCards } from '../cards';
import { N_BASE } from '../ai/valueModel';
import {
  dimOf,
  evaluateFit,
  evaluateHand,
  featureSpace,
  fitHandScale,
  fitLogistic,
  weightsToModel,
  type Sample,
} from '../sim/valueTrain';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}
const a = parseArgs(process.argv.slice(2));
if (a.help) {
  console.log(`使い方: npx tsx src/cli/trainValue.ts [オプション]
  --games <n>        自己対戦の試合数(既定 6000)
  --seed <n>         シード(既定 7001)
  --decks <ids>      学習に使うデッキ(カンマ区切り。既定: 全プリセット)
  --lambda <x>       基本の特徴量の正則化(既定 1)
  --lambda-card <x>  カードごとの重みの正則化(既定 30)
  --no-cards         カードごとの重みを使わない(基本の特徴量だけ)
  --eps <a,b,c>      方策にランダムな手を混ぜる確率(既定 0,0.05,0.15)
  --agent <設定>     対局に使うAI(既定 rule。例 mcts:iter=120。aiquality と同じ書き方)
  --jobs <n>         並列数(既定: コア数-1、最大8)
  --out <path>       モデルの出力先(JSON)`);
  process.exit(0);
}
const num = (k: string, d: number) => (a[k] === undefined ? d : Number(a[k]));
const games = num('games', 6000);
const seed = num('seed', 7001);
const deckIds = a.decks ? a.decks.split(',') : DECK_PRESETS.map((d) => d.id);
const pairs = [];
for (const x of deckIds) for (const y of deckIds) pairs.push({ a: deckCards(x), b: deckCards(y) });
const eps = a.eps ? a.eps.split(',').map(Number) : [0, 0.05, 0.15];
const defIds = Object.keys(CARD_DB).filter((d) => d !== '?' && deckIds.some((id) => deckCards(id).includes(d)));
const sp = featureSpace(a['no-cards'] ? [] : defIds);

const spec = parseSpec(a.agent ?? 'rule');
const jobs = Math.max(1, Math.min(8, a.jobs ? Number(a.jobs) : availableParallelism() - 1));

function collect(): Promise<Sample[]> {
  const url = new URL('./trainWorker.ts', import.meta.url);
  const size = Math.max(1, Math.ceil(games / (jobs * 4)));
  const ranges: [number, number][] = [];
  for (let g = 0; g < games; g += size) ranges.push([g, Math.min(games, g + size)]);
  const results: Sample[][] = new Array(ranges.length);
  let next = 0;
  let done = 0;
  const pool: Worker[] = [];
  return new Promise((resolve, reject) => {
    const start = () => {
      const w = new Worker(url);
      pool.push(w);
      let cur = -1;
      const feed = () => {
        if (next >= ranges.length) return void w.terminate();
        cur = next++;
        const task: TrainTask = { decks: deckIds, games, range: ranges[cur], seed, spec, eps, defs: sp.defs };
        w.postMessage(task);
      };
      w.on('message', (o: TrainOut) => {
        const rows: Sample[] = [];
        for (let i = 0; i < o.ys.length; i++) {
          rows.push({ x: o.xs.slice(i * o.dim, (i + 1) * o.dim), y: o.ys[i], game: o.gameNos[i], turn: o.turns[i], hand: o.hands[i] });
        }
        results[cur] = rows;
        if (++done === ranges.length) {
          pool.forEach((p) => void p.terminate());
          resolve(results.flat());
        } else feed();
      });
      w.on('error', reject);
      feed();
    };
    for (let i = 0; i < Math.min(jobs, ranges.length); i++) start();
  });
}

const t0 = Date.now();
const samples = await collect();
console.error(`データ: ${samples.length} 局面(${games} 試合、${((Date.now() - t0) / 1000).toFixed(0)}秒)`);

// 保留: 対局単位で 20%
const train: Sample[] = [];
const hold: Sample[] = [];
for (const s of samples) (s.game % 5 === 4 ? hold : train).push(s);
const dim = dimOf(sp);
const w = fitLogistic(train, dim, N_BASE + 1, { lambdaBase: num('lambda', 1), lambdaCard: num('lambda-card', 30) });
const fitTrain = evaluateFit(train, w);
const fitHold = evaluateFit(hold, w);
const sc = fitHandScale(train);
const baseTrain = evaluateHand(train, sc);
const baseHold = evaluateHand(hold, sc);
const p = (x: number) => (x * 100).toFixed(1) + '%';
console.log(`学習 ${train.length} / 保留 ${hold.length} 局面、特徴量 ${dim} 個`);
console.log(`  学習した価値関数: 保留の対数損失 ${fitHold.logLoss.toFixed(4)}  正解率 ${p(fitHold.accuracy)}  (学習側 ${fitTrain.logLoss.toFixed(4)} / ${p(fitTrain.accuracy)})`);
console.log(`  手作りの評価(尺度 a=${sc.toFixed(4)}): 保留の対数損失 ${baseHold.logLoss.toFixed(4)}  正解率 ${p(baseHold.accuracy)}  (学習側 ${baseTrain.logLoss.toFixed(4)} / ${p(baseTrain.accuracy)})`);
console.log(`  何も知らない場合: 対数損失 ${Math.log(2).toFixed(4)}`);
// ターン帯ごとの保留の対数損失
for (const [lo, hi] of [
  [2, 4],
  [5, 7],
  [8, 10],
  [11, 99],
]) {
  const sub = hold.filter((s) => s.turn >= lo && s.turn <= hi);
  if (!sub.length) continue;
  const f = evaluateFit(sub, w);
  const h = evaluateHand(sub, sc);
  console.log(`    ターン${lo}〜${hi}(${sub.length}): 学習 ${f.logLoss.toFixed(4)}/${p(f.accuracy)}  手作り ${h.logLoss.toFixed(4)}/${p(h.accuracy)}`);
}
const model = weightsToModel(w, sp);
console.log('基本の重み:', JSON.stringify(model.base), 'tempo', model.tempo);
if (a.out) {
  mkdirSync(dirname(a.out), { recursive: true });
  writeFileSync(a.out, JSON.stringify({ ...model, meta: { games, seed, decks: deckIds, eps, agent: a.agent ?? 'rule', holdLogLoss: fitHold.logLoss, holdAccuracy: fitHold.accuracy } }, null, 1));
  console.error('→', a.out);
}
