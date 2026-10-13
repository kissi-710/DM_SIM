import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../../src/cards';
import { createGame } from '../../src/engine/engine';
import { checkInvariants } from '../../src/engine/invariants';
import { manualDraw, manualMove, manualNextTurn, manualShuffle, manualToggleTap, manualUntapAll } from '../../src/engine/manual';
import type { GameState } from '../../src/engine/types';

const game = (): GameState =>
  createGame(CARD_DB, { decks: [deckCards('maruru'), Array(40).fill('dummy')], seed: 3, first: 0, cfg: { solitaire: true } }).state;

const toBattle = (s: GameState, uid: number) => manualMove(CARD_DB, s, uid, 'battle').state;

describe('manualMove', () => {
  it('入力の状態は書き換えない', () => {
    const s = game();
    const before = JSON.stringify(s);
    manualMove(CARD_DB, s, s.players[0].hand[0], 'grave');
    expect(JSON.stringify(s)).toBe(before);
  });
  it('どのゾーンへも動かせ、不変条件が保たれる', () => {
    for (const to of ['hand', 'mana', 'grave', 'shield', 'deck', 'battle'] as const) {
      const s = game();
      const u = s.players[0].hand[0];
      const r = manualMove(CARD_DB, s, u, to).state;
      expect(r.cards[u].zone).toBe(to);
      expect(checkInvariants(r)).toEqual([]);
    }
  });
  it('山札の上・下を指定できる', () => {
    const s = game();
    const u = s.players[0].hand[0];
    expect(manualMove(CARD_DB, s, u, 'deck', { pos: 'top' }).state.players[0].deck[0]).toBe(u);
    const bottom = manualMove(CARD_DB, s, u, 'deck', { pos: 'bottom' }).state.players[0].deck;
    expect(bottom[bottom.length - 1]).toBe(u);
  });
  it('tapped を指定すると、タップ状態でマナゾーンに置ける', () => {
    const s = game();
    const u = s.players[0].hand[0];
    expect(manualMove(CARD_DB, s, u, 'mana', { tapped: true }).state.cards[u].tapped).toBe(true);
  });
  it('効果は誘発せず、待機プールは空・状況起因処理待ちもなし', () => {
    const s = game();
    const u = s.players[0].deck.find((x) => s.cards[x].defId === 'dm23bd1-014')!; // デドダム
    const r = manualMove(CARD_DB, s, u, 'battle').state;
    expect(r.pool).toHaveLength(0);
    expect(r.dirtySba).toBe(false);
    expect(r.pending?.why).toBe('turnAction');
  });
  it('イベントが返る(moved)', () => {
    const s = game();
    const r = manualMove(CARD_DB, s, s.players[0].hand[0], 'grave');
    expect(r.events.some((e) => e.type === 'moved')).toBe(true);
  });
  it('バトルゾーンから離すと、山の中の他のカードも整合する', () => {
    let s = game();
    const [a, b] = s.players[0].hand;
    s = toBattle(s, a);
    s = toBattle(s, b);
    expect(s.players[0].battle).toHaveLength(2);
    s = manualMove(CARD_DB, s, a, 'grave').state;
    expect(s.players[0].battle).toHaveLength(1);
    expect(checkInvariants(s)).toEqual([]);
  });
});

describe('manualToggleTap', () => {
  it('バトルゾーンのクリーチャーはタップ ⇄ アンタップ', () => {
    let s = toBattle(game(), game().players[0].hand[0]);
    const pid = s.players[0].battle[0].pid;
    const tapped = () => s.players[0].battle.find((p) => p.pid === pid)!.tapped;
    expect(tapped()).toBe(false);
    s = manualToggleTap(CARD_DB, s, s.players[0].battle[0].cards[0]).state;
    expect(tapped()).toBe(true);
    s = manualToggleTap(CARD_DB, s, s.players[0].battle[0].cards[0]).state;
    expect(tapped()).toBe(false);
  });
  it('マナゾーンのカードもタップ ⇄ アンタップ', () => {
    let s = game();
    const u = s.players[0].hand[0];
    s = manualMove(CARD_DB, s, u, 'mana').state;
    const was = s.cards[u].tapped; // 多色カードはタップ状態で置かれる
    s = manualToggleTap(CARD_DB, s, u).state;
    expect(s.cards[u].tapped).toBe(!was);
    s = manualToggleTap(CARD_DB, s, u).state;
    expect(s.cards[u].tapped).toBe(was);
  });
});

