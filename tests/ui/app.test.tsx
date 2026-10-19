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
  // 対戦以外の画面は React.lazy で後から読み込む。読み込み後に、各画面が出ることを確かめる
  it.each([
    ['確率シミュレータ', /ソリティア調査/, '#/sim'],
    ['バッチ対戦', 'AI同士のバッチ対戦', '#/batch'],
    ['棋譜の再生', '棋譜の再生', '#/replay'],
    ['一人回し(手動)', '一人回し(手動)', '#/manual'],
    ['デッキ編集', 'デッキ編集', '#/decks'],
  ])('「%s」の画面を、遅延読み込みで開ける', async (tile, heading, hash) => {
    render(<App />);
    await userEvent.click(screen.getByText(tile));
    expect(await screen.findByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
    expect(location.hash).toBe(hash);
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
  it('対戦の途中でメニューへ戻ると、自動保存から再開できることを案内する', async () => {
    location.hash = '#/play-setup';
    render(<App />);
    const firstSel = screen.getAllByRole('combobox').find((s) => [...(s as HTMLSelectElement).options].some((o) => o.textContent === '席1が先攻'))!;
    await userEvent.selectOptions(firstSel, '0');
    await userEvent.click(await screen.findByRole('button', { name: '対戦開始' }));
    await userEvent.click(await screen.findByRole('button', { name: /マナチャージしない/ }));
    await waitFor(() => expect(localStorage.getItem(AUTOSAVE_KEY)).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /メニュー/ }));
    expect(await screen.findByRole('status')).toHaveTextContent(/自動保存されているので/);
    expect(screen.getByRole('button', { name: '続きから遊ぶ' })).toBeInTheDocument();
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
  it('モンテカルロの CPU を選ぶと、探索エンジンの種類を出す(Worker がない環境は TS 版)', async () => {
    render(<SetupScreen mode="watch" onBack={() => {}} onStart={start} />);
    expect(screen.queryByText(/探索エンジン/)).toBeNull();
    const strength = screen.getAllByRole('combobox').find((s) => [...(s as HTMLSelectElement).options].some((o) => o.value === 'mcts'))!;
    await userEvent.selectOptions(strength, 'mcts');
    expect(await screen.findByText(/探索エンジン: TS 版/)).toBeInTheDocument();
    expect(screen.getByText(/npm run build:wasm/)).toBeInTheDocument();
  });
  it('モンテカルロを選ぶと「強く考える」が出て、入れると、その席の設定に「強い」CPU の設定が入る(他の席には入らない)', async () => {
    render(<SetupScreen mode="watch" onBack={() => {}} onStart={start} />);
    expect(screen.queryByLabelText(/強く考える/)).toBeNull();
    const strength = screen.getAllByRole('combobox').filter((s) => [...(s as HTMLSelectElement).options].some((o) => o.value === 'mcts'));
    await userEvent.selectOptions(strength[0], 'mcts');
    await userEvent.selectOptions(strength[1], 'mcts');
    const boxes = screen.getAllByLabelText(/強く考える/);
    expect(boxes).toHaveLength(2);
    await userEvent.click(boxes[0]);
    await userEvent.click(screen.getByRole('button', { name: '観戦開始' }));
    const seats = start.mock.calls[0][0].seats;
    expect(seats[0].agent.tuning).toMatchObject({ elimZ: 99, precision: 0.003 });
    expect(seats[1].agent.tuning).toBeUndefined();
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
