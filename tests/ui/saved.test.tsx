// @vitest-environment jsdom
// 保存した設定(localStorage)の読み込み: 古い保存・壊れた保存・消したデッキを選んでいた保存でも、画面が開ける
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ErrorBoundary } from '../../src/ui/ErrorBoundary';
import { deleteDeck, saveDeck } from '../../src/ui/decks';
import { loadSavedSetup, loadSavedSim } from '../../src/ui/saved';
import { SetupScreen } from '../../src/ui/SetupScreen';
import { SimView } from '../../src/ui/SimView';
import { GOAL_PRESETS } from '../../src/sim/goal';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const put = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));
const crashed = (el: React.ReactElement) => {
  const err = console.error;
  console.error = () => {};
  const r = render(<ErrorBoundary onReset={() => {}}>{el}</ErrorBoundary>);
  console.error = err;
  return r.container.querySelector('[role=alert]')?.textContent ?? null;
};

const BAD: unknown[] = [null, 5, 'x', [], {}, { seats: 5 }, { seats: [{ kind: 'x', agent: 'y', info: 'z', deck: 'nope' }, null] }, { trials: 'abc', seed: {}, maxNodes: 'x', goal: 5, deckId: 'nope', first: 7 }, { goal: { op: 'pred' } }];

describe('保存した席の「強く考える」', () => {
  it('真偽値なら読み込み、真偽値でなければ捨てる', () => {
    const seat = (strong: unknown) => ({ kind: 'cpu', agent: 'mcts', info: 'fair', deck: 'maruru', strong });
    put('dmsim.setup.play', { seats: [seat(true), seat('yes')] });
    const s = loadSavedSetup('play').seats!;
    expect(s[0].strong).toBe(true);
    expect('strong' in s[1]).toBe(false);
  });
});

describe('壊れた保存でも、設定・調査の画面が開ける', () => {
  for (const [i, v] of BAD.entries()) {
    it(`保存の形 #${i}: ${JSON.stringify(v)?.slice(0, 50)}`, () => {
      for (const k of ['dmsim.setup.play', 'dmsim.setup.watch', 'dmsim.sim']) put(k, v);
      expect(crashed(<SetupScreen mode="play" onBack={() => {}} onStart={() => {}} />)).toBeNull();
      expect(crashed(<SetupScreen mode="watch" onBack={() => {}} onStart={() => {}} />)).toBeNull();
      expect(crashed(<SimView />)).toBeNull();
    });
  }
  it('調査で選んでいた自作デッキを、デッキ編集で消しても、調査の画面が開ける(通常の操作で起きていた)', () => {
    saveDeck({ id: 'u1', name: '自作', cards: Array(40).fill('dummy') });
    put('dmsim.sim', { deckId: 'u1', trials: 50 });
    put('dmsim.setup.play', { seats: [{ kind: 'human', agent: 'rule', info: 'fair', deck: 'u1' }, { kind: 'cpu', agent: 'rule', info: 'fair', deck: 'zardy' }] });
    deleteDeck('u1');
    expect(crashed(<SimView />)).toBeNull();
    expect(crashed(<SetupScreen mode="play" onBack={() => {}} onStart={() => {}} />)).toBeNull();
    // 消したデッキだけが既定に戻り、ほかの項目は残る
    expect(loadSavedSim().deckId).toBeUndefined();
    expect(loadSavedSim().trials).toBe(50);
    expect(loadSavedSetup('play').seats).toBeUndefined();
  });
});

describe('loadSavedSetup / loadSavedSim', () => {
  it('正しい保存は、そのまま読める', () => {
    const seats = [
      { kind: 'human', agent: 'rule', info: 'fair', deck: 'maruru' },
      { kind: 'cpu', agent: 'mcts', info: 'partial', deck: 'zardy', hypo: 'デドダム' },
    ];
    put('dmsim.setup.play', { seats, first: '1', seed: '12', autoOrder: true, undo: false, delay: 100, think: 800 });
    expect(loadSavedSetup('play')).toEqual({ seats, first: '1', seed: '12', autoOrder: true, undo: false, delay: 100, think: 800 });
    put('dmsim.sim', { deckId: 'zardy', first: 1, goal: GOAL_PRESETS[2].goal, trials: 10, seed: 3, maxNodes: 500, agent: 'random', must: 'a', exclude: 'b', topFixed: 'c' });
    expect(loadSavedSim()).toMatchObject({ deckId: 'zardy', first: 1, trials: 10, seed: 3, maxNodes: 500, agent: 'random', must: 'a' });
    expect(loadSavedSim().goal).toEqual(GOAL_PRESETS[2].goal);
  });
  it('範囲外・型違いの項目だけを捨てる', () => {
    put('dmsim.setup.watch', { first: 'x', delay: 99999, think: 'a', autoOrder: 'yes', seed: 5 });
    expect(loadSavedSetup('watch')).toEqual({});
    put('dmsim.sim', { trials: 0, maxNodes: -1, seed: 'a', agent: 'mcts', goal: { op: 'and', args: [] } });
    expect(loadSavedSim()).toEqual({});
  });
});
