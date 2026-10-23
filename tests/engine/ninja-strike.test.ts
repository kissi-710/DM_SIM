// ニンジャ・ストライク(シノビのキーワード能力)と、それに反応する能力(斬隠蒼頭龍バイケン)。
// 相手のクリーチャーが攻撃またはブロックした時、マナゾーンに n 枚以上あれば、手札のシノビをコストを支払わずに召喚してもよい。そのターンの終わりに、山札の下に置く。
import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../../src/cards';
import { loadRegistry } from '../../src/engine/registry';
import type { CardDB } from '../../src/engine/types';
import { BATTLE_TEST_CARDS } from '../fixtures/battle-cards';
import { Sim, mana } from '../scenario';

const DB: CardDB = { ...CARD_DB, ...Object.fromEntries(BATTLE_TEST_CARDS.map((c) => [c.id, c])) };
const R = loadRegistry(DB);
const W = 'アクアン';
const N = 'フェアリー・ライフ';

describe('ニンジャ・ストライク', () => {
  it('相手の攻撃の時、マナが n 枚以上あれば、手札のシノビをコストを支払わずに召喚できる。そのターンの終わりに山札の下に置かれる', () => {
    const sim = new Sim({ p0: { hand: ['Tシノビ'], mana: mana(3, N), deck: [N, N, N] }, p1: { battle: [{ c: W }] }, active: 1 }, R);
    sim.attack(W, 'player');
    sim.yes();
    sim.drain();
    expect(sim.has(0, 'battle', 'Tシノビ')).toBe(true);
    expect(sim.tappedMana(0)).toBe(0); // コストを支払わない
    sim.endTurn();
    sim.drain();
    expect(sim.has(0, 'battle', 'Tシノビ')).toBe(false);
    expect(sim.names(0, 'deck').at(-1)).toBe('Tシノビ'); // 山札の一番下
  });
  it('マナが n 枚に足りなければ、使えない', () => {
    const sim = new Sim({ p0: { hand: ['Tシノビ'], mana: mana(2, N), deck: [N, N, N] }, p1: { battle: [{ c: W }] }, active: 1 }, R);
    sim.attack(W, 'player');
    expect(sim.s.pending?.why).not.toBe('may');
    expect(sim.has(0, 'battle', 'Tシノビ')).toBe(false);
  });
  it('斬隠蒼頭龍バイケン: 自分のシノビのニンジャ・ストライクを使った時、カードを1枚引いてもよい', () => {
    const sim = new Sim({ p0: { hand: ['Tシノビ'], battle: [{ c: '斬隠蒼頭龍バイケン' }], mana: mana(3, N), deck: [N, N, N] }, p1: { battle: [{ c: W }] }, active: 1 }, R);
    sim.attack(W, 'player');
    sim.yes();
    sim.drain(1);
    if (sim.s.pending?.why === 'may') sim.yes();
    sim.drain();
    expect(sim.has(0, 'battle', 'Tシノビ')).toBe(true);
    expect(sim.count(0, 'hand')).toBe(1); // バイケンの能力で1枚引いた
  });
});
