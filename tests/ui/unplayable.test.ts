// 使えないカードの理由の文言
import { describe, expect, it } from 'vitest';
import { deckCards } from '../../src/cards';
import { createGame } from '../../src/engine/engine';
import { whyUnplayable } from '../../src/ui/unplayable';
import { reg } from '../scenario';

const game = () => createGame(reg, { decks: [deckCards('maruru'), deckCards('zardy')], seed: 4, first: 0 }).state;

describe('whyUnplayable', () => {
  it('マナステップでは、ステップの説明を返す', () => {
    const s = game();
    expect(s.step).toBe('mana');
    expect(whyUnplayable(s, 0, s.players[0].hand[0])).toMatch(/マナチャージ/);
  });
  it('メインステップでマナが無い時は、足りない枚数を添える', () => {
    const s = { ...game(), step: 'main' as const };
    const u = s.players[0].hand.find((x) => reg.defs[s.cards[x].defId].faces[0].type !== 'evolution' && reg.defs[s.cards[x].defId].faces[0].cost > 0)!;
    expect(whyUnplayable(s, 0, u)).toMatch(/マナが足りません\(コスト \d+ \/ 使えるマナ 0\)/);
  });
});
