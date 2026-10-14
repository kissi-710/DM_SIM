// 初期条件の検査(ISSUE-14): arrangeDeck は効かない名前を無視するので、入力画面・CLI が事前に知らせる。
import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../../src/cards';
import { loadRegistry } from '../../src/engine/registry';
import { initialProblems } from '../../src/sim/solitaire';

const reg = loadRegistry(CARD_DB);
const maruru = deckCards('maruru');

describe('initialProblems', () => {
  it('条件なし・正しい名前なら、問題なし', () => {
    expect(initialProblems(reg, maruru)).toEqual([]);
    expect(initialProblems(reg, maruru, {})).toEqual([]);
    expect(initialProblems(reg, maruru, { mustHand: ['天災 デドダム'], mustNotHand: ['ジ・ウォッチ'], topFixed: ['九番龍 ジゴクバンカー'] })).toEqual([]);
  });
  it('カードIDや名前の一部でも解決できる', () => {
    expect(initialProblems(reg, maruru, { mustHand: ['dm23bd1-014', 'デドダム'] })).toEqual([]);
  });
  it('一致するカードがない名前を、どの条件の何かとあわせて返す', () => {
    const p = initialProblems(reg, maruru, { mustHand: ['そんなカードはない'], topFixed: ['あれもない'] });
    expect(p).toHaveLength(2);
    expect(p[0]).toContain('初手に含める');
    expect(p[0]).toContain('そんなカードはない');
    expect(p[1]).toContain('山札の上に固定');
  });
  it('カードは存在するが、このデッキに入っていないものも返す', () => {
    const p = initialProblems(reg, maruru, { mustNotHand: ['ドンドン火噴くナウ'] });
    expect(p).toEqual(['初手に含めない: 「ドンドン火噴くナウ」はこのデッキに入っていません']);
  });
});
