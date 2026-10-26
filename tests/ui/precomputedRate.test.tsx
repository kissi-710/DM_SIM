// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PrecomputedRate, lookupRate, type MatrixData } from '../../src/ui/PrecomputedRate';

const data: MatrixData = {
  iterations: 80,
  head: 'x',
  decks: ['maruru', 'zardy'],
  cells: [{ a: 'maruru', b: 'zardy', games: 2000, rate: 0.7, lo: 0.68, hi: 0.72, aFirst: 0.75, aSecond: 0.65, draw: 0.01, turns: 6.2 }],
};

describe('事前計算した勝率', () => {
  it('保存と同じ向きは、そのまま返す', () => {
    expect(lookupRate(data, 'maruru', 'zardy')?.rate).toBe(0.7);
  });
  it('逆の向きは、勝率・区間・先攻後攻を反転して返す', () => {
    const r = lookupRate(data, 'zardy', 'maruru')!;
    expect(r.rate).toBeCloseTo(0.3, 10);
    expect([r.lo, r.hi]).toEqual([expect.closeTo(0.28, 10), expect.closeTo(0.32, 10)]);
    expect(r.aFirst).toBeCloseTo(0.35, 10); // zardy が先攻 = maruru が後攻の時の maruru の負け
    expect(r.aSecond).toBeCloseTo(0.25, 10);
  });
  it('未計算の組は null', () => {
    expect(lookupRate(data, 'maruru', 'sd1-c')).toBeNull();
  });
  it('パネルに勝率を出す', () => {
    render(<PrecomputedRate deckA="maruru" deckB="zardy" d={data} />);
    expect(screen.getByText('70.0%')).toBeTruthy();
  });
});
