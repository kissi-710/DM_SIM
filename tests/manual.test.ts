import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../src/cards';
import { createGame } from '../src/engine/engine';
import { checkInvariants } from '../src/engine/invariants';
import { manualDraw, manualMove, manualNextTurn, manualToggleTap, manualUntapAll } from '../src/engine/manual';

describe('一人回し(手動)の操作', () => {
  const g = () => createGame(CARD_DB, { decks: [deckCards('maruru'), Array(40).fill('dummy')], seed: 3, first: 0, cfg: { solitaire: true } }).state;

  it('カードを自由に動かせ、不変条件が保たれる', () => {
    let s = g();
    const hand0 = s.players[0].hand[0];
    s = manualMove(CARD_DB, s, hand0, 'mana').state;
    expect(s.players[0].mana).toContain(hand0);
    s = manualMove(CARD_DB, s, hand0, 'battle').state;
    expect(s.players[0].battle.length).toBe(1);
    s = manualMove(CARD_DB, s, hand0, 'deck', { pos: 'bottom' }).state;
    expect(s.players[0].deck[s.players[0].deck.length - 1]).toBe(hand0);
    expect(checkInvariants(s)).toEqual([]);
  });
  it('ドロー・タップの切替・全アンタップ・次のターン', () => {
    let s = g();
    s = manualDraw(CARD_DB, s, 0, 2).state;
    expect(s.players[0].hand.length).toBe(7);
    const u = s.players[0].hand[0];
    s = manualMove(CARD_DB, s, u, 'mana').state;
    const was = s.cards[u].tapped; // 多色カードはタップ状態でマナゾーンに置かれる
    s = manualToggleTap(CARD_DB, s, u).state;
    expect(s.cards[u].tapped).toBe(!was);
    if (!s.cards[u].tapped) s = manualToggleTap(CARD_DB, s, u).state;
    expect(s.cards[u].tapped).toBe(true);
    s = manualUntapAll(s, 0, 'mana');
    expect(s.cards[u].tapped).toBe(false);
    const turn = s.turn;
    s = manualNextTurn(CARD_DB, s, 0, true).state;
    expect(s.turn).toBe(turn + 1);
    expect(s.players[0].hand.length).toBe(7);
  });
  it('効果の誘発は自動処理されず、待機プールは空になる', () => {
    let s = g();
    const u = s.players[0].deck.find((x) => s.cards[x].defId === 'dm23bd1-014') ?? s.players[0].hand[0];
    s = manualMove(CARD_DB, s, u, 'battle').state;
    expect(s.pool.length).toBe(0);
    expect(s.pending?.why).toBe('turnAction');
  });
});
