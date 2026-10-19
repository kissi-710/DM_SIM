// @vitest-environment jsdom
// GameView(対戦画面): 人間の手番の表示と操作
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deckCards } from '../../src/cards';
import { GameView } from '../../src/ui/GameView';
import type { GameSetup } from '../../src/ui/useGame';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const setup = (over: Partial<GameSetup> = {}): GameSetup => ({
  decks: [deckCards('maruru'), deckCards('zardy')],
  deckNames: ['マルル', '5cザーディ'],
  seats: [
    { kind: 'human', agent: { kind: 'rule' } },
    { kind: 'cpu', agent: { kind: 'random' } },
  ],
  first: 0,
  seed: 4,
  autoOrder: false,
  allowUndo: true,
  cpuDelayMs: 0,
  strict: true,
  ...over,
});

describe('GameView の演出', () => {
  it('演出が有効なら、最初のターンの開始を見せ、盤面に fx の印が付く', async () => {
    const { container } = render(<GameView setup={setup()} onExit={() => {}} onRematch={() => {}} />);
    expect(container.querySelector('.game.fx')).not.toBeNull();
    expect(await screen.findByText('あなたのターン')).toBeInTheDocument();
  });
  it('手番のプレイヤーの盤面に印が付く(演出が無効でも残る情報表示)', () => {
    localStorage.setItem('dmsim.fx', JSON.stringify({ enabled: false }));
    const { container } = render(<GameView setup={setup()} onExit={() => {}} onRematch={() => {}} />);
    expect(container.querySelectorAll('.side-board.turn-active')).toHaveLength(1);
    expect(container.querySelector('.fx-ticker')).toBeNull();
  });
  it('手番の色: 自分の番は mine(青)、相手の番は theirs(赤)。演出が無効でも付く', () => {
    localStorage.setItem('dmsim.fx', JSON.stringify({ mode: 'off' }));
    const mine = render(<GameView setup={setup({ first: 0 })} onExit={() => {}} onRematch={() => {}} />);
    expect(mine.container.querySelector('.game')!.getAttribute('data-turn')).toBe('mine');
    mine.unmount();
    // CPU が先攻(最初の描画では、まだ CPU の番)
    const theirs = render(<GameView setup={setup({ first: 1 })} onExit={() => {}} onRematch={() => {}} />);
    expect(theirs.container.querySelector('.game')!.getAttribute('data-turn')).toBe('theirs');
  });
  it('観戦では、1P の番が mine、2P の番が theirs', () => {
    const watch = setup({
      first: 1,
      seats: [
        { kind: 'cpu', agent: { kind: 'random' } },
        { kind: 'cpu', agent: { kind: 'random' } },
      ],
    });
    const { container } = render(<GameView setup={watch} onExit={() => {}} onRematch={() => {}} />);
    expect(container.querySelector('.game')!.getAttribute('data-turn')).toBe('theirs');
  });
  it('「高速」にすると、演出は有効なまま長さの倍率が半分になる', async () => {
    const { container } = render(<GameView setup={setup()} onExit={() => {}} onRematch={() => {}} />);
    await screen.findByText('あなたのターン');
    await userEvent.click(screen.getByRole('button', { name: /表示/ }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /演出/ }), 'fast');
    const game = container.querySelector<HTMLElement>('.game')!;
    expect(game.classList.contains('fx')).toBe(true);
    expect(game.classList.contains('fx-fast')).toBe(true);
    expect(game.style.getPropertyValue('--fx-scale')).toBe('0.5');
    expect(JSON.parse(localStorage.getItem('dmsim.fx')!)).toEqual({ mode: 'fast' });
  });
  it('演出スキップ(保存された設定が無効)なら、オーバーレイも fx の印も出ない', () => {
    localStorage.setItem('dmsim.fx', JSON.stringify({ enabled: false }));
    const { container } = render(<GameView setup={setup()} onExit={() => {}} onRematch={() => {}} />);
    expect(container.querySelector('.game.fx')).toBeNull();
    expect(container.querySelector('.fx-layer')).toBeNull();
  });
  it('演出の設定を「オフ」にすると、その場で演出が消え、設定が保存される', async () => {
    const { container } = render(<GameView setup={setup()} onExit={() => {}} onRematch={() => {}} />);
    await screen.findByText('あなたのターン');
    await userEvent.click(screen.getByRole('button', { name: /表示/ }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /演出/ }), 'off');
    expect(container.querySelector('.fx-layer')).toBeNull();
    expect(container.querySelector('.game.fx')).toBeNull();
    expect(JSON.parse(localStorage.getItem('dmsim.fx')!)).toEqual({ mode: 'off' });
  });
});

