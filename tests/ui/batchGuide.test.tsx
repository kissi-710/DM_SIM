// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BatchGuide, gamesNeeded, halfWidth, verdict } from '../../src/ui/BatchGuide';

describe('バッチの参考資料', () => {
  it('必要な試合数は 95% 区間の半幅の式どおり', () => {
    expect(gamesNeeded(0.5, 0.01)).toBe(9604);
    expect(gamesNeeded(0.8, 0.01)).toBe(6147);
    expect(gamesNeeded(0.5, 0.05)).toBe(385);
  });
  it('半幅と必要試合数が往復する', () => {
    expect(halfWidth(0.5, 9604)).toBeCloseTo(0.01, 5);
  });
  it('反復を2倍にした時の伸びを判定する', () => {
    expect(verdict(0.568)).toBe('伸びる');
    expect(verdict(0.52)).toBe('緩やか');
    expect(verdict(0.505)).toBe('ほぼ飽和');
  });
  it('パネルを描画できる', () => {
    render(<BatchGuide games={500} iterations={40} />);
    expect(screen.getByText(/参考資料/)).toBeTruthy();
  });
});
