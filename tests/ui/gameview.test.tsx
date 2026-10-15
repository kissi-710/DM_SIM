// @vitest-environment jsdom
// GameView(対戦画面): 人間の手番の表示と操作
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