describe('GameView', () => {
  it('人間の手番では、手札のカードが操作できるボタンとして出て、ステップ・ターンが表示される', () => {
    render(<GameView setup={setup()} onExit={() => {}} onRematch={() => {}} />);
    expect(document.querySelector('.status-chip')?.textContent).toMatch(/1ターン目/);
    expect(screen.getByText(/マナチャージ/, { selector: '.pill, .step, span, div' })).toBeInTheDocument();
    const hand = screen.getAllByRole('button').filter((b) => b.classList.contains('card'));
    expect(hand.length).toBeGreaterThanOrEqual(5);
    // 手札のカードは、名前を読み上げられる
    expect(hand.every((b) => !!b.getAttribute('aria-label'))).toBe(true);
  });
  it('「マナチャージしない」を押すと、メインステップに進む', async () => {
    render(<GameView setup={setup()} onExit={() => {}} onRematch={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /マナチャージしない/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /マナチャージしない/ })).toBeNull());
    expect(screen.getAllByText(/メイン/).length).toBeGreaterThan(0);
  });
  it('手札のカードを選ぶと、そのカードでできる操作が出る(マナチャージ)', async () => {
    render(<GameView setup={setup()} onExit={() => {}} onRematch={() => {}} />);
    const hand = screen.getAllByRole('button').filter((b) => b.classList.contains('card'));
    await userEvent.click(hand[0]);
    expect((await screen.findAllByRole('button', { name: /マナ/ })).length).toBeGreaterThan(0);
  });
  it('メニューへ戻る操作で onExit が呼ばれる', async () => {
    const onExit = vi.fn();
    render(<GameView setup={setup()} onExit={onExit} onRematch={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /メニュー/ }));
    expect(onExit).toHaveBeenCalled();
  });
  it('観戦(CPU 同士)では、人間の入力パネルは出ず、考え中の表示が出る', () => {
    render(
      <GameView
        setup={setup({ seats: [{ kind: 'cpu', agent: { kind: 'random' } }, { kind: 'cpu', agent: { kind: 'random' } }] })}
        onExit={() => {}}
        onRematch={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /マナチャージしない/ })).toBeNull();
  });
});

