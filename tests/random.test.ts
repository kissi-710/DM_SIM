import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../src/cards';
import { randomAgent } from '../src/ai/random';
import { playGameSync } from '../src/sim/playGame';

describe('ランダム対戦', () => {
  it('マルル対ザーディを50試合、例外なく完走する', () => {
    let done = 0;
    for (let i = 0; i < 50; i++) {
      const r = playGameSync(CARD_DB, [randomAgent, randomAgent], {
        decks: [deckCards('maruru'), deckCards('zardy')],
        seed: i + 1,
      });
      expect(r.winner).not.toBeNull();
      done++;
    }
    expect(done).toBe(50);
  });
});
