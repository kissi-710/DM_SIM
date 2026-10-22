// デッキX「墓地を増やせ!火闇自然墓地ソースデッキ」の新規カード(docs/decks-25oudou.md)のシナリオテスト。超無限墓地進化・フシギバース・墓地の枚数でコストを減らすなど。
import { describe, expect, it } from 'vitest';
import { Sim, mana } from '../scenario';
import { checkInvariants } from '../../src/engine/invariants';
import { powerOf } from '../../src/engine/derive';
import { mkCtx } from '../../src/engine/state';
import { reg } from '../scenario';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const F = 'ドンドン火噴くナウ';
const D = 'フットレス=トレース'; // 闇(コスト4)
const DOOM = '超神星DOOM・ドラゲリオン';
const URAGIRI = '大魔王 ウラギリダムス';
const OBZA = '龍装鬼 オブザ08号';
const DOORKNOCKER = 'ドアノッカ=ノアドッカ';
const GT = '暴走龍 5000GT';
const FLAMEBURN = 'ヨビニオン・フレイムバーン';
const GIGANDI = '大樹王 ギガンディダノス';
const BRACHIO = 'ブラキオ龍樹';
const DOMAMMO = 'ドマンモ龍樹';
const NEO = 'ネオ・ボルシャック・ドラゴン';
const ABAKU = '鬼札アバクと鬼札王国';
const power = (sim: Sim, p: 0 | 1, name: string) => powerOf(mkCtx(sim.s, reg), sim.s.players[p].battle.find((x) => x.pid === sim.pid(p, name))!);
const attackActions = (sim: Sim) => sim.legal().filter((a) => a.type === 'ATTACK');

