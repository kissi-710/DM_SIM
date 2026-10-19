// @vitest-environment jsdom
// 「演出中も考える」: 待ち時間の間の探索の予算を延ばす(thinkInFx.ts)。設定・警告・探索への反映
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STRONG_TUNING, type AgentSpec } from '../../src/ai';
import { CARD_DB, deckCards } from '../../src/cards';
import { legalActions } from '../../src/engine/engine';
import { loadRegistry } from '../../src/engine/registry';
import type { Action } from '../../src/engine/types';
import { GameView } from '../../src/ui/GameView';
import { SetupScreen } from '../../src/ui/SetupScreen';
import {
  loadThinkInFx,
  saveThinkInFx,
  THINK_IN_FX_KEY,
  THINK_IN_FX_MIN_MS,
  thinkInFxWarning,
  thinkSpecFor,
} from '../../src/ui/thinkInFx';
import { useGame, type GameSetup } from '../../src/ui/useGame';

const reg = loadRegistry(CARD_DB);

// 探索を偽物に差し替え、渡された設定(spec)を記録する
const specs: AgentSpec[] = [];
vi.mock('../../src/ui/aiClient', () => ({
  AiCancelled: class AiCancelled extends Error {},
  cancelAi: () => {},
  aiEngine: () => 'ts',
  onAiEngine: () => () => {},
  warmAi: () => {},
  aiParallelism: () => 1,
  chooseWithWorker: (req: { state: Parameters<typeof legalActions>[0]; spec: AgentSpec }): Promise<Action> => {
    specs.push(req.spec);
    return Promise.resolve(legalActions(req.state, reg)[0]);
  },
}));

beforeEach(() => {
  localStorage.clear();
  specs.length = 0;
});
afterEach(cleanup);

const mcts = (over: Partial<AgentSpec> = {}): AgentSpec => ({ kind: 'mcts', ms: 1200, ...over });

describe('thinkSpecFor', () => {
  it('オフなら、設定のまま(同じオブジェクト)', () => {
    const s = mcts();
    expect(thinkSpecFor(s, 3000, false)).toBe(s);
  });
  it('探索(mcts)以外・反復回数を決めた設定は、延ばさない', () => {
    for (const s of [{ kind: 'rule' } as AgentSpec, { kind: 'random' } as AgentSpec, mcts({ iterations: 300 })]) expect(thinkSpecFor(s, 3000, true)).toBe(s);
  });
  it('待ちが短い手(下限未満)は、延ばさない', () => {
    const s = mcts();
    expect(thinkSpecFor(s, THINK_IN_FX_MIN_MS - 1, true)).toBe(s);
    expect(thinkSpecFor(s, 0, true)).toBe(s);
  });
  it('待ちが十分なら、「強い」CPU の設定にする。最大の思考時間は延ばさない(測定で、延ばしても上乗せが測れなかった)', () => {
    for (const w of [THINK_IN_FX_MIN_MS, 1000, 2500, 60_000]) {
      const out = thinkSpecFor(mcts({ ms: 1200 }), w, true);
      expect(out.ms).toBe(1200);
      expect(out.tuning).toMatchObject(STRONG_TUNING);
    }
  });
  it('最大の思考時間が未指定なら、未指定のまま(探索の既定に任せる)', () => {
    const out = thinkSpecFor({ kind: 'mcts' }, 1500, true);
    expect(out.ms).toBeUndefined();
    expect(out.tuning).toMatchObject(STRONG_TUNING);
  });
  it('設定に明示した調整値は、強い設定より優先される。元の設定を書き換えない', () => {
    const s = mcts({ tuning: { precision: 0.02 } });
    const out = thinkSpecFor(s, 2000, true);
    expect(out.tuning?.precision).toBe(0.02);
    expect(out.tuning?.elimZ).toBe(STRONG_TUNING.elimZ);
    expect(s.tuning).toEqual({ precision: 0.02 });
    expect(s.ms).toBe(1200);
  });
});

