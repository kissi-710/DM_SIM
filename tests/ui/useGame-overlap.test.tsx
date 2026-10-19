// @vitest-environment jsdom
// CPU の手番: 演出・手の間隔の待ち時間の間にも、探索を進めておく(待ちと探索を重ねる)。
// 待ち + 探索 かかっていたものが、長いほうだけになる。何を打つかは変わらない。
import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deckCards } from '../../src/cards';
import { legalActions } from '../../src/engine/engine';
import { loadRegistry } from '../../src/engine/registry';
import { CARD_DB } from '../../src/cards';
import type { Action } from '../../src/engine/types';
import { useGame, type GameSetup } from '../../src/ui/useGame';

const reg = loadRegistry(CARD_DB);

// 探索を、決めた時間だけかかる偽物に差し替える(呼ばれた時刻と、渡された局面・シードを記録する)
const calls: { at: number; seed: number; state: unknown }[] = [];
let searchMs = 0;
let failNext = false;
const pending: Array<(e: Error) => void> = [];
vi.mock('../../src/ui/aiClient', () => ({
  AiCancelled: class AiCancelled extends Error {},
  // 本物と同じく、実行中の探索を、取り消しの失敗として返す
  cancelAi: () => {
    for (const reject of pending.splice(0)) reject(new Error('AI の思考を取り消しました'));
  },
  chooseWithWorker: (req: { state: Parameters<typeof legalActions>[0]; seed: number }): Promise<Action> => {
    calls.push({ at: Date.now(), seed: req.seed, state: req.state });
    const a = legalActions(req.state, reg)[0];
    return new Promise((resolve, reject) => {
      pending.push(reject);
      setTimeout(() => {
        if (failNext) {
          failNext = false;
          reject(new Error('探索の失敗'));
        } else resolve(a);
      }, searchMs);
    });
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  calls.length = 0;
  pending.length = 0;
  failNext = false;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const cpuGame = (cpuDelayMs: number): GameSetup => ({
  decks: [deckCards('maruru'), deckCards('zardy')],
  deckNames: ['マルル', '5cザーディ'],
  seats: [
    { kind: 'cpu', agent: { kind: 'random' } },
    { kind: 'cpu', agent: { kind: 'random' } },
  ],
  first: 0,
  seed: 5,
  autoOrder: false,
  allowUndo: false,
  cpuDelayMs,
  strict: true,
});

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const nActions = (r: { current: ReturnType<typeof useGame> }) => r.current.session.actions.length;

describe('CPU の手番: 待ち時間の間にも探索を進める', () => {
  it('待ち時間(間隔)が探索より長い時: 探索は待ちの最初から始まり、手は待ちが終わった時に打つ(探索の分を足さない)', async () => {
    searchMs = 400;
    const { result } = renderHook(() => useGame(cpuGame(1500)));
    await advance(0);
    expect(calls).toHaveLength(1); // 待たずに、すぐ探索を始める
    await advance(1400);
    expect(nActions(result)).toBe(0); // 探索は終わっている(400ms)が、待ちの間は打たない
    await advance(150);
    expect(nActions(result)).toBe(1); // 待ち(1500ms)が終わった時に打つ。1500 + 400 = 1900ms まではかからない
  });
  it('探索が待ち時間より長い時: 探索が終わった時に打つ(待ち + 探索 ではなく、長いほう)', async () => {
    searchMs = 3000;
    const { result } = renderHook(() => useGame(cpuGame(1000)));
    await advance(2900);
    expect(nActions(result)).toBe(0);
    await advance(150);
    expect(nActions(result)).toBe(1); // 3000ms。以前は 1000 + 3000 = 4000ms だった
  });
  it('探索に渡すのは、局面と、手数で決まるシードだけ(待ち時間・演出の設定で変わらない)', async () => {
    searchMs = 10;
    const seeds: number[][] = [];
    for (const [delay, mode] of [[0, 'off'], [1200, 'normal'], [300, 'fast']] as const) {
      calls.length = 0;
      const { result, unmount } = renderHook(() => useGame(cpuGame(delay), mode));
      await advance(delay + 100);
      await advance(delay + 100);
      expect(nActions(result)).toBeGreaterThanOrEqual(1);
      seeds.push(calls.slice(0, 2).map((c) => c.seed));
      unmount();
    }
    expect(seeds[1]).toEqual(seeds[0]);
    expect(seeds[2]).toEqual(seeds[0]);
  });
  it('待っている間に間隔の設定を変えても、探索を重ねて始めない(同じ局面の探索を使い回す)', async () => {
    searchMs = 800;
    const { result } = renderHook(() => useGame(cpuGame(2000)));
    await advance(100);
    expect(calls).toHaveLength(1);
    act(() => result.current.setSpeed(1000));
    await advance(100);
    expect(calls).toHaveLength(1); // 作り直した effect は、始めた探索を使い回す
    await advance(1200);
    expect(nActions(result)).toBe(1);
  });
  it('探索が失敗したら、エラーを出し、「もう一度考えさせる」で新しく探索する(失敗した探索を使い回さない)', async () => {
    searchMs = 50;
    failNext = true;
    const { result } = renderHook(() => useGame(cpuGame(100)));
    await advance(300);
    expect(result.current.session.error).toContain('探索の失敗');
    expect(nActions(result)).toBe(0);
    act(() => result.current.retryCpu());
    await advance(300);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(nActions(result)).toBeGreaterThanOrEqual(1);
  });
  it('StrictMode(開発時の効果の二重実行)で、画面の取り消しが、始めた探索を壊さない: エラーにならず、手を打つ', async () => {
    searchMs = 300;
    const { result } = renderHook(() => useGame(cpuGame(1000)), { wrapper: StrictMode });
    await advance(1500);
    expect(result.current.session.error).toBeNull();
    expect(nActions(result)).toBeGreaterThanOrEqual(1);
  });
});
