import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../../src/cards';
import { measureCardStrength } from '../../src/sim/strength';

describe('measureCardStrength(カード単体の強さ)', () => {
  const deck = deckCards('maruru');
  const run = (o: Partial<Parameters<typeof measureCardStrength>[1]> = {}) =>
    measureCardStrength(CARD_DB, { deck, opponent: deckCards('zardy'), agent: { kind: 'random' }, games: 6, seed: 1, ...o });

  it('デッキに含まれる異なるカードごとに1行返り、枚数が一致する', () => {
    const r = run();
    const kinds = new Set(deck);
    expect(r).toHaveLength(kinds.size);
    for (const row of r) {
      expect(kinds.has(row.defId)).toBe(true);
      expect(row.copies).toBe(deck.filter((x) => x === row.defId).length);
      expect(row.name).toBe(CARD_DB[row.defId].name);
    }
  });
  it('勝率差は 基準 − 抜いた時 で、区間は差を含み、勝率差の降順に並ぶ', () => {
    const r = run();
    for (const row of r) {
      expect(row.delta).toBeCloseTo(row.winRateBase - row.winRateWithout, 12);
      expect(row.ci95[0]).toBeLessThanOrEqual(row.delta);
      expect(row.ci95[1]).toBeGreaterThanOrEqual(row.delta);
      expect(row.winRateBase).toBe(r[0].winRateBase); // 基準は全行で共通
    }
    for (let i = 1; i < r.length; i++) expect(r[i - 1].delta).toBeGreaterThanOrEqual(r[i].delta);
  });
  it('進捗はカードの種類数だけ通知される', () => {
    const calls: [number, number][] = [];
    run({ onProgress: (d, t) => calls.push([d, t]) });
    const kinds = new Set(deck).size;
    expect(calls).toHaveLength(kinds);
    expect(calls[calls.length - 1]).toEqual([kinds, kinds]);
  });
  it('同じシードなら同じ結果', () => {
    expect(run()).toEqual(run());
  });
  it('元のデッキ配列は書き換えない', () => {
    const copy = deck.slice();
    run();
    expect(deck).toEqual(copy);
  });
});
