// デッキY「進化王!闇自然ケンジ・キングダムデッキ」の新規カード(docs/decks-25oudou.md)のシナリオテスト。究極進化・スター進化・墓地から召喚する進化クリーチャーなど。
import { describe, expect, it } from 'vitest';
import { Sim, mana } from '../scenario';
import { checkInvariants } from '../../src/engine/invariants';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const D = 'フットレス=トレース';
const NINGYO = '星空に浮かぶニンギョ';
const GUNTER = '超神羅ギュンター・ペガサス';
const ZUNDOKO = '晴舞龍 ズンドコ・モモキング';
const TSUKU = 'ツクっちょ <メイ様.Star>';
const HERCOP = 'ヘルコプ太の心絵';
const BLUEPRINT = '進化設計図';
const KENJI = '神羅ケンジ・キングダム';
const REX = 'タイムピョンチキ'; // レクスターズ(自然)
const LION = '「正義星帝」 <ライオネル.Star>';

describe('Y01 星空に浮かぶニンギョ', () => {
  it('ニンギョ: 相手が山札の上をマナゾーンに置く呪文を唱えると、かわりに墓地に置かれる', () => {
    const sim = new Sim({ p0: { battle: [{ c: NINGYO }] }, p1: { hand: ['ネオ・ボルシャック・ドラゴン'], mana: mana(2, N), deck: [N, N, N] }, active: 1 });
    sim.play('ネオ・ボルシャック・ドラゴン', { face: 1 });
    expect(sim.count(1, 'mana')).toBe(2);
    expect(sim.count(1, 'grave')).toBeGreaterThanOrEqual(2);
  });
});

describe('Y02 超神羅ギュンター・ペガサス', () => {
  it('究極進化MAX: 究極進化クリーチャー1体の上に置く。自分のマナゾーンから召喚してもよい', () => {
    const sim = new Sim({ p0: { battle: [{ c: KENJI, under: [LION] }], mana: [GUNTER, ...mana(5, N)] } });
    const onto = sim.pid(0, KENJI);
    sim.play(GUNTER, { from: 'mana', extra: { onto } });
    sim.drain();
    expect(sim.has(0, 'battle', GUNTER)).toBe(true);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('攻撃する時、山札の上から3枚までマナゾーンに置く。その後、クリーチャーを好きな数、自分のマナゾーンから出す(出ることによって起こる効果は無視する)', () => {
    const sim = new Sim({ p0: { battle: [{ c: GUNTER, under: [KENJI] }], deck: [N, N, N, N] }, p1: { shield: 5 } });
    sim.attack(GUNTER, 'player');
    sim.option(0);
    sim.drain();
    expect(sim.count(0, 'mana')).toBe(3);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
});

describe('Y03 ズンドコ・モモキング / Y04 ツクっちょ', () => {
  it('ズンドコ・モモキング: スター進化。出た時、山札の上から1枚目をマナゾーンに置く。離れた時、カードを1枚マナゾーンから手札に戻す', () => {
    const sim = new Sim({ p0: { hand: [ZUNDOKO], battle: [{ c: REX }], mana: mana(2, N), deck: [N, N, N] } });
    sim.play(ZUNDOKO, { extra: { onto: sim.pid(0, REX) } });
    expect(sim.count(0, 'mana')).toBe(3);
    expect(sim.has(0, 'battle', ZUNDOKO)).toBe(true);
  });
  it('ツクっちょ: スター進化の山が離れる時、かわりに一番上のカードだけが離れる(進化元は残る)', () => {
    const sim = new Sim({
      p0: { battle: [{ c: TSUKU, under: [REX] }] },
      p1: { hand: ['青銅のバンビシカット'], mana: mana(9, 'ドンドン火噴くナウ'), deck: [N, N] },
      active: 1,
    });
    sim.play('青銅のバンビシカット', { face: 1 });
    sim.drain();
    expect(sim.has(0, 'grave', TSUKU)).toBe(true);
    expect(sim.has(0, 'battle', REX)).toBe(true);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('ライオネル.Star(スター進化): 離れる時、一番上のカードだけが離れる', () => {
    const sim = new Sim({
      p0: { battle: [{ c: LION, under: [REX] }] },
      p1: { hand: ['青銅のバンビシカット'], mana: mana(9, 'ドンドン火噴くナウ'), deck: [N, N] },
      active: 1,
    });
    sim.play('青銅のバンビシカット', { face: 1 });
    sim.drain();
    expect(sim.has(0, 'battle', REX)).toBe(true);
  });
});

describe('Y05 ヘルコプ太の心絵 / Y06 進化設計図 / Y07 神羅ケンジ・キングダム', () => {
  it('ヘルコプ太の心絵: 出た時、山札の上から4枚を見て、進化クリーチャーを1体相手に見せ、手札に加えてもよい', () => {
    const sim = new Sim({ p0: { hand: [HERCOP], mana: mana(1, N), deck: [N, KENJI, N, N, N] } });
    sim.play(HERCOP);
    sim.pick(KENJI);
    sim.drain();
    expect(sim.has(0, 'hand', KENJI)).toBe(true);
  });
  it('進化設計図: 山札の上から6枚を表向きにして、進化クリーチャーをすべて手札に加える', () => {
    const sim = new Sim({ p0: { hand: [BLUEPRINT], mana: mana(2, N), deck: [KENJI, N, GUNTER, N, N, N, N] } });
    sim.play(BLUEPRINT);
    sim.answer((sim.pending.input as { candidates: number[] }).candidates);
    sim.drain();
    expect(sim.count(0, 'hand')).toBe(2);
  });
  it('神羅ケンジ・キングダム: 自分の墓地から召喚してもよい(進化クリーチャー1体の上に置く)。出た時、山札の上から3枚を墓地に置き、その中からクリーチャーを1体出す', () => {
    const sim = new Sim({ p0: { battle: [{ c: LION, under: [REX] }], grave: [KENJI], mana: [...mana(2, D), ...mana(2, N)], deck: [N, W, N, N] } });
    sim.play(KENJI, { from: 'grave', extra: { onto: sim.pid(0, LION) } });
    sim.pick(W);
    sim.drain();
    expect(sim.has(0, 'battle', KENJI)).toBe(true);
    expect(sim.has(0, 'battle', W)).toBe(true);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
});
