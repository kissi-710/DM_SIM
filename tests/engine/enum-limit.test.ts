// 回答の列挙が上限で打ち切られた時に、黙らず数える(診断)。実際のデッキでは打ち切りが起きないことも固定する。
import { describe, expect, it } from 'vitest';
import { deckCards } from '../../src/cards';
import { createGame, legalActions, step } from '../../src/engine/engine';
import { ENUM_LIMIT, enumerateAnswers, enumTruncations, resetEnumTruncations } from '../../src/engine/legal';
import type { Pending } from '../../src/engine/types';
import { mulberry } from '../../src/sim/playGame';
import { reg } from '../scenario';

const pend = (input: any): Pending => ({ id: 1, player: 0, why: 'select', input, source: { uid: 0, ep: 0 }, prompt: '' }) as any;

describe('enumerateAnswers の打ち切りの診断', () => {
  it('上限以下なら、打ち切りに数えない', () => {
    resetEnumTruncations();
    const r = enumerateAnswers(pend({ shape: 'pick', candidates: [1, 2, 3, 4], min: 1, max: 2 }));
    expect(r.length).toBe(10);
    expect(enumTruncations()).toBe(0);
  });
  it('ちょうど上限の件数でも、打ち切りに数えない', () => {
    resetEnumTruncations();
    // 候補 8 から 4 個を選ぶ組合せは 70 件。上限を 70 にする
    const r = enumerateAnswers(pend({ shape: 'pick', candidates: [1, 2, 3, 4, 5, 6, 7, 8], min: 4, max: 4 }), 70);
    expect(r).toHaveLength(70);
    expect(enumTruncations()).toBe(0);
  });
  it('上限を超えたら、先頭の上限件数だけを返して、打ち切りを数える', () => {
    resetEnumTruncations();
    const c = Array.from({ length: 20 }, (_, i) => i);
    const r = enumerateAnswers(pend({ shape: 'pick', candidates: c, min: 1, max: 5 }));
    expect(r).toHaveLength(ENUM_LIMIT);
    expect(enumTruncations()).toBe(1);
  });
});

describe('実際のデッキでは、回答の列挙が打ち切られない', () => {
  it('両デッキの組合せ・先攻後攻のランダム対戦 40 試合', () => {
    resetEnumTruncations();
    const pairs: [string, string][] = [['maruru', 'zardy'], ['zardy', 'maruru'], ['maruru', 'maruru'], ['zardy', 'zardy']];
    for (let g = 0; g < 40; g++) {
      const [da, db] = pairs[g % 4];
      let s = createGame(reg, { decks: [deckCards(da), deckCards(db)], seed: 900 + g, first: (g % 2) as 0 | 1 }).state;
      const rand = mulberry(g + 3);
      for (let i = 0; i < 1500 && s.winner === null; i++) {
        const legal = legalActions(s, reg);
        if (legal.length === 0) break;
        s = step(s, legal[Math.floor(rand() * legal.length)], reg).state;
      }
    }
    expect(enumTruncations()).toBe(0);
  });
});
