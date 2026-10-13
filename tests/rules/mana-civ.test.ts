// マナと文明の方針(spec 3.4.1 M-1〜M-6)を固定するテスト
import { describe, expect, it } from 'vitest';
import { payNeed } from '../../src/engine/derive';
import { moveCards } from '../../src/engine/ops';
import { mkCtx } from '../../src/engine/state';
import { Sim, mana, reg } from '../scenario';

const DEDADAM = '天災 デドダム'; // 水・闇・自然 / コスト3
const WATER = 'アクアン'; // 水
const DARK = 'ティンパニ=シンバリー'; // 闇
const NATURE = 'フェアリー・ライフ'; // 自然

describe('多色カードのタップイン(M-1)', () => {
  it('マナチャージ: 多色はタップ状態、単色はアンタップ状態で置かれる', () => {
    const multi = new Sim({ step: 'mana', p0: { hand: [DEDADAM] } });
    multi.charge(DEDADAM);
    expect(multi.tappedMana(0)).toBe(1);
    const mono = new Sim({ step: 'mana', p0: { hand: [NATURE] } });
    mono.charge(NATURE);
    expect(mono.tappedMana(0)).toBe(0);
  });
  it('ブースト(山札の上からマナへ): 多色はタップ状態、単色はアンタップ状態', () => {
    const sim = new Sim({ p0: { hand: [NATURE], mana: mana(2), deck: [DEDADAM, WATER] } });
    sim.play(NATURE);
    expect(sim.count(0, 'mana')).toBe(3);
    expect(sim.tappedMana(0)).toBe(2 /* 支払い */ + 1 /* 多色のタップイン */);
    const uid = sim.uid(0, 'mana', DEDADAM);
    expect(sim.s.cards[uid].tapped).toBe(true);
  });
  it('進化元の山ごとマナゾーンへ置く時、下の多色カードもタップ状態で置かれる', () => {
    const sim = new Sim({
      p0: { battle: [{ c: 'SSS級天災 デッドダムド', under: [DEDADAM] }] },
    });
    const top = sim.uid(0, 'battle', 'SSS級天災 デッドダムド');
    const c = mkCtx(sim.s, reg);
    moveCards(c, [top], { to: 'mana', cause: 'test' });
    const manaCards = sim.s.players[0].mana;
    expect(manaCards.length).toBe(2);
    for (const u of manaCards) expect(sim.s.cards[u].tapped).toBe(true);
  });
});

describe('文明の支払い(M-2〜M-5)', () => {
  it('M-5: 「水闇自然・水・水」ではデドダムを召喚できない', () => {
    const sim = new Sim({ p0: { hand: [DEDADAM], mana: [DEDADAM, WATER, WATER] } });
    expect(sim.canPlay(DEDADAM)).toBe(false);
  });
  it('M-5: 「水闇自然・水・闇」「水・闇・自然」なら召喚できる', () => {
    const a = new Sim({ p0: { hand: [DEDADAM], mana: [DEDADAM, WATER, DARK] } });
    expect(a.canPlay(DEDADAM)).toBe(true);
    const b = new Sim({ p0: { hand: [DEDADAM], mana: [WATER, DARK, NATURE] } });
    expect(b.canPlay(DEDADAM)).toBe(true);
  });
  it('M-4: 3文明のカードは、マナが2枚(多色)では足りない。必ず3枚タップする', () => {
    const two = new Sim({ p0: { hand: [DEDADAM], mana: [DEDADAM, DEDADAM] } });
    expect(two.canPlay(DEDADAM)).toBe(false);
    const three = new Sim({ p0: { hand: [DEDADAM], mana: [DEDADAM, DEDADAM, DEDADAM, WATER] } });
    three.play(DEDADAM);
    // 4枚あっても、タップするのはコスト分の3枚だけ(出た時の効果の解決前に数える)
    expect(three.tappedMana(0)).toBe(3);
  });
  it('M-2: 多色のマナ1枚が、同じ支払いで2つの文明を満たすことはない(手動払いも拒否する)', () => {
    const sim = new Sim({ p0: { hand: [DEDADAM], mana: [DEDADAM, WATER, WATER] } });
    const pay = sim.s.players[0].mana.slice();
    expect(() => sim.play(DEDADAM, { extra: { pay } })).toThrow();
  });
  it('M-6: 手動払いでも、文明を満たす別々のマナなら受け付ける', () => {
    const sim = new Sim({ p0: { hand: [DEDADAM], mana: [DEDADAM, WATER, DARK] } });
    const pay = sim.s.players[0].mana.slice();
    sim.play(DEDADAM, { extra: { pay } });
    expect(sim.has(0, 'battle', DEDADAM)).toBe(true);
  });
});

describe('タップする枚数(M-3・M-4)', () => {
  it('コストが文明の数より小さくなっても、文明の数だけタップする', () => {
    expect(payNeed(1, 2)).toBe(2);
    expect(payNeed(2, 3)).toBe(3);
  });
  it('コストが文明の数以上なら、コストの枚数をタップする', () => {
    expect(payNeed(7, 2)).toBe(7);
    expect(payNeed(3, 3)).toBe(3);
  });
  it('単色のカードは、コストが0に下がっても1枚は払う', () => {
    expect(payNeed(0, 1)).toBe(1);
    expect(payNeed(-2, 1)).toBe(1);
  });
});
