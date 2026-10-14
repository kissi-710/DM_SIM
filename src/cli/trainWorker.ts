// 価値関数の学習データを作る Worker(node:worker_threads)。試合番号の範囲ごとに、自己対戦の局面を集めて返す。
import { parentPort } from 'node:worker_threads';
import type { AgentSpec } from '../ai';
import { CARD_DB, deckCards } from '../cards';
import { featureSpace, generateSamples } from '../sim/valueTrain';
import { installNativeFromEnv } from '../wasm/installNode';

installNativeFromEnv();

export interface TrainTask {
  decks: string[];
  games: number;
  range: [number, number];
  seed: number;
  spec: AgentSpec;
  eps: number[];
  defs: string[];
}
export interface TrainOut {
  dim: number;
  /** 行ごとの特徴量(長さ n×dim) */
  xs: Float64Array;
  ys: Float64Array;
  gameNos: Int32Array;
  turns: Int32Array;
  hands: Float64Array;
}

parentPort!.on('message', (t: TrainTask) => {
  const pairs = [];
  for (const x of t.decks) for (const y of t.decks) pairs.push({ a: deckCards(x), b: deckCards(y) });
  const sp = featureSpace(t.defs);
  const rows = generateSamples(CARD_DB, pairs, t.games, t.seed, sp, t.eps, t.spec, t.range);
  const dim = rows.length ? rows[0].x.length : 0;
  const out: TrainOut = {
    dim,
    xs: new Float64Array(rows.length * dim),
    ys: new Float64Array(rows.length),
    gameNos: new Int32Array(rows.length),
    turns: new Int32Array(rows.length),
    hands: new Float64Array(rows.length),
  };
  rows.forEach((r, i) => {
    out.xs.set(r.x, i * dim);
    out.ys[i] = r.y;
    out.gameNos[i] = r.game;
    out.turns[i] = r.turn;
    out.hands[i] = r.hand;
  });
  parentPort!.postMessage(out);
});
