// デッキM「ウィンの革命チェンジ闇自然アビスデッキ」の新規カード(docs/decks-25oudou.md)のシナリオテスト。アビスラッシュ・メクレイド・S・バックなど。
import { describe, expect, it } from 'vitest';
import { Sim, mana } from '../scenario';
import { checkInvariants } from '../../src/engine/invariants';
import { powerOf } from '../../src/engine/derive';
import { mkCtx } from '../../src/engine/state';
import { reg } from '../scenario';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const D = 'フットレス=トレース'; // 闇
const JAGA = '邪幽 ジャガイスト';
const SHISU = '邪闘 シス';
const JASHIN = 'アビスベル=ジャシン帝';
const MARDAN = '深淵の壊炉 マーダン=ロウ';
const TELE = '謀遠 テレスコ=テレス';
const MACUA = 'ア:エヌ:マクア';
const HAROAD = 'アビスベル=覇=ロード';
const DOMI = 'ドミー=ゾー';
const BELLA = '悪魔妖精ベラドンナ';
const ORDER = '秩序の意志';
const power = (sim: Sim, p: 0 | 1, name: string) => powerOf(mkCtx(sim.s, reg), sim.s.players[p].battle.find((x) => x.pid === sim.pid(p, name))!);
const attackActions = (sim: Sim) => sim.legal().filter((a) => a.type === 'ATTACK');

