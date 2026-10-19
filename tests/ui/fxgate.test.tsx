// @vitest-environment jsdom
// 演出が終わるまで、質問(入力パネル)を出さない門(useFxGate)
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFxGate } from '../../src/ui/useFxGate';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useFxGate', () => {
  it('演出がない(待ち 0)なら、最初から開いている(待たない)', () => {
    const { result } = renderHook(() => useFxGate(0, 'a'));
    expect(result.current).toBe(true);
  });
  it('演出がある間は閉じていて、終わったら開く', () => {
    const { result } = renderHook(() => useFxGate(1500, 'a'));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1499));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(2));
    expect(result.current).toBe(true);
  });
  it('新しい手(token が変わる)になると、その手の演出が終わるまで、また閉じる', () => {
    const { result, rerender } = renderHook(({ hold, token }) => useFxGate(hold, token), { initialProps: { hold: 1000, token: 'a' } });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(true);
    rerender({ hold: 2000, token: 'b' }); // 次の手。同じ描画から、もう閉じている(1フレームも開かない)
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe(true);
    rerender({ hold: 0, token: 'c' }); // 演出のない手は、待たない
    expect(result.current).toBe(true);
  });
  it('待っている間に演出が無効(待ち 0)になったら、すぐ開く', () => {
    const { result, rerender } = renderHook(({ hold }) => useFxGate(hold, 'a'), { initialProps: { hold: 3000 } });
    expect(result.current).toBe(false);
    rerender({ hold: 0 });
    expect(result.current).toBe(true);
  });
});
