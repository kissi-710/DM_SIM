import { describe, expect, it } from 'vitest';
import { hypergeomAtLeast, hypergeomPmf, normalQuantile, wilson, zFamily } from '../../src/sim/stats';

describe('wilson(95%信頼区間)', () => {
  it('試行0回は [0, 1]', () => {
    expect(wilson(0, 0)).toEqual([0, 1]);
  });
  it('常に 0〜1 に収まり、下限 ≤ 上限', () => {
    for (const [k, n] of [[0, 1], [1, 1], [0, 50], [50, 50], [3, 7], [499, 1000]] as const) {
      const [lo, hi] = wilson(k, n);
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(1);
      expect(lo).toBeLessThanOrEqual(hi);
    }
  });
  it('全敗でも上限は0より大きく、全勝でも下限は1より小さい', () => {
    expect(wilson(0, 20)[0]).toBe(0);
    expect(wilson(0, 20)[1]).toBeGreaterThan(0);
    expect(wilson(20, 20)[1]).toBeCloseTo(1, 12);
    expect(wilson(20, 20)[0]).toBeLessThan(1);
  });
  it('推定値を含み、試行が増えると区間が狭まる', () => {
    const w1 = wilson(30, 100);
    const w2 = wilson(300, 1000);
    expect(w1[0]).toBeLessThan(0.3);
    expect(w1[1]).toBeGreaterThan(0.3);
    expect(w2[1] - w2[0]).toBeLessThan(w1[1] - w1[0]);
  });
  it('既知の値(50/100 → 約 0.404〜0.596)', () => {
    const [lo, hi] = wilson(50, 100);
    expect(lo).toBeCloseTo(0.4038, 3);
    expect(hi).toBeCloseTo(0.5962, 3);
  });
  it('z を大きくすると区間が広がる', () => {
    const a = wilson(40, 100, 1.0);
    const b = wilson(40, 100, 2.58);
    expect(b[1] - b[0]).toBeGreaterThan(a[1] - a[0]);
  });
});

describe('超幾何分布', () => {
  it('範囲外の k は確率0', () => {
    expect(hypergeomPmf(40, 4, 5, 5)).toBe(0); // 当たりは4枚しかない
    expect(hypergeomPmf(40, 4, 5, -1)).toBe(0);
    expect(hypergeomPmf(10, 8, 5, 2)).toBe(0); // 外れが2枚しかないので、5枚中の当たりは3枚以上
  });
  it('全確率の和は1(いくつかの組)', () => {
    for (const [N, K, n] of [[40, 4, 5], [40, 4, 10], [40, 12, 7], [30, 0, 5], [30, 30, 5], [11, 3, 11]] as const) {
      let t = 0;
      for (let k = 0; k <= n; k++) t += hypergeomPmf(N, K, n, k);
      expect(t).toBeCloseTo(1, 9);
    }
  });
  it('既知の値: 40枚中4枚、5枚引いて0枚 = C(36,5)/C(40,5)', () => {
    const exact = (36 * 35 * 34 * 33 * 32) / (40 * 39 * 38 * 37 * 36);
    expect(hypergeomPmf(40, 4, 5, 0)).toBeCloseTo(exact, 10);
  });
  it('期待値 = n·K/N', () => {
    let e = 0;
    for (let k = 0; k <= 8; k++) e += k * hypergeomPmf(40, 8, 8, k);
    expect(e).toBeCloseTo((8 * 8) / 40, 9);
  });
  it('atLeast: 0枚以上は常に1、当たりより多く要求すると0', () => {
    expect(hypergeomAtLeast(40, 4, 5, 0)).toBeCloseTo(1, 12);
    expect(hypergeomAtLeast(40, 4, 5, 5)).toBe(0);
  });
  it('atLeast: 引く枚数が増えると確率は単調に増える', () => {
    let prev = 0;
    for (let n = 0; n <= 20; n++) {
      const p = hypergeomAtLeast(40, 4, n, 1);
      expect(p).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = p;
    }
  });
  it('atLeast: 山札の全部を引けば、当たりが1枚でもあれば確率1', () => {
    expect(hypergeomAtLeast(40, 1, 40, 1)).toBeCloseTo(1, 12);
  });
  it('atLeast は 1 を超えない', () => {
    expect(hypergeomAtLeast(40, 40, 40, 0)).toBeLessThanOrEqual(1);
  });
});

describe('normalQuantile / zFamily(同時比較の補正)', () => {
  it('よく知られた分位点と一致する', () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 9);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0.995)).toBeCloseTo(2.575829, 5);
    expect(normalQuantile(0.9)).toBeCloseTo(1.281552, 5);
    expect(normalQuantile(0.025)).toBeCloseTo(-1.959964, 5);
  });
  it('対称で、端(裾)でも単調に増える', () => {
    for (const p of [0.001, 0.01, 0.03, 0.2, 0.4]) expect(normalQuantile(p)).toBeCloseTo(-normalQuantile(1 - p), 9);
    let prev = -Infinity;
    for (const p of [1e-6, 1e-4, 0.01, 0.02, 0.03, 0.3, 0.5, 0.7, 0.97, 0.98, 0.9999, 1 - 1e-6]) {
      const z = normalQuantile(p);
      expect(z).toBeGreaterThan(prev);
      prev = z;
    }
  });
  it('範囲外は ±∞', () => {
    expect(normalQuantile(0)).toBe(-Infinity);
    expect(normalQuantile(1)).toBe(Infinity);
  });
  it('zFamily: 1つなら 1.96、k が増えるほど大きい(Bonferroni)', () => {
    expect(zFamily(1)).toBeCloseTo(1.959964, 5);
    expect(zFamily(16)).toBeGreaterThan(zFamily(4));
    expect(zFamily(4)).toBeGreaterThan(zFamily(1));
    expect(zFamily(16)).toBeCloseTo(normalQuantile(1 - 0.05 / 32), 12);
    expect(zFamily(0)).toBeCloseTo(zFamily(1), 12);
  });
});