describe('GameView: キーボード操作', () => {
  const mount = (over: Partial<GameSetup> = {}, onExit: () => void = () => {}) =>
    render(<GameView setup={setup(over)} onExit={onExit} onRematch={() => {}} />);
  const chip = () => document.querySelector('.status-chip')!.textContent ?? '';

  it('M でマナチャージを飛ばしてメインに進む', async () => {
    mount();
    await userEvent.keyboard('m');
    await waitFor(() => expect(chip()).toMatch(/メイン/));
  });
  it('日本語 IME が ON(key が Process)でも、物理キーで操作できる', async () => {
    mount();
    fireEvent.keyDown(document.body, { key: 'Process', code: 'KeyM', keyCode: 229 });
    await waitFor(() => expect(chip()).toMatch(/メイン/));
  });
  it('押しっぱなし(キーリピート)は無視する', async () => {
    mount();
    fireEvent.keyDown(document.body, { key: 'm', repeat: true });
    expect(chip()).toMatch(/マナチャージ/);
  });
  it('マナステップから E: 1回目は確認、2回目でマナチャージを飛ばしてそのままターンを終える', async () => {
    mount();
    await userEvent.keyboard('e');
    expect(await screen.findByRole('button', { name: /もう一度で終了/ })).toBeInTheDocument();
    expect(chip()).toMatch(/あなた/);
    await userEvent.keyboard('e');
    await waitFor(() => expect(chip()).toMatch(/相手/));
  });
  it('矢印キーで手札のカードを選び、↑ ↓ は列がなければ動かない', async () => {
    mount();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.querySelectorAll('.card.selected').length).toBe(1);
    await userEvent.keyboard('{ArrowUp}');
    expect(document.querySelectorAll('.card.selected').length).toBe(1);
    await userEvent.keyboard('{Escape}');
    expect(document.querySelectorAll('.card.selected').length).toBe(0);
  });
  it('Q は2回押してメニューへ戻る(1回目は確認)', async () => {
    const onExit = vi.fn();
    mount({}, onExit);
    await userEvent.keyboard('q');
    expect(onExit).not.toHaveBeenCalled();
    await userEvent.keyboard('q');
    expect(onExit).toHaveBeenCalledTimes(1);
  });
  it('? でヘルプが開き、Esc で閉じる。ボタンの kbd は読み上げの名前に混ざらない', async () => {
    mount();
    await userEvent.keyboard('?');
    expect(await screen.findByRole('dialog', { name: '操作ヘルプ' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '操作ヘルプ' })).toBeNull());
    expect(screen.getByRole('button', { name: 'マナチャージしない' })).toBeInTheDocument();
  });
  it('G で自分の墓地の一覧が開く', async () => {
    mount();
    await userEvent.keyboard('g');
    expect(await screen.findByRole('heading', { name: /自分の墓地/ })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('heading', { name: /自分の墓地/ })).toBeNull());
  });
  it('棋譜ダイアログは、テキスト欄にフォーカスがあっても Esc で閉じる', async () => {
    mount();
    await userEvent.keyboard('k');
    const ta = await screen.findByRole('textbox');
    ta.focus();
    expect(document.activeElement).toBe(ta);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  });
  it('設定のチェックボックスにフォーカスがある時の矢印・Space は、ゲーム側のキーとして働かない', async () => {
    mount();
    await userEvent.keyboard('o');
    const box = (await screen.findAllByRole('checkbox'))[0] as HTMLInputElement;
    box.focus();
    const before = box.checked;
    await userEvent.keyboard('{ArrowRight}');
    expect(document.querySelectorAll('.card.selected').length).toBe(0);
    await userEvent.keyboard(' ');
    expect(box.checked).toBe(!before);
  });
});

describe('GameView: 使えないカード', () => {
  it('メインステップで出せないカードをクリックすると、理由が出る', async () => {
    render(<GameView setup={setup()} onExit={() => {}} onRematch={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /マナチャージしない/ }));
    await waitFor(() => expect(document.querySelector('.status-chip')!.textContent).toMatch(/メイン/));
    const dim = document.querySelector<HTMLElement>('.hand .card.dim, .zone.hand .card.dim');
    expect(dim).not.toBeNull();
    await userEvent.click(dim!);
    await waitFor(() => expect(document.querySelector('.rail-hint.warn')?.textContent ?? '').toMatch(/マナが足りません|進化元|文明/));
  });
  it('カードは Tab で届き、Enter で選べる(Space でも)', async () => {
    render(<GameView setup={setup()} onExit={() => {}} onRematch={() => {}} />);
    const card = document.querySelector<HTMLElement>('.zone.hand .card.selectable')!;
    expect(card.getAttribute('tabindex')).toBe('0');
    card.focus();
    await userEvent.keyboard('{Enter}');
    expect(document.querySelectorAll('.card.selected').length).toBe(1);
    await userEvent.keyboard('{Escape}');
    card.focus();
    await userEvent.keyboard(' ');
    expect(document.querySelectorAll('.card.selected').length).toBe(1);
  });
  it('「一気に進める」は人間の手番でも出ていて、F で切り替わる(ヘッダーが揺れない)', async () => {
    render(<GameView setup={setup()} onExit={() => {}} onRematch={() => {}} />);
    const btn = screen.getByRole('button', { name: /一気に進める/ });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    await userEvent.keyboard('f');
    expect(screen.getByRole('button', { name: /一気に進める/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
