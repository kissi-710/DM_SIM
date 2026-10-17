// @vitest-environment jsdom
// 触って動かせる境界: 箱の計算(移動・8方向のサイズ変更・親に収める)と、仕切りから右の欄の幅を逆算する式、ログの重ね表示
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deckCards } from '../../src/cards';
import { clampBox, dragBox, FIELD_MAX, railWidthFor, RAIL_MAX, RAIL_MIN, ResizablePanel, Splitter } from '../../src/ui/Resizable';
import { GameView } from '../../src/ui/GameView';
import type { GameSetup } from '../../src/ui/useGame';
import { createRef } from 'react';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const start = { x: 100, y: 80, w: 300, h: 200 };

describe('dragBox / clampBox', () => {
  it('move は位置だけ動かす', () => {
    expect(dragBox(start, 'move', 30, -20, 100, 100)).toEqual({ x: 130, y: 60, w: 300, h: 200 });
  });
  it('右・下の辺は大きさだけ、左・上の辺は位置と大きさを動かして反対側の辺は動かさない', () => {
    expect(dragBox(start, 'e', 50, 0, 100, 100)).toEqual({ x: 100, y: 80, w: 350, h: 200 });
    expect(dragBox(start, 's', 0, 40, 100, 100)).toEqual({ x: 100, y: 80, w: 300, h: 240 });
    const w = dragBox(start, 'w', -60, 0, 100, 100);
    expect(w).toEqual({ x: 40, y: 80, w: 360, h: 200 });
    expect(w.x + w.w).toBe(start.x + start.w);
    const n = dragBox(start, 'n', 0, -30, 100, 100);
    expect(n.y + n.h).toBe(start.y + start.h);
  });
  it('角は2辺とも動く', () => {
    expect(dragBox(start, 'se', 10, 20, 100, 100)).toEqual({ x: 100, y: 80, w: 310, h: 220 });
    expect(dragBox(start, 'nw', -10, -20, 100, 100)).toEqual({ x: 90, y: 60, w: 310, h: 220 });
  });
  it('最小より小さくならず、左・上の辺をつまんだ時も反対側の辺は動かない', () => {
    const r = dragBox(start, 'w', 500, 0, 120, 100);
    expect(r.w).toBe(120);
    expect(r.x + r.w).toBe(start.x + start.w);
    expect(dragBox(start, 'e', -500, 0, 120, 100).w).toBe(120);
  });
  it('親の外に出ない', () => {
    expect(clampBox({ x: -30, y: 500, w: 300, h: 200 }, 800, 600, 100, 100)).toEqual({ x: 0, y: 400, w: 300, h: 200 });
    expect(clampBox({ x: 0, y: 0, w: 5000, h: 5000 }, 800, 600, 100, 100)).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });
});

describe('railWidthFor', () => {
  it('盤面が上限に達していない間は、仕切りの右がすべて右の欄(仕切りがポインタに付いてくる)', () => {
    // stage 1000: 仕切りの中心が 700 なら、右の欄は 1000 - 700 - 5
    expect(railWidthFor(1000, 700)).toBe(295);
    expect(railWidthFor(1920, 1500)).toBe(415);
  });
  it('盤面が上限(FIELD_MAX)を超える広い画面では、余白を左右に分けるので、仕切りの中心 = (stage + FIELD_MAX - 右の欄) / 2', () => {
    const stageW = 3600;
    for (const r of [260, 300, 420]) {
      const x = (stageW + FIELD_MAX - r) / 2;
      expect(railWidthFor(stageW, x)).toBe(r);
    }
  });
  it('2つの場合の境目でも連続する', () => {
    const stageW = 3000;
    const x = FIELD_MAX + 5;
    expect(railWidthFor(stageW, x)).toBe(railWidthFor(stageW, x + 0.0001));
  });
  it('下限・上限に収める', () => {
    expect(railWidthFor(1600, 1500)).toBe(RAIL_MIN);
    expect(railWidthFor(1600, 100)).toBe(RAIL_MAX);
  });
});

