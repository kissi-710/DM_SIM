// @vitest-environment jsdom
// 演出(離れたカード: 破壊・バウンスなど。ゴースト・チップ・CPU の待ち)と、高速でも CPU の手が変わらないこと
import { cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../../src/cards';
import { createGame, legalActions, step } from '../../src/engine/engine';
import { loadRegistry } from '../../src/engine/registry';
import type { Ev } from '../../src/engine/types';
import { FxGhosts } from '../../src/ui/FxGhosts';
import { FX_MS, fxHoldMs, GHOST_MS, removalCuesOf, removalsOf, scaleMs } from '../../src/ui/fx';
import { useGame, type GameSetup } from '../../src/ui/useGame';

const reg = loadRegistry(CARD_DB);

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const initial = () => createGame(reg, { decks: [deckCards('maruru'), deckCards('zardy')], seed: 7, first: 0 });
const mv = (id: number, uid: number, owner: number, from: string, to: string, cause: string): Ev =>
  ({ id, causedBy: null, type: 'moved', turn: 2, card: uid, owner, from, to, cause }) as Ev;

describe('removalsOf / removalCuesOf(カードが離れた時)', () => {
  it('場から墓地(破壊)・手札(バウンス)・マナなど、見えている移動だけを拾う', () => {
    const evs = [
      mv(1, 10, 1, 'battle', 'grave', 'destroy'),
      mv(2, 11, 1, 'battle', 'hand', 'bounce'),
      mv(3, 12, 0, 'battle', 'mana', 'manaPlace'),
      mv(4, 13, 0, 'hand', 'grave', 'discard'),
      mv(5, 14, 1, 'mana', 'grave', 'destroy'),
      // 見えない・関係のない移動は拾わない
      mv(6, 15, 0, 'deck', 'hand', 'draw'),
      mv(7, 16, 1, 'shield', 'hand', 'break'),
      mv(8, 17, 0, 'hand', 'battle', 'summon'),
      mv(9, 18, 0, 'hand', 'mana', 'charge'),
      mv(10, 19, 1, 'battle', 'limbo', 'x'),
    ];
    expect(removalsOf(evs).map((r) => [r.uid, r.label])).toEqual([
      [10, '破壊'],
      [11, '手札に戻る'],
      [12, 'マナゾーンへ'],
      [13, '捨てる'],
      [14, '破壊'],
    ]);
  });
  it('チップは持ち主・種類ごとにまとめ、名前は3つまで(ほかN枚)', () => {
    const s = initial().state;
    const hand = s.players[0].hand;
    const evs = hand.slice(0, 5).map((u, i) => mv(i + 1, u, 1, 'battle', 'grave', 'destroy'));
    const cues = removalCuesOf(s, evs, 0);
    expect(cues).toHaveLength(1);
    expect(cues[0].kind).toBe('remove');
    expect(cues[0].title.startsWith('破壊: ')).toBe(true);
    expect(cues[0].title).toMatch(/ほか\d+枚$/);
    expect(cues[0]).toMatchObject({ side: 'opp', sub: '相手' });
    const mixed = removalCuesOf(s, [mv(1, hand[0], 1, 'battle', 'grave', 'destroy'), mv(2, hand[1], 0, 'battle', 'grave', 'destroy')], 0);
    expect(mixed.map((c) => c.side)).toEqual(['opp', 'me']);
  });
  it('CPU の待ちは、バナーとゴーストの長いほう。高速は半分。離れたカードがなければゴーストの分はない', () => {
    const g = initial();
    const evs = [mv(1, g.state.players[0].hand[0], 1, 'battle', 'grave', 'destroy')];
    expect(fxHoldMs(g.state, evs, 0, 1)).toBe(GHOST_MS);
    expect(fxHoldMs(g.state, evs, 0, 0.5)).toBe(scaleMs(GHOST_MS, 0.5));
    expect(fxHoldMs(g.state, [], 0, 1)).toBe(0);
    // ターン開始(バナー)
    const r1 = step(g.state, legalActions(g.state, reg).find((a) => a.type === 'SKIP_MANA')!, reg);
    const r2 = step(r1.state, legalActions(r1.state, reg).find((a) => a.type === 'END_MAIN')!, reg);
    const r3 = step(r2.state, legalActions(r2.state, reg).find((a) => a.type === 'END_TURN')!, reg);
    expect(fxHoldMs(r3.state, r3.events, 0, 1)).toBe(FX_MS.turn);
    expect(fxHoldMs(r3.state, r3.events, 0, 0.5)).toBe(FX_MS.turn / 2);
  });
});

describe('FxGhosts(離れたカードを元の位置から行き先へ飛ばす)', () => {
  const rect = (x: number, y: number, w: number, h: number) => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y, toJSON() {} }) as DOMRect;
  const setup = () => {
    const s = initial().state;
    const uid = s.players[0].hand[0];
    const board = document.createElement('div');
    board.className = 'board';
    const card = document.createElement('div');
    card.dataset.uid = String(uid);
    card.getBoundingClientRect = () => rect(100, 200, 80, 100);
    const grave = document.createElement('div');
    grave.dataset.zone = 'grave:1';
    grave.getBoundingClientRect = () => rect(400, 50, 80, 60);
    board.append(card, grave);
    document.body.append(board);
    return { s, uid, board };
  };
  const rem = (uid: number, label = '破壊') => [{ uid, owner: 1, from: 'battle' as const, to: 'grave' as const, label }];

  it('新しい手で離れたカードを、直前の位置から行き先(墓地)へ飛ばす。名前とラベルを持つ', () => {
    const { s, uid, board } = setup();
    const { container, rerender } = render(<FxGhosts s={s} removals={[]} token={0} enabled scale={1} />);
    rerender(<FxGhosts s={s} removals={rem(uid)} token={1} enabled scale={1} />);
    const g = container.querySelector<HTMLElement>('.fx-ghost')!;
    expect(g).not.toBeNull();
    expect(g.classList.contains('destroy')).toBe(true);
    expect(g.textContent).toContain('破壊');
    expect(g.style.left).toBe('100px');
    expect(g.style.getPropertyValue('--dx')).toBe(`${440 - 140}px`); // 行き先の中心 - 元の中心
    expect(g.style.getPropertyValue('--dy')).toBe(`${80 - 250}px`);
    expect(g.style.animationDuration).toBe(`${GHOST_MS}ms`);
    board.remove();
  });
  it('高速は半分の長さ。無効なら出さない。同じ手では一度だけ', () => {
    const { s, uid, board } = setup();
    const fast = render(<FxGhosts s={s} removals={[]} token={0} enabled scale={0.5} />);
    fast.rerender(<FxGhosts s={s} removals={rem(uid)} token={1} enabled scale={0.5} />);
    fast.rerender(<FxGhosts s={s} removals={rem(uid)} token={1} enabled scale={0.5} />);
    expect(fast.container.querySelectorAll('.fx-ghost')).toHaveLength(1);
    expect(fast.container.querySelector<HTMLElement>('.fx-ghost')!.style.animationDuration).toBe(`${scaleMs(GHOST_MS, 0.5)}ms`);
    fast.unmount();
    const off = render(<FxGhosts s={s} removals={[]} token={0} enabled={false} scale={0} />);
    off.rerender(<FxGhosts s={s} removals={rem(uid)} token={1} enabled={false} scale={0} />);
    expect(off.container.querySelector('.fx-ghosts')).toBeNull();
    board.remove();
  });
  it('直前の位置が分からないカード(まだ描かれていなかった)は、ゴーストを出さない', () => {
    const { s, board } = setup();
    const { container, rerender } = render(<FxGhosts s={s} removals={[]} token={0} enabled scale={1} />);
    rerender(<FxGhosts s={s} removals={rem(99999)} token={1} enabled scale={1} />);
    expect(container.querySelector('.fx-ghost')).toBeNull();
    board.remove();
  });
});

describe('高速でも CPU の手は変わらない', () => {
  it('高速・通常・オフで、先頭の手が同じ', async () => {
    const mk = (): GameSetup => ({
      decks: [deckCards('maruru'), deckCards('zardy')],
      deckNames: ['マルル', '5cザーディ'],
      seats: [
        { kind: 'cpu', agent: { kind: 'random' } },
        { kind: 'cpu', agent: { kind: 'rule' } },
      ],
      first: 0,
      seed: 21,
      autoOrder: false,
      allowUndo: false,
      cpuDelayMs: 0,
      strict: true,
    });
    const run = async (m: 'normal' | 'fast' | 'off') => {
      const { result, unmount } = renderHook(() => useGame(mk(), m));
      await waitFor(() => expect(result.current.session.actions.length).toBeGreaterThanOrEqual(14), { timeout: 50000 });
      const a = result.current.session.actions.slice(0, 14);
      unmount();
      return a;
    };
    const off = await run('off');
    expect(await run('fast')).toEqual(off);
    expect(await run('normal')).toEqual(off);
  }, 150000);
});
