// @vitest-environment jsdom
// 触って動かせる境界: 箱の計算(移動・8方向のサイズ変更・親に収める)と、仕切りから右の欄の幅を逆算する式、ログの重ね表示
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deckCards } from '../../src/cards';
import { clampBox, dragBox, railWidthFor, RAIL_MAX, RAIL_MIN, ResizablePanel, Splitter } from '../../src/ui/Resizable';
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
  it('中央寄せの間は、仕切りが指に付いてくる幅になる(仕切りの中心 = (stage + field - rail) / 2)', () => {
    const stageW = 1600;
    const f = 820;
    for (const r of [260, 300, 420]) {
      const x = (stageW + f - r) / 2;
      expect(railWidthFor(stageW, f, x)).toBe(r);
    }
  });
  it('狭くて field が収まらない時は、左端に寄せて field を縮める向きに逆算する', () => {
    // stage 1000、field 820 のまま 右の欄 260 だと 1090 で収まらない → 左端から field = x - 5、rail = stage - x - 5
    expect(railWidthFor(1000, 820, 700)).toBe(295);
  });
  it('下限・上限に収める', () => {
    expect(railWidthFor(1600, 820, 1500)).toBe(RAIL_MIN);
    expect(railWidthFor(1600, 820, 100)).toBe(RAIL_MAX);
  });
});

describe('Splitter', () => {
  it('左右キーで幅が変わり(←で広く)、ダブルクリックで元に戻る。矢印キーは盤面側に渡さない', () => {
    let w = 300;
    const onChange = (n: number) => (w = n);
    const stageRef = createRef<HTMLElement>();
    const fieldRef = createRef<HTMLElement>();
    const { rerender } = render(<Splitter width={w} onChange={onChange} stageRef={stageRef} fieldRef={fieldRef} />);
    const sep = screen.getByRole('separator');
    fireEvent.keyDown(sep, { key: 'ArrowLeft' });
    expect(w).toBe(320);
    rerender(<Splitter width={w} onChange={onChange} stageRef={stageRef} fieldRef={fieldRef} />);
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

describe('GameView: ログは盤面の上に重ねて出す', () => {
  it('L で、別の欄(列)を増やさず、盤面(.stage)の中にログが重なる。✕ と L で閉じる', async () => {
    render(<GameView setup={setup()} onExit={() => {}} onRematch={() => {}} />);
    expect(document.querySelector('.log-box')).toBeNull();
    await userEvent.keyboard('l');
    const box = await screen.findByRole('group', { name: '対戦ログ' });
    expect(document.querySelector('.stage')!.contains(box)).toBe(true);
    expect(document.querySelector('.side')).toBeNull();
    expect(document.querySelector('.game')!.className).not.toMatch(/side-closed/);
    await userEvent.click(screen.getByRole('button', { name: '閉じる' }));
    await waitFor(() => expect(document.querySelector('.log-box')).toBeNull());
    await userEvent.keyboard('l');
    await screen.findByRole('group', { name: '対戦ログ' });
    await userEvent.keyboard('l');
    await waitFor(() => expect(document.querySelector('.log-box')).toBeNull());
  });
  it('右の欄との境界(仕切り)があり、右の欄の幅は CSS 変数で持つ', () => {
    render(<GameView setup={setup()} onExit={() => {}} onRematch={() => {}} />);
    expect(screen.getByRole('separator')).toBeInTheDocument();
    expect((document.querySelector('.stage') as HTMLElement).style.getPropertyValue('--rail-w')).toBe('300px');
  });
});
