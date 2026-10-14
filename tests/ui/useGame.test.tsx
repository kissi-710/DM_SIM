// @vitest-environment jsdom
// useGame(対戦の状態管理): 行動・取り消し・自動保存・再開・CPU の手番
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deckCards } from '../../src/cards';
import { AUTOSAVE_KEY, type Autosave } from '../../src/ui/autosave';
import { RECORD_VERSION } from '../../src/ui/record';
import { useGame, type GameSetup } from '../../src/ui/useGame';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const base = (over: Partial<GameSetup> = {}): GameSetup => ({
  decks: [deckCards('maruru'), deckCards('zardy')],
  deckNames: ['マルル', '5cザーディ'],
  seats: [
    { kind: 'human', agent: { kind: 'rule' } },
    { kind: 'human', agent: { kind: 'rule' } },
  ],
  first: 0,
  seed: 3,
  autoOrder: false,
  allowUndo: true,
  cpuDelayMs: 0,
  strict: true,
  ...over,
});

describe('useGame(人間同士)', () => {
  it('合法手を打つと、状態・行動列が進み、自動保存される', () => {
    const { result } = renderHook(() => useGame(base()));
    expect(result.current.session.actions).toHaveLength(0);
    expect(result.current.legal.length).toBeGreaterThan(0);
    act(() => result.current.perform(result.current.legal[0]));
    expect(result.current.session.actions).toHaveLength(1);
    expect(result.current.saveStatus).toBe('ok');
    const saved = JSON.parse(localStorage.getItem(AUTOSAVE_KEY)!) as Autosave;
    expect(saved.version).toBe(RECORD_VERSION);
    expect(saved.actions).toHaveLength(1);
    expect(saved.setup.resume).toBeUndefined();
  });
  it('不正な行動は、状態を進めず、エラーを出す', () => {
    const { result } = renderHook(() => useGame(base()));
    act(() => result.current.perform({ type: 'END_TURN' }));
    // 最初はマナチャージのステップ。END_TURN は合法ではない
    expect(result.current.session.actions).toHaveLength(0);
    expect(result.current.session.error).toBeTruthy();
  });
  it('1手戻す: 直前の手を取り消し、行動列・保存も戻る', () => {
    const { result } = renderHook(() => useGame(base()));
    act(() => result.current.perform(result.current.legal[0]));
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(result.current.session.actions).toHaveLength(0);
    // 最初の手の前に戻した: 取り消した手を、保存に残さない(再開で再生されてしまう)
    expect(localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
  });
  it('取り消しを許さない設定では、戻せない', () => {
    const { result } = renderHook(() => useGame(base({ allowUndo: false })));
    act(() => result.current.perform(result.current.legal[0]));
    expect(result.current.canUndo).toBe(false);
  });
  it('保存した行動列から再開すると、同じ局面になる(同じシード)', () => {
    const a = renderHook(() => useGame(base()));
    for (let i = 0; i < 3; i++) act(() => a.result.current.perform(a.result.current.legal[0]));
    const actions = a.result.current.session.actions;
    expect(actions).toHaveLength(3);
    const b = renderHook(() => useGame(base({ resume: actions })));
    expect(b.result.current.session.actions).toEqual(actions);
    expect(JSON.stringify(b.result.current.session.state)).toBe(JSON.stringify(a.result.current.session.state));
    expect(b.result.current.session.error).toBeNull();
  });
  it('再開で再生できない手があれば、何手目かを知らせ、その手前の局面から始める', () => {
    const a = renderHook(() => useGame(base()));
    act(() => a.result.current.perform(a.result.current.legal[0]));
    const good = a.result.current.session.actions;
    const b = renderHook(() => useGame(base({ resume: [...good, { type: 'ATTACK', attacker: 999, target: { kind: 'player' } }] })));
    expect(b.result.current.session.actions).toEqual(good);
    expect(b.result.current.session.error).toMatch(/2 手目で再生できませんでした/);
  });
  it('勝敗が決まっていない間は、保存のキーが残る', () => {
    const { result } = renderHook(() => useGame(base()));
    act(() => result.current.perform(result.current.legal[0]));
    expect(localStorage.getItem(AUTOSAVE_KEY)).not.toBeNull();
  });
});

describe('useGame(保存の失敗・別のタブ)', () => {
  it('保存できなければ failed を返す', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { result } = renderHook(() => useGame(base()));
    act(() => result.current.perform(result.current.legal[0]));
    expect(result.current.saveStatus).toBe('failed');
    spy.mockRestore();
  });
  it('前回の後に別のタブが書いていたら、other-tab を返す', () => {
    const { result } = renderHook(() => useGame(base()));
    act(() => result.current.perform(result.current.legal[0]));
    const mine = JSON.parse(localStorage.getItem(AUTOSAVE_KEY)!) as Autosave;
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ ...mine, tab: 'other-tab', at: mine.at + 5000 }));
    act(() => result.current.perform(result.current.legal[0]));
    expect(result.current.saveStatus).toBe('other-tab');
  });
});

describe('useGame(CPU の手番)', () => {
  it('CPU の手番になると、CPU が自分で手を決めて進める(Worker が無い環境では同期で決める)', async () => {
    const { result } = renderHook(() =>
      useGame(
        base({
          seats: [
            { kind: 'human', agent: { kind: 'rule' } },
            { kind: 'cpu', agent: { kind: 'random' } },
          ],
        }),
      ),
    );
    // 人間(席1)の手番を、最後まで(ターン終了まで)進める
    for (let guard = 0; guard < 40 && result.current.session.state.pending?.player === 0; guard++) {
      const legal = result.current.legal;
      const end = legal.find((a) => a.type === 'END_TURN') ?? legal.find((a) => a.type === 'SKIP_MANA') ?? legal.find((a) => a.type === 'END_MAIN') ?? legal[0];
      act(() => result.current.perform(end));
    }
    // 席2(CPU)の手番になり、CPU が動いて、再び人間の手番に戻る(または勝敗が出る)
    await waitFor(
      () => {
        const s = result.current.session.state;
        expect(s.turn).toBeGreaterThanOrEqual(2);
      },
      { timeout: 20000 },
    );
    expect(result.current.me).toBe(0);
  }, 40000);
});