describe('M01 邪幽 ジャガイスト', () => {
  it('出た時、手札を2枚捨ててもよい。そうしたら、アビス・メクレイド5する。山札からクリーチャーが出たら、墓地のアビスを出せる(攻撃しなければ戻らない)', () => {
    const sim = new Sim({
      p0: { hand: [JAGA, N, N], mana: mana(5, D), deck: [DOMI, N, N, N], grave: [TELE] },
      p1: { deck: [N, N, N] },
    });
    sim.play(JAGA);
    sim.yes();
    sim.pick(DOMI); // メクレイドで出す
    sim.order('各ターンに1度');
    sim.pick(TELE); // 墓地から出す
    sim.no(); // ドミー=ゾーの「山札の上から5枚を墓地に置く」は使わない
    sim.drain();
    expect(sim.count(0, 'grave', N)).toBe(2);
    expect(sim.has(0, 'battle', DOMI)).toBe(true);
    expect(sim.has(0, 'battle', TELE)).toBe(true);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
});

describe('M02 邪闘 シス', () => {
  it('出た時、相手のクリーチャーを1体選ぶ。このターン、そのクリーチャーのパワーを-∞する', () => {
    const sim = new Sim({ p0: { hand: [SHISU], mana: mana(6, D) }, p1: { battle: [{ c: '終末の監視者 ジ・ウォッチ' }] } });
    sim.play(SHISU);
    sim.drain();
    expect(sim.has(1, 'battle', '終末の監視者 ジ・ウォッチ')).toBe(false);
  });
  it('アビスラッシュ: 墓地から召喚でき、そのターンプレイヤーを攻撃できる。ターンの終わりに山札の下に置かれる', () => {
    const sim = new Sim({ p0: { grave: [SHISU], mana: mana(6, D), deck: [N, N, N] }, p1: { shield: 5, battle: [{ c: W }] } });
    sim.play(SHISU, { from: 'grave' });
    sim.drain();
    expect(sim.has(0, 'battle', SHISU)).toBe(true);
    expect(attackActions(sim).some((a) => a.type === 'ATTACK' && a.attacker === sim.pid(0, SHISU) && a.target.kind === 'player')).toBe(true);
    sim.endTurn();
    sim.drain();
    expect(sim.has(0, 'battle', SHISU)).toBe(false);
    expect(sim.s.players[0].deck.map((u) => sim.s.cards[u].defId)).toContain(sim.s.cards[sim.uid(0, 'deck', SHISU)].defId);
  });
});

describe('M03 アビスベル=ジャシン帝', () => {
  it('自分の墓地にあるアビス・クリーチャーに「アビスラッシュ」を与え、墓地のクリーチャーの召喚コストを2少なくする', () => {
    const sim = new Sim({ p0: { battle: [{ c: JASHIN }], grave: [MARDAN], mana: mana(2, D) } });
    sim.play(MARDAN, { from: 'grave' });
    expect(sim.tappedMana(0)).toBe(2);
    expect(sim.has(0, 'battle', MARDAN)).toBe(true);
    expect(attackActions(sim).some((a) => a.type === 'ATTACK' && a.attacker === sim.pid(0, MARDAN))).toBe(true);
  });
  it('このクリーチャーが離れる時、かわりに自分の手札を2枚捨ててもよい', () => {
    const sim = new Sim({ p0: { battle: [{ c: JASHIN }], hand: [N, N] }, p1: { hand: ['青銅のバンビシカット'], mana: mana(9, 'ドンドン火噴くナウ'), deck: [N, N] }, active: 1 });
    sim.play('青銅のバンビシカット', { face: 1 });
    sim.drain(1); // 破壊する対象は1体だけ
    if (sim.s.pending?.input?.shape === 'option') sim.option(0);
    if (sim.s.pending?.input?.shape === 'yesno') sim.yes();
    if (sim.s.pending?.input?.shape === 'pick') sim.answer(sim.s.pending.input.candidates.slice(0, 2));
    sim.drain();
    expect(sim.has(0, 'battle', JASHIN)).toBe(true);
    expect(sim.count(0, 'grave', N)).toBe(2);
  });
});

describe('M04 深淵の壊炉 マーダン=ロウ', () => {
  it('出た時、相手の手札を見てクリーチャーを1体選び、捨てさせる', () => {
    const sim = new Sim({ p0: { hand: [MARDAN], mana: mana(4, D) }, p1: { hand: [W, 'クリムゾン・ビクトリー'] } });
    sim.play(MARDAN);
    sim.use(W);
    sim.drain();
    expect(sim.has(1, 'grave', W)).toBe(true);
  });
  it('シビルカウント3: 闇のクリーチャーが3つ以上あれば、攻撃する時、相手の墓地のカードの「出た時」の能力を使い、山札の下に置く', () => {
    const sim = new Sim({
      p0: { battle: [{ c: MARDAN }, { c: D }, { c: D }] },
      p1: { grave: ['AQvibrato'], shield: 5, deck: [N, N, N] },
    });
    sim.attack(MARDAN, 'player');
    sim.use('AQvibrato');
    sim.drain();
    expect(sim.has(1, 'grave', 'AQvibrato')).toBe(false);
    expect(sim.count(0, 'hand')).toBeGreaterThanOrEqual(1); // AQvibrato の「出た時、カードを1枚引く」
    expect(checkInvariants(sim.s)).toEqual([]);
  });
});

describe('M05 謀遠 テレスコ=テレス', () => {
  it('相手のターンのはじめに、相手の手札を1枚見ないで選び、捨てさせる。相手が捨てたら、カードを1枚引いてもよい', () => {
    const sim = new Sim({ p0: { battle: [{ c: TELE }], deck: [N, N, N] }, p1: { hand: [W], deck: [N, N, N] } });
    sim.endTurn();
    sim.use();
    sim.drain();
    expect(sim.has(1, 'grave', W)).toBe(true);
    expect(sim.count(0, 'hand')).toBe(1);
  });
  it('手札がないプレイヤー1人につき、パワーを+5000する', () => {
    const sim = new Sim({ p0: { battle: [{ c: TELE }], hand: [N] }, p1: { hand: [] } });
    expect(power(sim, 0, TELE)).toBe(10000);
    const sim2 = new Sim({ p0: { battle: [{ c: TELE }], hand: [] }, p1: { hand: [] } });
    expect(power(sim2, 0, TELE)).toBe(15000);
  });
});

describe('M06 フットレス=トレース / 「力が欲しいか?」', () => {
  it('自分のターンの終わりに、山札の上から1枚を墓地に置き、闇のカードを1枚、墓地から手札に戻してもよい', () => {
    const sim = new Sim({ p0: { battle: [{ c: D }], deck: [MARDAN, N, N] } });
    sim.endTurn();
    sim.use(MARDAN);
    sim.drain();
    expect(sim.has(0, 'hand', MARDAN)).toBe(true);
  });
  it('「力が欲しいか?」: アビス・メクレイド5', () => {
    const sim = new Sim({ p0: { hand: [D], mana: mana(4, D), deck: [DOMI, N, N, N] } });
    sim.play(D, { face: 1 });
    sim.pick(DOMI);
    sim.drain();
    expect(sim.has(0, 'battle', DOMI)).toBe(true);
  });
});

describe('M07 秩序の意志', () => {
  it('封印を付ける', () => {
    const sim = new Sim({ p0: { hand: [ORDER], mana: mana(4, D), deck: [N, N, N] }, p1: { battle: [{ c: '終末の監視者 ジ・ウォッチ' }] } });
    sim.play(ORDER);
    sim.drain();
    expect(sim.s.players[1].battle[0].seals?.length).toBe(1);
  });
  it('S・バック: 闇のカードがシールドゾーンから手札に加わる時、それを捨てて、手札のこの呪文をコストを支払わずに唱えてもよい', () => {
    const sim = new Sim({
      p0: { battle: [{ c: W }] },
      p1: { shield: [D], hand: [ORDER], battle: [{ c: '終末の監視者 ジ・ウォッチ' }], deck: [N, N, N] },
    });
    sim.attack(W, 'player');
    sim.yes();
    sim.drain();
    expect(sim.has(1, 'grave', D)).toBe(true);
    expect(sim.has(1, 'grave', ORDER)).toBe(true);
    expect(sim.count(1, 'hand')).toBe(0);
    expect(sim.s.players[0].battle.length).toBe(1);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
});

describe('M08 ア:エヌ:マクア', () => {
  it('出た時: 山札の上から2枚をタップしてマナゾーンに置き、カードを1枚マナゾーンから手札に戻す', () => {
    const sim = new Sim({ p0: { hand: [MACUA], mana: mana(5, N), deck: [N, N, N] } });
    sim.play(MACUA);
    sim.option(0);
    sim.drain();
    expect(sim.count(0, 'mana')).toBe(6);
    expect(sim.count(0, 'hand')).toBe(1);
  });
  it('出た時: プレイヤーの墓地をシャッフルして山札の下に置く', () => {
    const sim = new Sim({ p0: { hand: [MACUA], mana: mana(5, N) }, p1: { grave: [W, W, N] } });
    sim.play(MACUA);
    sim.option(2);
    sim.drain();
    expect(sim.count(1, 'grave')).toBe(0);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
});

describe('M09 アビスベル=覇=ロード', () => {
  it('自分のアビスすべてに「マッハファイター」を与える', () => {
    const sim = new Sim({ p0: { battle: [{ c: HAROAD }, { c: DOMI, sick: true }] }, p1: { battle: [{ c: W, tapped: true }] } });
    expect(attackActions(sim).some((a) => a.type === 'ATTACK' && a.attacker === sim.pid(0, DOMI) && a.target.kind === 'creature')).toBe(true);
  });
  it('自分のターンの終わりに、コスト6以下のアビス・クリーチャーを1体、墓地から出してもよい', () => {
    const sim = new Sim({ p0: { battle: [{ c: HAROAD }], grave: [DOMI] } });
    sim.endTurn();
    sim.use(DOMI);
    sim.drain();
    expect(sim.has(0, 'battle', DOMI)).toBe(true);
  });
  it('各ターン、相手のクリーチャーがはじめて攻撃するなら、可能ならこのクリーチャー(タップ)を攻撃する。2回目からは自由', () => {
    const sim = new Sim({ p0: { battle: [{ c: HAROAD, tapped: true }] }, p1: { battle: [{ c: W }, { c: W }] }, active: 1 });
    const acts = attackActions(sim);
    expect(acts.length).toBeGreaterThan(0);
    expect(acts.every((a) => a.type === 'ATTACK' && a.target.kind === 'creature')).toBe(true);
  });
});

describe('M10 ドミー=ゾー / M11 悪魔妖精ベラドンナ', () => {
  it('ドミー=ゾー: 出た時、山札の上から5枚を墓地に置いてもよい', () => {
    const sim = new Sim({ p0: { hand: [DOMI], mana: mana(5, D), deck: [N, N, N, N, N, N] } });
    sim.play(DOMI);
    sim.use();
    expect(sim.count(0, 'grave')).toBe(5);
  });
  it('「倒したいか?」: 山札の上から1枚をマナゾーンに置く', () => {
    const sim = new Sim({ p0: { hand: [DOMI], mana: mana(2, N), deck: [N, N] } });
    sim.play(DOMI, { face: 1 });
    expect(sim.count(0, 'mana')).toBe(3);
  });
  it('ベラドンナ: 出た時、破壊してもよい。そうしたら、相手の手札を1枚見ないで捨てさせる', () => {
    const sim = new Sim({ p0: { hand: [BELLA], mana: [D, N] }, p1: { hand: [W] } });
    sim.play(BELLA);
    sim.use();
    sim.option(0);
    sim.drain();
    expect(sim.has(0, 'grave', BELLA)).toBe(true);
    expect(sim.has(1, 'grave', W)).toBe(true);
  });
});
