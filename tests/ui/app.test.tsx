// @vitest-environment jsdom
// App(メニュー・画面遷移・自動保存の再開)と SetupScreen のコンポーネントテスト
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deckCards } from '../../src/cards';
import { App } from '../../src/ui/App';
import { AUTOSAVE_KEY, TAB_ID, type Autosave } from '../../src/ui/autosave';
import { RECORD_VERSION } from '../../src/ui/record';
import { SetupScreen } from '../../src/ui/SetupScreen';
import type { GameSetup } from '../../src/ui/useGame';

beforeEach(() => {
  localStorage.clear();
  location.hash = '';
});
afterEach(cleanup);

const setup = (): GameSetup => ({
  decks: [deckCards('maruru'), deckCards('zardy')],
  deckNames: ['マルル', '5cザーディ'],
  seats: [
    { kind: 'human', agent: { kind: 'rule' } },
    { kind: 'cpu', agent: { kind: 'random' } },
  ],
  first: 0,
  seed: 11,
  autoOrder: false,
  allowUndo: true,
  cpuDelayMs: 0,
  strict: true,
});

const saveAuto = (over: Partial<Autosave> = {}) =>
  localStorage.setItem(
    AUTOSAVE_KEY,
    JSON.stringify({ version: RECORD_VERSION, setup: setup(), actions: [{ type: 'SKIP_MANA' }], at: Date.now(), ...over } satisfies Autosave),
  );

describe('App: メニュー', () => {
  it('保存がなければ、再開の表示はなく、主な機能への入口が並ぶ', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'メニュー' })).toBeInTheDocument();
    expect(screen.queryByText('対戦を再開')).toBeNull();
    for (const name of ['CPUと対戦', 'CPU同士を観戦']) expect(screen.getByText(name)).toBeInTheDocument();
  });
  it('進行中の保存があれば、再開の表示と、手数・デッキ名を出す', () => {
    saveAuto();
    render(<App />);
    expect(screen.getByText('対戦を再開')).toBeInTheDocument();
    expect(screen.getByText(/マルル vs 5cザーディ/)).toBeInTheDocument();
    expect(screen.getByText(/1手目まで/)).toBeInTheDocument();
    expect(screen.queryByText(/別のタブで進行中/)).toBeNull();
  });
  it('別のタブが直近に書いた保存なら、上書きになることを知らせる', () => {
    saveAuto({ tab: 'another-tab-' + TAB_ID });
    render(<App />);
    expect(screen.getByText(/別のタブで進行中の対戦かもしれません/)).toBeInTheDocument();
  });
  it('「破棄」で保存を消し、再開の表示もなくなる', async () => {
    saveAuto();
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: '破棄' }));
    expect(localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
    expect(screen.queryByText('対戦を再開')).toBeNull();
  });
  it('版が合わない保存は、再開の表示を出さずに消す', () => {
    saveAuto({ version: RECORD_VERSION - 1 });
    render(<App />);
    expect(screen.queryByText('対戦を再開')).toBeNull();
    expect(localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
  });
  it('「CPUと対戦」で設定画面へ進み、URL の # に反映する', async () => {
    render(<App />);
    await userEvent.click(screen.getByText('CPUと対戦'));
    expect(await screen.findByRole('heading', { name: '対戦の設定' })).toBeInTheDocument();
    expect(location.hash).toBe('#/play-setup');
  });
});

describe('App: 対戦の開始と再開', () => {
  it('設定画面から対戦を始めると、対戦画面になり、最初の手を打つと自動保存される', async () => {
    location.hash = '#/play-setup';
    render(<App />);
    // 先攻を席1(人間)に決める(ランダムだと、CPU が先に動いて、最初に出る操作が変わる)
    const firstSel = screen.getAllByRole('combobox').find((s) => [...(s as HTMLSelectElement).options].some((o) => o.textContent === '席1が先攻'))!;
    await userEvent.selectOptions(firstSel, '0');
    await userEvent.click(await screen.findByRole('button', { name: '対戦開始' }));
    await waitFor(() => expect(location.hash).toBe('#/game'));
    // 人間(席1)の最初の手は、マナチャージの選択。「マナチャージしない」を押す
    await userEvent.click(await screen.findByRole('button', { name: /マナチャージしない/ }));
    await waitFor(() => expect(localStorage.getItem(AUTOSAVE_KEY)).not.toBeNull());
    const saved = JSON.parse(localStorage.getItem(AUTOSAVE_KEY)!) as Autosave;
    expect(saved.version).toBe(RECORD_VERSION);
    expect(saved.actions.length).toBeGreaterThan(0);
    expect(saved.tab).toBe(TAB_ID);
  });
  it('「続きから遊ぶ」で、保存した行動列を再生して対戦画面に入る', async () => {
    saveAuto();
    render(<App />);
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: '続きから遊ぶ' }));
    });
    await waitFor(() => expect(location.hash).toBe('#/game'));
    // 再生に成功すれば、エラーの表示は出ない
    expect(screen.queryByText(/再生できませんでした/)).toBeNull();
  });
});

describe('SetupScreen', () => {
  const start = vi.fn();
  beforeEach(() => start.mockReset());

  it('シードが整数でなければ、始めずにエラーを出す(0 は有効)', async () => {
    render(<SetupScreen mode="play" onBack={() => {}} onStart={start} />);
    const seed = screen.getByPlaceholderText(/例: 12345/);
    await userEvent.type(seed, 'abc');
    await userEvent.click(screen.getByRole('button', { name: '対戦開始' }));
    expect(screen.getByText(/シードは整数で入力してください/)).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
    await userEvent.clear(seed);
    await userEvent.type(seed, '0');
    await userEvent.click(screen.getByRole('button', { name: '対戦開始' }));
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0][0].seed).toBe(0);
  });
  it('決め打ちを選んだ時は、仮説のカードの入力欄が出て、空のままでは始められない', async () => {
    render(<SetupScreen mode="watch" onBack={() => {}} onStart={start} />);
    expect(screen.queryByText('仮説のカード')).toBeNull();
    const selects = screen.getAllByRole('combobox');
    const info = selects.find((s) => [...(s as HTMLSelectElement).options].some((o) => o.value === 'hypothesis'))!;
    await userEvent.selectOptions(info, 'hypothesis');
    expect(screen.getByText('仮説のカード')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '観戦開始' }));
    expect(screen.getByText(/決め打ち: 相手が持っていそうなカードを1枚以上入れてください/)).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
  });
  it('仮説に、相手のデッキにあるカードを入れれば始められ、情報条件に反映される', async () => {
    render(<SetupScreen mode="watch" onBack={() => {}} onStart={start} />);
    const info = screen.getAllByRole('combobox').find((s) => [...(s as HTMLSelectElement).options].some((o) => o.value === 'hypothesis'))!;
    await userEvent.selectOptions(info, 'hypothesis');
    // 席1の相手(席2)の既定デッキは 5cザーディ
    await userEvent.type(screen.getByPlaceholderText(/相手が手札に持っていそうなカード/), 'ブレイン・スラッシュ');
    await userEvent.click(screen.getByRole('button', { name: '観戦開始' }));
    expect(start).toHaveBeenCalledTimes(1);
    const policy = start.mock.calls[0][0].seats[0].agent.policy;
    expect(policy.preset).toBe('hypothesis');
    expect(policy.hypotheses).toHaveLength(1);
  });
});
