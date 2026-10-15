// 学習した価値関数(src/ai/valueModel.ts)と、その学習(src/sim/valueTrain.ts)のテスト。
import { describe, expect, it } from 'vitest';
import { reward } from '../../src/ai/eval';
import { BASE_FEATURES, modelLogit, modelProb, type ValueModel } from '../../src/ai/valueModel';
import { deckCards } from '../../src/cards';
import { createGame, legalActions, step } from '../../src/engine/engine';
import { mulberry } from '../../src/sim/playGame';
import { dimOf, evaluateFit, featureSpace, featureVector, fitLogistic, generateSamples, type Sample } from '../../src/sim/valueTrain';
import { reg } from '../scenario';

const MODEL: ValueModel = {
  v: 1,
  base: Object.fromEntries(BASE_FEATURES.map((n, i) => [n, ((i * 37) % 11 - 5) / 10])) as ValueModel['base'],
  tempo: 0.3,
  battle: {},
  hand: {},
};

function midGame() {
  let s = createGame(reg, { decks: [deckCards('maruru'), deckCards('zardy')], seed: 3, first: 0 }).state;
  const rand = mulberry(3);
  let last = s; // 決着していない最後の盤面
  for (let i = 0; i < 120 && s.winner === null; i++) {
    const legal = legalActions(s, reg);
    if (legal.length === 0) break;
    s = step(s, legal[Math.floor(rand() * legal.length)], reg).state;
    if (s.winner === null) last = s;
  }
  return last;
}

describe('価値関数', () => {
  it('双方の視点で、勝つ確率の和が 1(logit が反対称)', () => {
    const s = midGame();
    expect(s.winner).toBeNull();
    const a = modelLogit(MODEL, s, reg, 0);
    const b = modelLogit(MODEL, s, reg, 1);
    expect(a).toBeCloseTo(-b, 12);
    expect(modelProb(MODEL, s, reg, 0) + modelProb(MODEL, s, reg, 1)).toBeCloseTo(1, 12);
  });
  it('重みに model があると、reward はその確率を返す(決着していない盤面)', () => {
    const s = midGame();
    expect(reward(s, reg, 0, { ...(undefined as any), model: MODEL, scale: 30 } as any)).toBeCloseTo(modelProb(MODEL, s, reg, 0), 12);
  });
  it('特徴量の配列と、モデルの logit が一致する', () => {
    const s = midGame();
    const sp = featureSpace([]);
    const x = featureVector(s, reg, 0, sp);
    let z = 0;
    BASE_FEATURES.forEach((n, i) => (z += (MODEL.base[n] ?? 0) * x[i]));
    z += MODEL.tempo * x[BASE_FEATURES.length];
    expect(z).toBeCloseTo(modelLogit(MODEL, s, reg, 0), 9);
    expect(x.length).toBe(dimOf(sp));
  });
});

describe('学習', () => {
  it('ロジスティック回帰は、合成データの重みを復元する', () => {
    const dim = 4;
    const truth = [1.5, -2, 0.5, 0];
    const rand = mulberry(7);
    const samples: Sample[] = [];
    for (let i = 0; i < 4000; i++) {
      const x = new Float64Array(dim).map(() => rand() * 2 - 1);
      const z = x.reduce((a, v, j) => a + v * truth[j], 0);
      const y = rand() < 1 / (1 + Math.exp(-z)) ? 1 : 0;
      samples.push({ x, y, game: i, turn: 1, hand: 0 });
    }
    const w = fitLogistic(samples, dim, dim, { lambdaBase: 0.1, lambdaCard: 0.1 });
    truth.forEach((t, j) => expect(Math.abs(w[j] - t)).toBeLessThan(0.4));
    expect(evaluateFit(samples, w).logLoss).toBeLessThan(0.6);
  });
  it('自己対戦から局面を集められる(ラベルは 0/1、再現できる)', () => {
    const pairs = [{ a: deckCards('maruru'), b: deckCards('zardy') }];
    const sp = featureSpace([]);
    const a = generateSamples(reg, pairs, 4, 11, sp, [0.1]);
    const b = generateSamples(reg, pairs, 4, 11, sp, [0.1]);
    expect(a.length).toBeGreaterThan(10);
    expect(a.every((r) => r.y === 0 || r.y === 1)).toBe(true);
    expect(a.map((r) => r.y)).toEqual(b.map((r) => r.y));
  }, 60000);
});
