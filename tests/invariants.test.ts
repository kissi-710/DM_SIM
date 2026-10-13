import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../src/cards';
import { randomAgent } from '../src/ai/random';
import { playGameSync } from '../src/sim/playGame';
import { checkInvariants } from '../src/engine/invariants';

const DECKS: [string, string][] = [['maruru', 'zardy'], ['zardy', 'maruru'], ['maruru', 'maruru'], ['zardy', 'zardy']];

describe('不変条件・決定性', () => {
  it('ランダム対戦の全ての手で不変条件が保たれる', () => {
    for (const [a, b] of DECKS) {
      for (let i = 0; i < 40; i++) {
        playGameSync(CARD_DB, [randomAgent, randomAgent], {
          decks: [deckCards(a), deckCards(b)],
          seed: `${a}${b}${i}`,
          onStep: (s) => {
            const errs = checkInvariants(s);
            if (errs.length) throw new Error(`${a} vs ${b} seed${i} turn${s.turn}: ${errs.join(' / ')}`);
          },
        });
      }
    }
  });

  it('同じシード・同じ行動列で同じ結果になる(決定性)', () => {
    const opts = { decks: [deckCards('maruru'), deckCards('zardy')] as [string[], string[]], seed: 777 };
    const r1 = playGameSync(CARD_DB, [randomAgent, randomAgent], opts);
    const r2 = playGameSync(CARD_DB, [randomAgent, randomAgent], opts);
    expect(r2.actions).toEqual(r1.actions);
    expect(JSON.stringify(r2.state)).toBe(JSON.stringify(r1.state));
  });

  it('step は入力の状態を書き換えない(純粋性)', () => {
    const opts = { decks: [deckCards('maruru'), deckCards('zardy')] as [string[], string[]], seed: 5 };
    let n = 0;
    const r = playGameSync(CARD_DB, [randomAgent, randomAgent], {
      ...opts,
      onStep: () => {
        n++;
      },
    });
    expect(r.winner).not.toBeNull();
    expect(n).toBeGreaterThan(10);
  });
});
