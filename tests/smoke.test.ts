import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../src/cards';
import { checkDeck, createGame, legalActions, loadRegistryFor, step } from './helpers';

describe('スモーク', () => {
  it('2デッキが40枚で、全カードが読み込める', () => {
    for (const id of ['maruru', 'zardy']) {
      const d = deckCards(id);
      expect(d.length).toBe(40);
      expect(checkDeck(CARD_DB, d, true).ok).toBe(true);
    }
    expect(Object.keys(loadRegistryFor().defs).length).toBe(29); // 28種+ダミー
  });

  it('ゲームを開始して数手進められる', () => {
    const { state } = createGame(CARD_DB, { decks: [deckCards('maruru'), deckCards('zardy')], seed: 1, first: 0 });
    expect(state.pending?.why).toBe('turnAction');
    const la = legalActions(state, loadRegistryFor());
    expect(la.length).toBeGreaterThan(0);
    const r = step(state, la[0], CARD_DB);
    expect(r.state.turn).toBe(1);
  });
});