describe('manualUntapAll', () => {
  const tappedBoard = () => {
    let s = game();
    const [a, b] = s.players[0].hand;
    s = manualMove(CARD_DB, s, a, 'mana', { tapped: true }).state;
    s = toBattle(s, b);
    s = manualToggleTap(CARD_DB, s, b).state;
    return { s, a, b };
  };
  it('mana: マナだけアンタップ', () => {
    const { s, a, b } = tappedBoard();
    const r = manualUntapAll(s, 0, 'mana');
    expect(r.cards[a].tapped).toBe(false);
    expect(r.players[0].battle.find((p) => p.cards[0] === b)!.tapped).toBe(true);
  });
  it('battle: クリーチャーだけアンタップ', () => {
    const { s, a, b } = tappedBoard();
    const r = manualUntapAll(s, 0, 'battle');
    expect(r.cards[a].tapped).toBe(true);
    expect(r.players[0].battle.find((p) => p.cards[0] === b)!.tapped).toBe(false);
  });
  it('all: 両方', () => {
    const { s, a, b } = tappedBoard();
    const r = manualUntapAll(s, 0, 'all');
    expect(r.cards[a].tapped).toBe(false);
    expect(r.players[0].battle.find((p) => p.cards[0] === b)!.tapped).toBe(false);
  });
  it('相手の盤面には触れない', () => {
    const s = game();
    const u = s.players[1].hand[0];
    const t = manualMove(CARD_DB, s, u, 'mana', { tapped: true }).state;
    expect(manualUntapAll(t, 0, 'all').cards[u].tapped).toBe(true);
  });
});

describe('manualDraw', () => {
  it('指定枚数を山札の上から引く', () => {
    const s = game();
    const top = s.players[0].deck.slice(0, 3);
    const r = manualDraw(CARD_DB, s, 0, 3).state;
    expect(r.players[0].hand.slice(-3)).toEqual(top);
    expect(r.players[0].deck).toHaveLength(s.players[0].deck.length - 3);
  });
  it('山札が尽きたら、そこで止まる(例外にならず、敗北もしない)', () => {
    const s = game();
    const r = manualDraw(CARD_DB, s, 0, 100).state;
    expect(r.players[0].deck).toHaveLength(0);
    expect(r.winner).toBeNull();
    expect(checkInvariants(r)).toEqual([]);
  });
  it('0枚なら何も起きない', () => {
    const s = game();
    expect(manualDraw(CARD_DB, s, 0, 0).state.players[0].hand).toEqual(s.players[0].hand);
  });
});

describe('manualNextTurn', () => {
  it('アンタップ・召喚酔いの解除・ターン加算・ドロー', () => {
    let s = game();
    const b = s.players[0].hand[0];
    s = toBattle(s, b);
    s.players[0].battle[0].sick = true;
    s = manualToggleTap(CARD_DB, s, b).state;
    const turn = s.turn;
    const hand = s.players[0].hand.length;
    const r = manualNextTurn(CARD_DB, s, 0, true).state;
    expect(r.turn).toBe(turn + 1);
    expect(r.players[0].battle[0].tapped).toBe(false);
    expect(r.players[0].battle[0].sick).toBe(false);
    expect(r.players[0].hand).toHaveLength(hand + 1);
  });
  it('draw=false ならドローしない', () => {
    const s = game();
    const r = manualNextTurn(CARD_DB, s, 0, false);
    expect(r.state.players[0].hand).toHaveLength(s.players[0].hand.length);
    expect(r.events).toEqual([]);
  });
});

describe('manualShuffle', () => {
  it('山札の並びが変わるが、カードの集合は同じ。同じ種なら同じ並び', () => {
    const s = game();
    const a = manualShuffle(s, 0, 5);
    const b = manualShuffle(s, 0, 5);
    expect(a.players[0].deck).toEqual(b.players[0].deck);
    expect(a.players[0].deck).not.toEqual(s.players[0].deck);
    expect([...a.players[0].deck].sort((x, y) => x - y)).toEqual([...s.players[0].deck].sort((x, y) => x - y));
    expect(checkInvariants(a)).toEqual([]);
  });
  it('元の状態と、相手の山札は変わらない', () => {
    const s = game();
    const before = JSON.stringify(s);
    const r = manualShuffle(s, 0, 9);
    expect(JSON.stringify(s)).toBe(before);
    expect(r.players[1].deck).toEqual(s.players[1].deck);
  });
  it('シードが 0 でも動く', () => {
    const s = game();
    expect(manualShuffle(s, 0, 0).players[0].deck).toHaveLength(s.players[0].deck.length);
  });
});
