// デッキP「コンボで連鎖!自然単グランセクトデッキ」の新規カード(docs/decks-25oudou.md)のシナリオテスト。W・シンパシー・ガードマン・攻撃できない制限など。
import { describe, expect, it } from 'vitest';
import { Sim, mana } from '../scenario';
import { checkInvariants } from '../../src/engine/invariants';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const KAIGA = '水上第九院 シャコガイル';
const GALE = '天風のゲイル・ヴェスパー';
const ZIEG = 'ジーク・ナハトファルター';
const DEDE = 'デデカブラ';
const VAM = 'ヴァム・ウィングダム';
const JURA = '界王類咆哮目 ジュラノキル';
const DEATH = 'デスマッチ・ビートル';
const JUMBO = 'ジャンボ・ラパダイス';
const NATURAL = 'ナ・チュラルゴ・デンジャー';
const KORE = 'コレンココ・タンク';
const HERA = '環嵐! ホールインワン・ヘラクレス';
const attackActions = (sim: Sim) => sim.legal().filter((a) => a.type === 'ATTACK');

describe('P01 水上第九院 シャコガイル', () => {
  it('出た時、自分の墓地を山札に加えてシャッフルする', () => {
    const sim = new Sim({ p0: { hand: [KAIGA], mana: mana(9, W), grave: [N, N, N], deck: [N] } });
    sim.play(KAIGA);
    expect(sim.count(0, 'grave')).toBe(0);
    expect(sim.count(0, 'deck')).toBe(4);
  });
  it('相手のターンのはじめに、カードを5枚引き、手札を3枚捨てる', () => {
    const sim = new Sim({ p0: { battle: [{ c: KAIGA }], deck: [N, N, N, N, N, N, N] }, p1: { deck: [N, N] } });
    sim.endTurn();
    sim.drain();
    expect(sim.count(0, 'hand')).toBe(2);
    expect(sim.count(0, 'grave')).toBe(3);
  });
  it('自分の山札の最後の1枚を引いて負ける時、かわりに勝つ', () => {
    const sim = new Sim({ p0: { battle: [{ c: KAIGA }], deck: [N], hand: [] }, p1: { deck: [N, N] } });
    sim.endTurn(); // 相手のターンのはじめ: 5枚引く(1枚で山札切れ)、3枚捨てる
    sim.drain();
    expect(sim.s.winner).toBe(0);
  });
});

describe('P02 天風のゲイル・ヴェスパー', () => {
  it('W・シンパシー: パワー12000以上のクリーチャー1体につき、召喚コストを2少なくする(0以下にならない)', () => {
    const sim = new Sim({ p0: { hand: [GALE], battle: [{ c: DEDE }, { c: DEDE }], mana: mana(10, N) } });
    sim.play(GALE);
    expect(sim.tappedMana(0)).toBe(6);
  });
  it('自分の手札にあるクリーチャーすべてに「W・シンパシー」を与える', () => {
    const sim = new Sim({ p0: { hand: [JURA], battle: [{ c: GALE }, { c: DEDE }], mana: mana(1, N) } });
    sim.play(JURA);
    expect(sim.has(0, 'battle', JURA)).toBe(true);
  });
});

describe('P03 ジーク・ナハトファルター', () => {
  it('自分のパワー12000以上のクリーチャーが出た時、山札の上から2枚をマナゾーンに置き、クリーチャーを1体マナゾーンから手札に戻す', () => {
    const sim = new Sim({ p0: { battle: [{ c: ZIEG }], hand: [DEDE], mana: mana(1, N), deck: [KORE, N, N] } });
    sim.play(DEDE);
    sim.drain();
    expect(sim.has(0, 'hand', KORE)).toBe(true);
    expect(sim.count(0, 'mana')).toBe(2);
  });
  it('自分のターンのはじめに、このクリーチャーを自分のマナゾーンから手札に戻してもよい', () => {
    const sim = new Sim({ p0: { mana: [ZIEG, N], deck: [N, N] }, p1: { deck: [N, N] }, active: 1 });
    sim.endTurn();
    sim.use();
    sim.drain();
    expect(sim.has(0, 'hand', ZIEG)).toBe(true);
  });
});

