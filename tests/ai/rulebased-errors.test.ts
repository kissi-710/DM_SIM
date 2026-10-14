// ルールベースAIは、先読みで例外になった手を黙って捨てず、onError で知らせる。
import { describe, expect, it } from 'vitest';
import { deckCards } from '../../src/cards';
import { makeRuleBased } from '../../src/ai/rulebased';
import { createGame, legalActions, step } from '../../src/engine/engine';
import type { Action, GameState } from '../../src/engine/types';
import { playGameSync, mulberry } from '../../src/sim/playGame';
import { reg } from '../scenario';

/** 効果の選択(ANSWER)で、合法手が2つ以上ある局面を探す */
function findAnswerState(): { s: GameState; legal: Action[] } {
  for (let seed = 1; seed < 60; seed++) {
    let s = createGame(reg, { decks: [deckCards('maruru'), deckCards('zardy')], seed, first: 0 }).state;
    const rand = mulberry(seed);
    for (let i = 0; i < 300 && s.winner === null; i++) {
      const legal = legalActions(s, reg);
      if (s.pending && s.pending.why !== 'turnAction' && legal.length >= 2) return { s, legal };
      s = step(s, legal[Math.floor(rand() * legal.length)], reg).state;
    }
  }
  throw new Error('効果の選択の局面が見つかりません');
}

describe('ルールベースAI: 先読みで例外になった手', () => {
  it('例外になった手を onError に渡し、その手は選ばない', () => {
    const { s, legal } = findAnswerState();
    const bogus = { type: 'ANSWER', id: -999, value: (legal[0] as any).value } as Action;
    const seen: Action[] = [];
    const ag = makeRuleBased({ onError: (_e, a) => seen.push(a) });
    const a = ag.chooseAction(s, [...legal, bogus], { rand: mulberry(1), reg }) as Action;
    expect(seen).toEqual([bogus]);
    expect(a).not.toEqual(bogus);
    expect(legal).toContainEqual(a);
  });
  it('onError がなくても、例外にならない(従来どおり、その手を飛ばす)', () => {
    const { s, legal } = findAnswerState();
    const bogus = { type: 'ANSWER', id: -999, value: (legal[0] as any).value } as Action;
    const a = makeRuleBased().chooseAction(s, [...legal, bogus], { rand: mulberry(1), reg }) as Action;
    expect(legal).toContainEqual(a);
  });
  it('通常の対戦(ルールベース同士・両デッキ)では、一度も例外にならない', () => {
    let errors = 0;
    const onError = () => void errors++;
    for (let seed = 1; seed <= 8; seed++) {
      const [da, db] = seed % 2 ? ['maruru', 'zardy'] : ['zardy', 'maruru'];
      const r = playGameSync(reg, [makeRuleBased({ onError }), makeRuleBased({ onError })], { decks: [deckCards(da), deckCards(db)], seed, first: 0 });
      expect(r.winner).not.toBeNull();
    }
    expect(errors).toBe(0);
  });
});
