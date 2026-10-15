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

describe('GameView', () => {
  it('人間の手番では、手札のカードが操作できるボタンとして出て、ステップ・ターンが表示される', () => {
    render(<GameView setup={setup()} onExit={() => {}} onRematch={() => {}} />);
    expect(screen.getByText(/1ターン目/)).toBeInTheDocument();
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
});
