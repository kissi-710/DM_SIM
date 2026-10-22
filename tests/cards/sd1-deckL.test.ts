// デッキL「勝太のハンター&カイザー「刃鬼」」の新規カード(docs/decks-25oudou.md)のシナリオテスト。
import { describe, expect, it } from 'vitest';
import { Sim, mana } from '../scenario';
import { checkInvariants } from '../../src/engine/invariants';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const F = 'ドンドン火噴くナウ'; // 水火自然
const TITAN = '「合体」の頂 アクア・TITAAANS';
const DIEHARD = '不敗のダイハード・リュウセイ';
const RYUSEI = '「必然」の頂 リュウセイ';
const OUGA = '紅に染まりし者「王牙」';
const VIRUS = '超神龍バイラス・カースド';
const MECHADE = '「根性」の頂 メチャデ塊ゾウ';
const COBALT = 'メヂカラ・コバルト・カイザー';
const JINKI = '「勝利」の頂 カイザー「刃鬼」';
const BIG = '真久間メガ'; // コスト13
const attackActions = (sim: Sim, _p: 0 | 1) => sim.legal().filter((a) => a.type === 'ATTACK');

describe('L01 「合体」の頂 アクア・TITAAANS', () => {
  it('相手のクリーチャーが出た時、ガチンコ・ジャッジに勝てば、カードを1枚引き、相手のクリーチャーはそのターン攻撃できない', () => {
    const sim = new Sim({
      p0: { battle: [{ c: TITAN }], deck: [BIG, N, N] },
      p1: { hand: [W], battle: [{ c: W }], mana: mana(4, W), deck: [N, N, N] },
      active: 1,
    });
    sim.play(W);
    sim.drain();
    expect(sim.count(0, 'hand')).toBe(1);
    expect(attackActions(sim, 1)).toEqual([]);
  });
  it('ガチンコ・ジャッジに負ければ、何も起こらない', () => {
    const sim = new Sim({
      p0: { battle: [{ c: TITAN }], deck: [N, N, N] },
      p1: { hand: [W], battle: [{ c: W }], mana: mana(4, W), deck: [BIG, N, N] },
      active: 1,
    });
    sim.play(W);
    sim.drain();
    expect(sim.count(0, 'hand')).toBe(0);
    expect(attackActions(sim, 1).length).toBeGreaterThan(0);
  });
  it('「必殺!ジェット・カスケード・アタック!!」: 参加しているプレイヤー1人につき、カードを1枚引く(2枚)', () => {
    const sim = new Sim({ p0: { hand: [TITAN], mana: mana(3, W), deck: [N, N, N] } });
    sim.play(TITAN, { face: 1 });
    expect(sim.count(0, 'hand')).toBe(2);
  });
});