describe('Splitter', () => {
  it('左右キーで幅が変わり(←で広く)、ダブルクリックで元に戻る。矢印キーは盤面側に渡さない', () => {
    let w = 300;
    const onChange = (n: number) => (w = n);
    const stageRef = createRef<HTMLElement>();
        const { rerender } = render(<Splitter width={w} onChange={onChange} stageRef={stageRef} />);
    const sep = screen.getByRole('separator');
    fireEvent.keyDown(sep, { key: 'ArrowLeft' });
    expect(w).toBe(320);
    rerender(<Splitter width={w} onChange={onChange} stageRef={stageRef} />);
    fireEvent.keyDown(sep, { key: 'ArrowRight' });
    expect(w).toBe(300);
    fireEvent.doubleClick(sep);
    expect(w).toBe(300);
  });
});

describe('ResizablePanel', () => {
  it('つまみ・8つの辺・角が出て、閉じるボタンで onClose が呼ばれる', async () => {
    let closed = 0;
    render(
      <ResizablePanel boxKey="t.box" className="x" title="テスト" onClose={() => closed++}>
        <p>中身</p>
      </ResizablePanel>,
    );
    expect(document.querySelectorAll('.rz').length).toBe(8);
    expect(document.querySelector('.rzp-grip')!.getAttribute('data-dir')).toBe('move');
    await userEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(closed).toBe(1);
  });
  it('保存した位置・大きさで開き、つまみのダブルクリックで元に戻って保存も消える', () => {
    localStorage.setItem('t.box', JSON.stringify({ x: 10, y: 20, w: 400, h: 300 }));
    render(
      <ResizablePanel boxKey="t.box" className="x" title="テスト">
        <p>中身</p>
      </ResizablePanel>,
    );
    const panel = screen.getByRole('group', { name: 'テスト' });
    expect(panel.style.left).toBe('10px');
    expect(panel.style.width).toBe('400px');
    fireEvent.doubleClick(document.querySelector('.rzp-grip')!);
    expect(panel.style.left).toBe('');
    expect(localStorage.getItem('t.box')).toBe('null');
  });
});

const setup = (): GameSetup => ({
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
});

describe('GameView: ログは右の欄(rail)の中に出す', () => {
  it('L で、別の欄(列)も浮かぶパネルも作らず、右の欄の中にログが出る。✕ と L で閉じる', async () => {
    render(<GameView setup={setup()} onExit={() => {}} onRematch={() => {}} />);
    expect(screen.queryByRole('region', { name: '対戦ログ' })).toBeNull();
    await userEvent.keyboard('l');
    const log = await screen.findByRole('region', { name: '対戦ログ' });
    expect(document.querySelector('.rail')!.contains(log)).toBe(true);
    expect(document.querySelector('.side, .log-box')).toBeNull();
    expect(document.querySelector('.game')!.className).not.toMatch(/side-closed/);
    await userEvent.click(screen.getByRole('button', { name: 'ログを閉じる' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: '対戦ログ' })).toBeNull());
    await userEvent.keyboard('l');
    await screen.findByRole('region', { name: '対戦ログ' });
    await userEvent.keyboard('l');
    await waitFor(() => expect(screen.queryByRole('region', { name: '対戦ログ' })).toBeNull());
  });
  it('観戦(CPU 同士)では、ログが主な情報なので、最初から右の欄に出ている', () => {
    const s = setup();
    s.seats = [
      { kind: 'cpu', agent: { kind: 'random' } },
      { kind: 'cpu', agent: { kind: 'random' } },
    ];
    render(<GameView setup={s} onExit={() => {}} onRematch={() => {}} />);
    const log = screen.getByRole('region', { name: '対戦ログ' });
    expect(document.querySelector('.rail')!.contains(log)).toBe(true);
  });
  it('右の欄との境界(仕切り)があり、右の欄の幅は CSS 変数で持つ', () => {
    render(<GameView setup={setup()} onExit={() => {}} onRematch={() => {}} />);
    expect(screen.getByRole('separator')).toBeInTheDocument();
    expect((document.querySelector('.stage') as HTMLElement).style.getPropertyValue('--rail-w')).toBe('300px');
  });
});
