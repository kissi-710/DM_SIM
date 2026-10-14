// 情報条件の作成と、決め打ち(仮説)のカード名の解決・検査
import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../../src/cards';
import { checkHypotheses, DEFAULT_HYPOTHESIS_WEIGHT, hypothesisProblems, makePolicy, resolveCardId } from '../../src/ai/policy';

describe('makePolicy', () => {
  it('公平・全開示は、開示も仮説も持たない', () => {
    for (const p of ['fair', 'full'] as const) {
      const x = makePolicy(p);
      expect(x.preset).toBe(p);
      expect(x.reveal).toBeUndefined();
      expect(x.hypotheses).toBeUndefined();
      expect(x.knowOpponentDecklist).toBe(true);
    }
  });
  it('部分開示は、手札の中身2枚と種類を開示する', () => {
    const x = makePolicy('partial');
    expect(x.reveal?.opponentHandCount).toBe(2);
    expect(x.reveal?.opponentHandKinds).toEqual(['shieldTrigger', 'blocker']);
  });
  it('決め打ちは、渡した仮説と既定の確率を持つ', () => {
    const x = makePolicy('hypothesis', { hypotheses: ['dmrp17-029'] });
    expect(x.hypotheses).toEqual([{ defId: 'dmrp17-029' }]);
    expect(x.hypothesisWeight).toBe(DEFAULT_HYPOTHESIS_WEIGHT);
    expect(makePolicy('hypothesis', { hypotheses: ['dmrp17-029'], weight: 0.9 }).hypothesisWeight).toBe(0.9);
  });
  it('相手のデッキリストを知らない設定にできる', () => {
    expect(makePolicy('fair', { knowOpponentDecklist: false }).knowOpponentDecklist).toBe(false);
  });
});

describe('resolveCardId', () => {
  it('ID・名前・面の名前・名前の一部で引ける', () => {
    expect(resolveCardId(CARD_DB, 'dm23bd1-014')).toBe('dm23bd1-014');
    expect(resolveCardId(CARD_DB, '天災 デドダム')).toBe('dm23bd1-014');
    expect(resolveCardId(CARD_DB, 'デドダム')).toBe('dm23bd1-014');
    expect(resolveCardId(CARD_DB, 'オリジナル・ライフ')).toBeDefined();
  });
  it('見つからなければ undefined(空文字・ダミーも)', () => {
    expect(resolveCardId(CARD_DB, 'そんなカードはない')).toBeUndefined();
    expect(resolveCardId(CARD_DB, '')).toBeUndefined();
    expect(resolveCardId(CARD_DB, 'dummy')).toBe('dummy'); // ID の完全一致は引ける(名前の一部では引かない)
  });
});

describe('checkHypotheses / hypothesisProblems', () => {
  const zardy = deckCards('zardy');
  it('相手のデッキにあるカードは、問題なし', () => {
    const c = checkHypotheses(CARD_DB, ['ブレイン・スラッシュ', 'ドンドン火噴くナウ'], zardy);
    expect(c.unknown).toEqual([]);
    expect(c.notInDeck).toEqual([]);
    expect(c.ids).toHaveLength(2);
    expect(hypothesisProblems(c)).toEqual([]);
  });
  it('未知の名前・デッキにないカード・空を、それぞれ報告する', () => {
    const maruru = deckCards('maruru');
    const a = checkHypotheses(CARD_DB, ['ブレイン・スラッシュ', 'そんなカードはない'], maruru);
    expect(a.unknown).toEqual(['そんなカードはない']);
    expect(a.notInDeck).toEqual(['ブレイン・スラッシュ']);
    expect(hypothesisProblems(a)).toHaveLength(2);
    const empty = checkHypotheses(CARD_DB, [' ', ''], maruru);
    expect(hypothesisProblems(empty)[0]).toContain('1枚以上');
  });
  it('同じカードを2回書いても、IDは1つ', () => {
    expect(checkHypotheses(CARD_DB, ['デドダム', '天災 デドダム']).ids).toHaveLength(1);
  });
});
