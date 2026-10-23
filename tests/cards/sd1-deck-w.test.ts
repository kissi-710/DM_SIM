// デッキW「敵は周回遅れ！火水闇レッドゾーンデッキ」の新規カード(docs/decks-25oudou.md)のシナリオテスト。侵略・超次元ゾーン・パンドラ・シフト・封印・ターンの残りをとばすなど。
import { describe, expect, it } from 'vitest';
import { Sim, mana } from '../scenario';
import { checkInvariants } from '../../src/engine/invariants';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const F = 'ドンドン火噴くナウ'; // 水火自然
const CLOCK = '終末の時計 ザ・クロック';
const GAREC = '逆転の影ガレック';
const REDZONE = '轟く侵略 レッドゾーン';
const REDZONE_F = '覇帝なき侵略 レッドゾーンF';
const VALT = '龍装者 バルチュリス';
const ROYAL = '超次元の王家';
const PRIN = '再興王女プリン';
const BLACKZONE = '禁断の轟速 ブラックゾーン';
const TRIPPER = '影速 ザ・トリッパー';
const HEART = '邪心臓の魔法陣';
const HUNTER = '勝利宣言 鬼丸「覇」'; // 火のコマンド(レッド・コマンド・ドラゴン)
const attackActions = (sim: Sim) => sim.legal().filter((a) => a.type === 'ATTACK');

describe('W01 終末の時計 ザ・クロック / W02 逆転の影ガレック', () => {
  it('ザ・クロック: 出た時、ターンの残りをとばす', () => {
    const sim = new Sim({ p0: { hand: [CLOCK], mana: mana(3, W) }, p1: { deck: [N, N] } });
    sim.play(CLOCK);
    sim.drain();
    expect(sim.s.active).toBe(1);
    expect(sim.has(0, 'battle', CLOCK)).toBe(true);
  });
  it('ガレック: 出た時、次の中から3回選ぶ(山札の上から3枚を墓地に置く、を3回)', () => {
    const sim = new Sim({ p0: { hand: [GAREC], mana: mana(10, 'フットレス=トレース'), deck: Array(10).fill(N) } });
    sim.play(GAREC);
    sim.option(1, 1, 1);
    sim.drain();
    expect(sim.count(0, 'grave')).toBe(9);
  });
});