describe('P04 デデカブラ / P05 ヴァム・ウィングダム / P06 ジュラノキル', () => {
  it('デデカブラは攻撃できない', () => {
    const sim = new Sim({ p0: { battle: [{ c: DEDE }] }, p1: { shield: 5 } });
    expect(attackActions(sim)).toEqual([]);
  });
  it('ヴァム・ウィングダム: このターン、パワー12000以上で攻撃していた自分のクリーチャーがいなければ、攻撃できない', () => {
    const sim = new Sim({ p0: { battle: [{ c: VAM }, { c: KAIGA }] }, p1: { shield: 5 } });
    expect(attackActions(sim).every((a) => a.type === 'ATTACK' && a.attacker !== sim.pid(0, VAM))).toBe(true);
    sim.attack(KAIGA, 'player');
    sim.drain();
    expect(attackActions(sim).some((a) => a.type === 'ATTACK' && a.attacker === sim.pid(0, VAM))).toBe(true);
  });
  it('スマッシュ・バースト: 攻撃する時、呪文側をバトルゾーンに置いたまま、コストを支払わずに唱えてもよい', () => {
    const sim = new Sim({ p0: { battle: [{ c: KAIGA }, { c: VAM }] }, p1: { battle: [{ c: W }], shield: 5 } });
    sim.attack(KAIGA, 'player');
    sim.drain();
    sim.attack(VAM, 'player');
    sim.yes();
    sim.drain();
    expect(sim.has(1, 'battle', W)).toBe(false);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('ジュラスティック・ハウル: 相手は、自身のマナゾーンにあるカードの枚数よりコストが大きいクリーチャーをすべて、自身のマナゾーンに置く', () => {
    const sim = new Sim({ p0: { hand: [JURA], mana: mana(3, N) }, p1: { battle: [{ c: W }, { c: KAIGA }], mana: mana(5, N) } });
    sim.play(JURA, { face: 1 });
    expect(sim.has(1, 'mana', KAIGA)).toBe(true);
    expect(sim.has(1, 'battle', W)).toBe(true);
  });
});

describe('P07 デスマッチ・ビートル', () => {
  it('ガードマン: 相手のクリーチャーが自分の他のクリーチャーを攻撃する時、このクリーチャーをタップして攻撃先を変更してもよい', () => {
    const sim = new Sim({ p0: { battle: [{ c: DEATH }, { c: W, tapped: true }] }, p1: { battle: [{ c: W }] }, active: 1 });
    sim.attack(W, W);
    sim.pick(DEATH);
    sim.drain();
    expect(sim.s.players[0].battle.find((p) => p.cards[0] === sim.uid(0, 'battle', DEATH))?.tapped).toBe(true);
    expect(sim.has(0, 'battle', W)).toBe(true);
  });
  it('ガードマンは、プレイヤーへの攻撃をブロックできない', () => {
    const sim = new Sim({ p0: { battle: [{ c: DEATH }], shield: 3 }, p1: { battle: [{ c: W }] }, active: 1 });
    sim.attack(W, 'player');
    expect(sim.s.pending?.why).not.toBe('block');
  });
  it('相手のターン中に、相手のクリーチャーがコストを支払わずに出た時、このクリーチャーとそのクリーチャーをバトルさせてもよい', () => {
    const sim = new Sim({ p0: { battle: [{ c: DEATH }] }, p1: { hand: [NATURAL, KORE], mana: mana(7, N) }, active: 1 });
    sim.play(NATURAL);
    sim.use(KORE); // コストを支払わずに出す
    sim.yes(); // デスマッチ・ビートルとバトルさせる
    sim.drain();
    expect(sim.has(1, 'battle', KORE)).toBe(false);
    expect(sim.has(0, 'battle', DEATH)).toBe(true);
  });
});

describe('P08 ジャンボ・ラパダイス', () => {
  it('山札の上から4枚を表向きにし、パワー12000以上のクリーチャーをすべて手札に加える', () => {
    const sim = new Sim({ p0: { hand: [JUMBO], mana: mana(2, N), deck: [DEDE, N, KORE, N, N] } });
    sim.play(JUMBO);
    expect(sim.count(0, 'hand')).toBe(2);
  });
});

describe('P09 ナ・チュラルゴ・デンジャー / ナチュラル・トラップ', () => {
  it('出た時、自然のコスト6以下のクリーチャーを1体、自分の手札またはマナゾーンから出してもよい', () => {
    const sim = new Sim({ p0: { hand: [NATURAL, KORE], mana: mana(7, N) } });
    sim.play(NATURAL);
    sim.use(KORE);
    sim.drain();
    expect(sim.has(0, 'battle', KORE)).toBe(true);
  });
  it('ナチュラル・トラップ: 相手のクリーチャーを1体選び、持ち主のマナゾーンに置く', () => {
    const sim = new Sim({ p0: { hand: [NATURAL], mana: mana(6, N) }, p1: { battle: [{ c: W }] } });
    sim.play(NATURAL, { face: 1 });
    sim.drain();
    expect(sim.has(1, 'mana', W)).toBe(true);
  });
});

describe('P10 コレンココ・タンク / ボント・プラントボ', () => {
  it('出た時、山札の上から3枚を表向きにして、パワー12000以上のクリーチャーを好きな数手札に加え、残りをタップしてマナゾーンに置く', () => {
    const sim = new Sim({ p0: { hand: [KORE], mana: mana(6, N), deck: [DEDE, N, DEDE, N, N] } });
    sim.play(KORE);
    sim.pick(DEDE, DEDE);
    sim.drain();
    expect(sim.count(0, 'hand')).toBe(2);
    expect(sim.count(0, 'mana')).toBe(7);
  });
  it('相手プレイヤーを攻撃できない', () => {
    const sim = new Sim({ p0: { battle: [{ c: KORE }] }, p1: { shield: 5, battle: [{ c: W, tapped: true }] } });
    expect(attackActions(sim).every((a) => a.type === 'ATTACK' && a.target.kind === 'creature')).toBe(true);
  });
  it('ボント・プラントボ: 山札の上から1枚をマナゾーンに置く。それがパワー12000以上のクリーチャーなら、もう1枚マナゾーンに置く', () => {
    const sim = new Sim({ p0: { hand: [KORE], mana: mana(3, N), deck: [DEDE, N, N] } });
    sim.play(KORE, { face: 1 });
    expect(sim.count(0, 'mana')).toBe(5);
  });
});

describe('P11 環嵐! ホールインワン・ヘラクレス', () => {
  it('自分の自然のクリーチャーまたはタマシードが合計4つ以上なければ、攻撃できない', () => {
    const sim = new Sim({ p0: { battle: [{ c: HERA }, { c: N }] }, p1: { shield: 5 } });
    expect(attackActions(sim)).toEqual([]);
  });
  it('自分のターンに一度、クリーチャーを1体、自分のマナゾーンから召喚してもよい', () => {
    const sim = new Sim({ p0: { battle: [{ c: HERA }], mana: [DEDE, N] } });
    sim.play(DEDE, { from: 'mana' });
    expect(sim.has(0, 'battle', DEDE)).toBe(true);
  });
});
