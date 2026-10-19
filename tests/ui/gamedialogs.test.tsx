// @vitest-environment jsdom
// 対戦画面のモーダル(支払い・棋譜)のコンポーネントテスト
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../../src/engine/types';
import { PayDialog, RecordDialog } from '../../src/ui/GameDialogs';
import { Sim, mana } from '../scenario';

afterEach(cleanup);

type Play = Extract<Action, { type: 'PLAY_CARD' }>;

/** アクアン(コスト4・水)を、水のマナ 6 枚から払う場面 */
function payProps() {
  const sim = new Sim({ p0: { hand: ['アクアン'], mana: mana(6, 'アクアン') } });
  const uid = sim.uid(0, 'hand', 'アクアン');
  const action: Play = { type: 'PLAY_CARD', uid, from: 'hand', face: 0 };
  const avail = sim.s.players[0].mana;
  return {
    s: sim.s,
    me: 0 as const,
    action,
    auto: avail.slice(0, 4),
    avail,
    error: null as string | null,
    onHover: vi.fn(),
    onError: vi.fn(),
    onPay: vi.fn(),
    onAuto: vi.fn(),
    onCancel: vi.fn(),
  };
}

describe('PayDialog', () => {
  it('カード名・必要な枚数・文明を出し、自動の候補を選択済みにする', () => {
    const { avail: _avail, ...p } = payProps();
    const { container } = render(<PayDialog {...p} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('タップするマナを選ぶ')).toBeInTheDocument();
    expect(container.textContent).toContain('アクアン — 4枚(水を含む)');
    expect(container.querySelectorAll('.card.selected')).toHaveLength(4);
  });
  it('「自動で払う」「キャンセル」・背景のクリックで、それぞれの通知が出る', async () => {
    const { avail: _avail, ...p } = payProps();
    const user = userEvent.setup();
    const { container } = render(<PayDialog {...p} />);
    await user.click(screen.getByRole('button', { name: /自動で払う/ }));
    expect(p.onAuto).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: /キャンセル/ }));
    expect(p.onCancel).toHaveBeenCalledTimes(1);
    await user.click(container.querySelector('.modal-back')!);
    expect(p.onCancel).toHaveBeenCalledTimes(2);
    expect(p.onPay).not.toHaveBeenCalled();
  });
  it('選び直して規定数になると、検証して onPay に選んだマナを渡す', async () => {
    const { avail, ...p } = payProps();
    const user = userEvent.setup();
    const { container } = render(<PayDialog {...p} />);
    const cards = [...container.querySelectorAll<HTMLElement>('.card')];
    await user.click(cards[1]); // 外す
    await user.click(cards[5]); // 別のマナを選ぶ: 4枚に戻る
    await waitFor(() => expect(p.onPay).toHaveBeenCalledWith([avail[0], avail[2], avail[3], avail[5]]));
    expect(p.onError).not.toHaveBeenCalled();
  });
  it('エラーの文言を出す', () => {
    const { avail: _avail, ...p } = payProps();
    render(<PayDialog {...p} error="文明を満たしていません" />);
    expect(screen.getByText('文明を満たしていません')).toBeInTheDocument();
  });
});

describe('RecordDialog', () => {
  it('棋譜の JSON を読み取り専用で出し、「閉じる」・背景のクリックで閉じる', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<RecordDialog seed={123} text={'{"a":1}'} onClose={onClose} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const ta = screen.getByRole<HTMLTextAreaElement>('textbox');
    expect(ta.value).toBe('{"a":1}');
    expect(ta.readOnly).toBe(true);
    await user.click(screen.getByRole('button', { name: '閉じる' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(container.querySelector('.modal-back')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
  it('棋譜として読めない文字列は、保存せずに閉じる', async () => {
    localStorage.clear();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<RecordDialog seed={1} text="これは棋譜ではない" onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'ブラウザに保存' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(0);
  });
});