describe('W03 レッドゾーン / W04 レッドゾーンF', () => {
  it('レッドゾーン: 侵略[火のコマンド]。出た時、相手のパワーが一番大きいクリーチャーをすべて破壊する', () => {
    const sim = new Sim({ p0: { hand: [REDZONE], battle: [{ c: HUNTER }] }, p1: { battle: [{ c: '終末の監視者 ジ・ウォッチ' }, { c: W }], shield: 5 } });
    sim.attack(HUNTER, 'player');
    sim.yes();
    sim.drain();
    expect(sim.has(0, 'battle', REDZONE)).toBe(true);
    expect(sim.has(1, 'battle', '終末の監視者 ジ・ウォッチ')).toBe(false);
    expect(sim.has(1, 'battle', W)).toBe(true);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('レッドゾーンF: 攻撃中、相手は「G・ストライク」を使えない', () => {
    const sim = new Sim({ p0: { battle: [{ c: REDZONE_F, under: [HUNTER] }] }, p1: { shield: ['光開の精霊サイフォゲート'.length ? '邪脳の魔法陣' : N] } });
    sim.attack(REDZONE_F, 'player');
    expect(sim.s.pending?.why).not.toBe('triggerDeclare');
  });
  it('レッドゾーンF: 各ターン、最初の攻撃の終わりに、このクリーチャーをアンタップし、一番上のカードを破壊する', () => {
    const sim = new Sim({ p0: { battle: [{ c: REDZONE_F, under: [HUNTER] }] }, p1: { shield: 5 } });
    sim.attack(REDZONE_F, 'player');
    sim.drain();
    expect(sim.has(0, 'grave', REDZONE_F)).toBe(true);
    expect(sim.has(0, 'battle', HUNTER)).toBe(true);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
});

describe('W05 龍装者 バルチュリス', () => {
  it('自分のクリーチャーが攻撃する時、その攻撃がこのターン2度目のクリーチャーによる攻撃であれば、攻撃の後、このクリーチャーを手札から出してもよい', () => {
    const sim = new Sim({ p0: { hand: [VALT], battle: [{ c: HUNTER }, { c: 'AQvibrato', sick: false }] }, p1: { shield: 5 } });
    sim.attack(HUNTER, 'player');
    sim.drain();
    sim.attack('AQvibrato', 'player');
    sim.yes();
    sim.drain();
    expect(sim.has(0, 'battle', VALT)).toBe(true);
  });
});

describe('W06 超次元の王家 / W07 再興王女プリン', () => {
  it('パンドラ・シフト: 実行するコストのかわりに[水/火(2)]を支払って、自分の超次元ゾーンに置く。置かれた時、カードを2枚引き、手札を1枚捨てる', () => {
    const sim = new Sim({ p0: { hand: [ROYAL, N], mana: [...mana(2, F)], deck: [N, N, N] } });
    sim.play(ROYAL, { extra: { alt: 'pandora' } });
    sim.drain(1);
    sim.drain();
    expect(sim.s.players[0].hyper.length).toBe(1);
    expect(sim.count(0, 'hand')).toBe(2);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('このクリーチャーを自分の超次元ゾーンから召喚してもよい', () => {
    const sim = new Sim({ p0: { hyper: [ROYAL], mana: [...mana(4, F)], deck: [N, N, N] } });
    sim.play(ROYAL, { from: 'hyper' });
    sim.drain();
    expect(sim.has(0, 'battle', ROYAL)).toBe(true);
  });
  it('プリン: 自分のターンのはじめに、このクリーチャーを超次元ゾーンに置いてもよい。そうしたら、プリンではないエイリアン・クリーチャーを1体、超次元ゾーンから出す', () => {
    const sim = new Sim({ p0: { battle: [{ c: PRIN }], hyper: [ROYAL], deck: [N, N, N, N] }, p1: { deck: [N, N] }, active: 1 });
    sim.endTurn();
    sim.yes();
    sim.pick(ROYAL);
    sim.drain();
    expect(sim.has(0, 'battle', ROYAL)).toBe(true);
    expect(sim.s.players[0].hyper.length).toBe(1); // プリンが超次元ゾーンに
  });
});

describe('W08 ブラックゾーン / W09 ザ・トリッパー / W10 邪心臓の魔法陣', () => {
  it('ブラックゾーン: 出た時、相手は自身のパワーが一番小さいクリーチャーすべてに封印を1つずつ付ける', () => {
    const sim = new Sim({ p0: { hand: [BLACKZONE], battle: [{ c: HUNTER }], mana: [...mana(4, F), ...mana(3, 'フットレス=トレース')] }, p1: { battle: [{ c: W }, { c: '終末の監視者 ジ・ウォッチ' }], deck: [N, N, N] } });
    sim.play(BLACKZONE, { extra: { onto: sim.pid(0, HUNTER) } });
    sim.drain();
    const sealed = sim.s.players[1].battle.filter((p) => (p.seals?.length ?? 0) > 0);
    expect(sealed.length).toBe(1);
    expect(sim.s.cards[sealed[0].cards[0]].defId).toBe(sim.s.cards[sim.uid(1, 'battle', W)].defId);
  });
  it('ザ・トリッパー: 相手のカードは、マナゾーンにタップして置かれる', () => {
    const sim = new Sim({ p0: { battle: [{ c: TRIPPER }] }, p1: { hand: [W] }, step: 'mana', active: 1 });
    sim.charge(W);
    expect(sim.s.cards[sim.uid(1, 'mana', W)].tapped).toBe(true);
  });
  it('邪心臓の魔法陣: 出た時、手札を1枚捨て、カードを3枚まで引き、もう一度手札を1枚捨てる', () => {
    const sim = new Sim({ p0: { hand: [HEART, N, N], mana: [...mana(1, W), ...mana(1, 'フットレス=トレース'), ...mana(1, F)], deck: [N, N, N, N] } });
    sim.play(HEART);
    sim.pick(N);
    sim.option(0);
    sim.pick(N);
    sim.drain();
    expect(sim.count(0, 'grave')).toBe(2);
    expect(sim.count(0, 'hand')).toBe(3); // 2 - 1 + 3 - 1
  });
});

void attackActions;