describe('L02 不敗のダイハード・リュウセイ', () => {
  it('自分のドラゴンが攻撃する時、相手のシールドを1つ墓地に置く', () => {
    const sim = new Sim({ p0: { battle: [{ c: DIEHARD }] }, p1: { shield: 5, deck: [N, N] } });
    sim.attack(DIEHARD, 'player');
    sim.drain();
    expect(sim.count(1, 'grave')).toBeGreaterThanOrEqual(1);
  });
  it('自分がゲームに負ける時、かわりにこのクリーチャーを破壊する。破壊された時、そのターン、自分はゲームに負けない', () => {
    const sim = new Sim({
      p0: { battle: [{ c: DIEHARD }], shield: 0, deck: [N, N] },
      p1: { battle: [{ c: W }], deck: [N, N] },
      active: 1,
    });
    sim.attack(W, 'player');
    sim.drain();
    expect(sim.s.winner).toBeNull();
    expect(sim.has(0, 'grave', DIEHARD)).toBe(true);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
});

describe('L03 「必然」の頂 リュウセイ / 「オレの勝利だオフコース!」', () => {
  it('自分のクリーチャーすべてに「スピードアタッカー」を与える', () => {
    const sim = new Sim({ p0: { hand: [W], battle: [{ c: RYUSEI }], mana: mana(4, W) }, p1: { shield: 5 } });
    sim.play(W);
    sim.drain();
    expect(attackActions(sim, 0).some((a) => a.type === 'ATTACK' && a.attacker === sim.pid(0, W))).toBe(true);
  });
  it('各ターンに1度、自分がゲームに負ける時、かわりに自分のハンターを1つ破壊してもよい', () => {
    const sim = new Sim({
      p0: { battle: [{ c: RYUSEI }, { c: DIEHARD }], shield: 0, deck: [N, N] },
      p1: { battle: [{ c: W }], deck: [N, N] },
      active: 1,
    });
    sim.attack(W, 'player');
    // どの置換を使うか(「必然」の効果を選ぶ)・どのハンターを破壊するか
    sim.option(0);
    sim.pick(DIEHARD);
    expect(sim.s.winner).toBeNull();
    expect(sim.has(0, 'grave', DIEHARD)).toBe(true);
    expect(sim.has(0, 'battle', RYUSEI)).toBe(true);
  });
  it('「オレの勝利だオフコース!」: 相手のクリーチャー1体につき、コストが1少なくなる。パワー4000以下のクリーチャーをすべて破壊する', () => {
    const sim = new Sim({
      p0: { hand: [RYUSEI], battle: [{ c: W }], mana: mana(3, F) },
      p1: { battle: [{ c: W }, { c: W }, { c: '終末の監視者 ジ・ウォッチ' }] },
    });
    sim.play(RYUSEI, { face: 1 });
    expect(sim.tappedMana(0)).toBe(3);
    expect(sim.count(1, 'battle', W)).toBe(0);
    expect(sim.count(0, 'battle', W)).toBe(0); // 自分のクリーチャーも破壊する
    expect(sim.has(1, 'battle', '終末の監視者 ジ・ウォッチ')).toBe(true);
  });
});

describe('L04 紅に染まりし者「王牙」 / クリムゾン・ビクトリー', () => {
  it('攻撃する時、ガチンコ・ジャッジに勝てば、山札の上から3枚を見て、ドラゴン・クリーチャーを1体出してもよい', () => {
    const sim = new Sim({
      p0: { battle: [{ c: OUGA }], deck: [BIG, DIEHARD, N, N, N] },
      p1: { shield: 5, deck: [N, N, N] },
    });
    sim.attack(OUGA, 'player');
    sim.pick(DIEHARD);
    sim.drain();
    expect(sim.has(0, 'battle', DIEHARD)).toBe(true);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('クリムゾン・ビクトリー: パワー2000以下のクリーチャーをすべて破壊する', () => {
    const sim = new Sim({
      p0: { hand: [OUGA], mana: mana(4, F), battle: [{ c: 'AQvibrato' }] },
      p1: { battle: [{ c: '終末の監視者 ジ・ウォッチ' }, { c: 'AQvibrato' }] },
    });
    sim.play(OUGA, { face: 1 });
    expect(sim.count(1, 'battle', 'AQvibrato')).toBe(0);
    expect(sim.count(0, 'battle', 'AQvibrato')).toBe(0);
    expect(sim.has(1, 'battle', '終末の監視者 ジ・ウォッチ')).toBe(true);
  });
});

describe('L05 超神龍バイラス・カースド', () => {
  it('このクリーチャーがタップしていれば、相手は自身の「S・トリガー」を使えない', () => {
    const sim = new Sim({
      p0: { battle: [{ c: VIRUS, tapped: true }, { c: W }] },
      p1: { shield: ['クリムゾン・ビクトリー'] },
    });
    // 攻撃クリーチャーは、バイラスがタップしているので、可能ならバイラスを攻撃する
    expect(attackActions(sim, 0).every((a) => a.type === 'ATTACK' && a.attacker !== sim.pid(0, VIRUS))).toBe(true);
    sim.attack(W, 'player');
    expect(sim.s.pending?.why).not.toBe('triggerDeclare');
    expect(sim.has(1, 'hand', 'クリムゾン・ビクトリー')).toBe(true);
  });
  it('アンタップしていれば、相手はS・トリガーを使える', () => {
    const sim = new Sim({ p0: { battle: [{ c: VIRUS }, { c: W }] }, p1: { shield: ['クリムゾン・ビクトリー'], mana: [] } });
    sim.attack(W, 'player');
    expect(sim.s.pending?.why).toBe('triggerDeclare');
  });
  it('相手のクリーチャーが攻撃するなら、可能ならこのクリーチャー(タップ)を攻撃する', () => {
    const sim = new Sim({
      p0: { battle: [{ c: W }, { c: VIRUS, tapped: true }] },
      p1: { battle: [{ c: W }] },
      active: 1,
    });
    const acts = attackActions(sim, 1);
    expect(acts.length).toBeGreaterThan(0);
    expect(acts.every((a) => a.type === 'ATTACK' && a.target.kind === 'creature' && a.target.pid === sim.pid(0, VIRUS))).toBe(true);
  });
  it('攻撃できるタップしたクリーチャーがなければ、ふつうに攻撃できる', () => {
    const sim = new Sim({ p0: { battle: [{ c: W }, { c: VIRUS }] }, p1: { battle: [{ c: W }] }, active: 1 });
    expect(attackActions(sim, 1).some((a) => a.type === 'ATTACK' && a.target.kind === 'player')).toBe(true);
  });
});

describe('L06 「根性」の頂 メチャデ塊ゾウ / 「大親分、ここにあり!」', () => {
  it('バトルに勝った時、マナゾーンのカードの枚数以下のコストのハンターを、マナゾーンから召喚してもよい', () => {
    const sim = new Sim({
      p0: { battle: [{ c: MECHADE }], mana: ['青銅のバンビシカット', N, N] },
      p1: { battle: [{ c: W, tapped: true }] },
    });
    sim.attack(MECHADE, W); // ブロッカーなし。バトルに勝つ
    sim.pick('青銅のバンビシカット');
    sim.drain();
    expect(sim.has(0, 'battle', '青銅のバンビシカット')).toBe(true);
    expect(sim.has(0, 'mana', '青銅のバンビシカット')).toBe(false);
  });
  it('「大親分、ここにあり!」: 山札の上から2枚を見て、1枚をマナゾーンに置き、残りを山札の下に置ける', () => {
    const sim = new Sim({ p0: { hand: [MECHADE], mana: mana(3, N), deck: [W, N, 'AQvibrato'] } });
    sim.play(MECHADE, { face: 1 });
    sim.pick(W);
    sim.option(1); // 残りを山札の下に置く
    sim.drain();
    expect(sim.count(0, 'mana')).toBe(4);
    expect(sim.has(0, 'mana', W)).toBe(true);
    expect(sim.s.players[0].deck.map((u) => sim.s.cards[u].defId).at(-1)).toBe(sim.s.cards[sim.uid(0, 'deck', N)].defId);
  });
});

describe('L07 メヂカラ・コバルト・カイザー / アイド・ワイズ・シャッター', () => {
  it('相手のクリーチャーが出た時、そのターン、相手のクリーチャーはすべて攻撃できない', () => {
    const sim = new Sim({ p0: { battle: [{ c: COBALT }] }, p1: { hand: [W], battle: [{ c: W }], mana: mana(4, W) }, active: 1 });
    sim.play(W);
    sim.drain();
    expect(attackActions(sim, 1)).toEqual([]);
  });
  it('相手が呪文を唱えた時、自分はカードを2枚引いてもよい', () => {
    const sim = new Sim({
      p0: { battle: [{ c: COBALT }], deck: [N, N, N, N] },
      p1: { hand: ['クリムゾン・ビクトリー'], mana: mana(4, F) },
      active: 1,
    });
    sim.play('クリムゾン・ビクトリー', { face: 1 });
    sim.use();
    sim.drain();
    expect(sim.count(0, 'hand')).toBe(2);
  });
  it('アイド・ワイズ・シャッター: 相手のクリーチャーを2体まで選んでタップする。次の相手のターンのはじめに、それらはアンタップしない', () => {
    const sim = new Sim({ p0: { hand: [COBALT], mana: mana(4, 'ダミー') }, p1: { battle: [{ c: W }, { c: W }] } });
    sim.play(COBALT, { face: 1 });
    sim.pick(W, W);
    sim.drain();
    expect(sim.s.players[1].battle.every((p) => p.tapped)).toBe(true);
    // 相手のターンのはじめに、アンタップしない
    sim.endTurn();
    sim.drain();
    expect(sim.s.players[1].battle.every((p) => p.tapped)).toBe(true);
  });
});

describe('L08 「勝利」の頂 カイザー「刃鬼」', () => {
  it('シンパシー: 自分のハンター・クリーチャー1体につき、コストが1少なくなる', () => {
    const sim = new Sim({ p0: { hand: [JINKI], battle: [{ c: DIEHARD }, { c: OUGA }], mana: mana(9, F) } });
    sim.play(JINKI);
    expect(sim.tappedMana(0)).toBe(9);
  });
  it('召喚によって出た時、ハンター・W・メクレイド10する(山札の上から3枚を見て、コスト10以下のハンターをコストを支払わずに使ってもよい。2回)', () => {
    const sim = new Sim({
      p0: { hand: [JINKI], battle: [{ c: DIEHARD }, { c: OUGA }, { c: DIEHARD }], mana: mana(8, F), deck: [DIEHARD, N, N, OUGA, N, N, N, N] },
    });
    sim.play(JINKI);
    sim.order('メクレイド');
    sim.pick(DIEHARD);
    sim.pick(OUGA);
    sim.drain();
    expect(sim.count(0, 'battle', DIEHARD)).toBe(3);
    expect(sim.count(0, 'battle', OUGA)).toBe(2);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('メクレイドで呪文(ハンター)を、コストを支払わずに唱えられる', () => {
    const sim = new Sim({
      p0: { hand: [JINKI], battle: [{ c: DIEHARD }, { c: OUGA }, { c: DIEHARD }], mana: mana(8, F), deck: ['「根性」の頂 メチャデ塊ゾウ', N, N, N, N, N, N, N] },
      p1: { deck: [N, N, N] },
    });
    sim.play(JINKI);
    sim.order('メクレイド');
    sim.pick('「根性」の頂 メチャデ塊ゾウ');
    sim.drain();
    expect(sim.count(0, 'battle', '「根性」の頂 メチャデ塊ゾウ')).toBe(1);
  });
  it('相手のシールドが5つ以上あれば、スピードアタッカーを持つ', () => {
    const sim = new Sim({ p0: { battle: [{ c: JINKI, sick: true }] }, p1: { shield: 5 } });
    expect(attackActions(sim, 0).length).toBeGreaterThan(0);
    const sim2 = new Sim({ p0: { battle: [{ c: JINKI, sick: true }] }, p1: { shield: 4 } });
    expect(attackActions(sim2, 0).length).toBe(0);
  });
});