describe('設定と警告', () => {
  it('既定はオフ。保存した値が次回に反映される。壊れた保存値はオフ', () => {
    expect(loadThinkInFx()).toBe(false);
    saveThinkInFx(true);
    expect(loadThinkInFx()).toBe(true);
    localStorage.setItem(THINK_IN_FX_KEY, '"yes"');
    expect(loadThinkInFx()).toBe(false);
    localStorage.setItem(THINK_IN_FX_KEY, '{oops');
    expect(loadThinkInFx()).toBe(false);
  });
  it('警告は、重くなる懸念と、強くなる幅が小さいことを伝える。論理コアが少ない PC には、そのことを足す', () => {
    const w = thinkInFxWarning(8);
    expect(w).toContain('⚠');
    expect(w).toContain('カクつく');
    expect(w).toContain('重く');
    expect(w).toContain('小さめ');
    expect(w).not.toContain('論理コア');
    expect(thinkInFxWarning(0)).not.toContain('論理コア'); // 分からない時は足さない
    expect(thinkInFxWarning(4)).toContain('論理コアが 4 個と少なく');
  });
});

const cpuGame = (over: Partial<GameSetup> = {}): GameSetup => ({
  decks: [deckCards('maruru'), deckCards('zardy')],
  deckNames: ['マルル', '5cザーディ'],
  seats: [
    { kind: 'cpu', agent: { kind: 'mcts', ms: 1200 } },
    { kind: 'cpu', agent: { kind: 'mcts', ms: 1200 } },
  ],
  first: 0,
  seed: 5,
  autoOrder: false,
  allowUndo: false,
  cpuDelayMs: 1500,
  strict: true,
  ...over,
});

describe('useGame: 探索への反映', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const run = async (think: boolean, delay: number) => {
    specs.length = 0;
    const { unmount } = renderHook(() => useGame(cpuGame({ cpuDelayMs: delay }), 'off', think));
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    unmount();
    return specs[0];
  };
  it('オフなら、設定のまま探索する(従来と同じ)', async () => {
    const s = await run(false, 1500);
    expect(s.ms).toBe(1200);
    expect(s.tuning).toBeUndefined();
  });
  it('オンで待ちが十分なら、強い設定で探索する(最大の思考時間は延ばさない)', async () => {
    const s = await run(true, 1500);
    expect(s.ms).toBe(1200);
    expect(s.tuning).toMatchObject(STRONG_TUNING);
  });
  it('オンでも、待ちが短い(間隔 300ms)なら、設定のまま', async () => {
    const s = await run(true, 300);
    expect(s.ms).toBe(1200);
    expect(s.tuning).toBeUndefined();
  });
});

describe('画面の部品', () => {
  it('対戦画面の「⚙ 表示」に、「演出中も考える」と警告が出て、切り替えを保存する', async () => {
    const setup: GameSetup = { ...cpuGame(), seats: [{ kind: 'human', agent: { kind: 'rule' } }, { kind: 'cpu', agent: { kind: 'rule' } }] };
    render(<GameView setup={setup} onExit={() => {}} onRematch={() => {}} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /表示/ }));
    const box = screen.getByLabelText(/演出中も考える/);
    expect(box).not.toBeChecked();
    expect(screen.getByRole('note').textContent).toContain('カクつく');
    await user.click(box);
    expect(box).toBeChecked();
    expect(JSON.parse(localStorage.getItem(THINK_IN_FX_KEY)!)).toBe(true);
  });
  it('設定画面にも、同じ選択と警告が出る', async () => {
    render(<SetupScreen mode="play" onBack={() => {}} onStart={() => {}} />);
    const box = screen.getByLabelText(/演出中も考える/);
    expect(box).not.toBeChecked();
    expect(screen.getAllByRole('note').some((n) => n.textContent?.includes('カクつく'))).toBe(true);
    await userEvent.setup().click(box);
    expect(loadThinkInFx()).toBe(true);
  });
});