describe('X01 超神星DOOM・ドラゲリオン', () => {
  it('超無限墓地進化: 墓地のクリーチャーを1体以上選び、その上に重ねつつ出す。選んだ数だけコストを少なくする', () => {
    const sim = new Sim({ p0: { hand: [DOOM], grave: [W, W, W], mana: [...mana(5, D), ...mana(4, F)] } });
    const acts = sim.legal().filter((a) => a.type === 'PLAY_CARD' && a.extra?.alt === 'graveEvo');
    expect(acts.length).toBeGreaterThan(0);
    const three = acts.find((a) => a.type === 'PLAY_CARD' && a.extra?.under?.length === 3)!;
    sim.do(three);
    sim.drain();
    expect(sim.has(0, 'battle', DOOM)).toBe(true);
    expect(sim.tappedMana(0)).toBe(9); // 12 - 3
    expect(sim.s.players[0].battle[0].cards.length).toBe(4);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('メテオバーン: 攻撃する時、下にあるカードを1枚墓地に置いてもよい。そうしたら、相手のクリーチャーのパワーを-9000する。その後、進化ではないクリーチャーを墓地から出す', () => {
    const sim = new Sim({ p0: { battle: [{ c: DOOM, under: [W, W] }], grave: ['AQvibrato'] }, p1: { battle: [{ c: '終末の監視者 ジ・ウォッチ' }], shield: 5 } });
    sim.attack(DOOM, 'player');
    sim.yes();
    sim.pick('AQvibrato');
    sim.drain();
    expect(sim.s.players[0].battle.find((p) => p.cards.length === 2)).toBeDefined();
    expect(sim.has(0, 'battle', 'AQvibrato')).toBe(true);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
});

describe('X02 大魔王 ウラギリダムス / X03 オブザ08号 / X05 暴走龍 5000GT', () => {
  it('シンパシー: 自分の墓地にあるクリーチャー1体につき、召喚コストを1少なくする(0以下にならない)', () => {
    const sim = new Sim({ p0: { hand: [URAGIRI], grave: [W, W, W, W, W, W], mana: mana(7, D) } });
    sim.play(URAGIRI);
    expect(sim.tappedMana(0)).toBe(7);
  });
  it('ウラギリダムス: 出た時、クリーチャーを5体自分の墓地から選び、このクリーチャーの下に重ねてもよい。そうしたら、相手のクリーチャーを1体破壊する', () => {
    const sim = new Sim({ p0: { hand: [URAGIRI], grave: [W, W, W, W, W], mana: mana(8, D) }, p1: { battle: [{ c: '終末の監視者 ジ・ウォッチ' }] } });
    sim.play(URAGIRI);
    sim.yes();
    sim.drain();
    expect(sim.s.players[0].battle[0].cards.length).toBe(6);
    expect(sim.has(1, 'battle', '終末の監視者 ジ・ウォッチ')).toBe(false);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('オブザ08号: 出た時、相手のクリーチャーを1体選ぶ。このターン、自分の墓地にあるクリーチャー1体につき-1000する', () => {
    const sim = new Sim({ p0: { hand: [OBZA], grave: [W, W], mana: mana(7, D) }, p1: { battle: [{ c: W }] } });
    sim.play(OBZA);
    sim.drain();
    expect(sim.has(1, 'battle', W)).toBe(false); // 2000 - 2000
  });
  it('暴走龍 5000GT: 出た時、パワー5000以下のクリーチャーをすべて破壊する。すべてのプレイヤーは、パワー5000以下のクリーチャーを召喚できない', () => {
    const sim = new Sim({ p0: { hand: [GT, W], battle: [{ c: 'AQvibrato' }], mana: mana(12, F) }, p1: { battle: [{ c: W }] } });
    sim.play(GT);
    sim.drain();
    expect(sim.has(1, 'battle', W)).toBe(false);
    expect(sim.has(0, 'battle', 'AQvibrato')).toBe(false);
    expect(sim.canPlay(W)).toBe(false);
  });
});

describe('X04 ドアノッカ / X06 ヨビニオン・フレイムバーン / X10 ネオ・ボルシャック / X11 アバク', () => {
  it('ドアノッカ=ノアドッカ: 出た時、相手のクリーチャーを1体選び、このターン、パワーを-4000する(を2回)', () => {
    const sim = new Sim({ p0: { hand: [DOORKNOCKER], mana: mana(7, D) }, p1: { battle: [{ c: W }, { c: 'AQvibrato' }] } });
    sim.play(DOORKNOCKER);
    sim.drain();
    expect(sim.count(1, 'battle')).toBe(0);
  });
  it('ヨビニオン・フレイムバーン: 出た時、手札を1枚捨ててもよい。そうしたら、カードを2枚引く', () => {
    const sim = new Sim({ p0: { hand: [FLAMEBURN, N], mana: mana(4, F), deck: [N, N, N, N] } });
    sim.play(FLAMEBURN);
    sim.order('出た時');
    sim.use();
    sim.drain();
    expect(sim.count(0, 'hand')).toBe(2);
  });
  it('ネオ・ボルシャック・ドラゴン: パワーアタッカー+4000。ボルシャックゾーン: 山札の上から1枚をマナゾーンに置く', () => {
    const sim = new Sim({ p0: { hand: [NEO], mana: mana(2, N), deck: [N, N] } });
    sim.play(NEO, { face: 1 });
    expect(sim.count(0, 'mana')).toBe(3);
  });
  it('鬼札アバク: 出た時、山札の上から5枚を墓地に置く。その後、このクリーチャーを破壊する。鬼タイム: シールドの数が合計6つ以下なら無視する', () => {
    const sim = new Sim({ p0: { hand: [ABAKU], mana: [...mana(1, F), ...mana(1, D), ...mana(1, N)], deck: Array(10).fill(N), shield: 5 }, p1: { shield: 5 } });
    sim.play(ABAKU);
    sim.drain();
    expect(sim.has(0, 'grave', ABAKU)).toBe(true);
    expect(sim.count(0, 'grave')).toBe(6);
    const sim2 = new Sim({ p0: { hand: [ABAKU], mana: [...mana(1, F), ...mana(1, D), ...mana(1, N)], deck: Array(10).fill(N), shield: 3 }, p1: { shield: 3 } });
    sim2.play(ABAKU);
    sim2.drain();
    expect(sim2.has(0, 'battle', ABAKU)).toBe(true);
  });
  it('鬼札アバクと鬼札王国: 自分の墓地から召喚してもよい', () => {
    const sim = new Sim({ p0: { grave: [ABAKU], mana: [...mana(1, F), ...mana(1, D), ...mana(1, N)], deck: Array(10).fill(N), shield: 3 }, p1: { shield: 3 } });
    sim.play(ABAKU, { from: 'grave' });
    sim.drain();
    expect(sim.has(0, 'battle', ABAKU)).toBe(true);
  });
});

describe('X07 ギガンディダノス / X08 ブラキオ龍樹 / X09 ドマンモ龍樹', () => {
  it('ギガンディダノス: 出た時、相手は自身の手札をすべてマナゾーンに置く', () => {
    const sim = new Sim({ p0: { hand: [GIGANDI], mana: [...mana(6, D), ...mana(6, N)] }, p1: { hand: [W, W] } });
    sim.play(GIGANDI);
    expect(sim.count(1, 'hand')).toBe(0);
    expect(sim.count(1, 'mana')).toBeGreaterThanOrEqual(2);
  });
  it('ギガンディダノス: 自分は、このクリーチャーよりパワーが小さいクリーチャーに攻撃されない', () => {
    const sim = new Sim({ p0: { battle: [{ c: GIGANDI }], shield: 5 }, p1: { battle: [{ c: W }] }, active: 1 });
    expect(attackActions(sim).every((a) => a.type === 'ATTACK' && a.target.kind !== 'player')).toBe(true);
  });
  it('フシギバース: 自分のクリーチャーを1体タップしてマナゾーンに置き、基準のコストからそのコストを引いた数を支払って、墓地から召喚してもよい', () => {
    const sim = new Sim({ p0: { grave: [DOMAMMO], battle: [{ c: W }], mana: [...mana(6, D), ...mana(6, N)] } });
    const act = sim.legal().find((a) => a.type === 'PLAY_CARD' && a.from === 'grave' && a.extra?.alt === 'fushigi');
    expect(act).toBeDefined();
    sim.do(act!);
    sim.drain();
    expect(sim.has(0, 'battle', DOMAMMO)).toBe(true);
    expect(sim.has(0, 'mana', W)).toBe(true);
    expect(sim.tappedMana(0)).toBe(7); // 10 - 4(アクアンのコスト) = 6 を支払い、タップして置いたアクアンが1枚
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('ブラキオ龍樹: 相手のクリーチャーが出て、相手のクリーチャーの能力がトリガーする時、かわりにその能力はトリガーしない', () => {
    const sim = new Sim({ p0: { battle: [{ c: BRACHIO }] }, p1: { hand: ['AQvibrato'], mana: mana(2, W), deck: [N, N, N] }, active: 1 });
    sim.play('AQvibrato');
    sim.drain();
    expect(sim.count(1, 'hand')).toBe(0); // 「出た時、カードを1枚引く」はトリガーしない
  });
  it('ドマンモ龍樹: 自分の他のクリーチャーがバトルゾーンに出た時、相手は自身の手札を1枚選び、捨てる', () => {
    const sim = new Sim({ p0: { hand: [W], battle: [{ c: DOMAMMO }], mana: mana(4, W) }, p1: { hand: [N, N] } });
    sim.play(W);
    sim.drain();
    expect(sim.count(1, 'grave')).toBe(1);
  });
});

void power;
