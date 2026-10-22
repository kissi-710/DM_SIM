// デッキT「元祖守りの王道!光自然巨大ゲートデッキ」の新規カード(docs/decks-25oudou.md)のシナリオテスト。ブロッカーを出す・チャージャー・エスケープ・離れないなど。
import { describe, expect, it } from 'vitest';
import { Sim, mana } from '../scenario';
import { checkInvariants } from '../../src/engine/invariants';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const L = 'ダミー'; // 光
const WELK = '闘門の精霊ウェルキウス';
const SIPHO = '光開の精霊サイフォゲート';
const AKERNAR = '星門の精霊アケルナル';
const HEAVEN = 'ヘブンズ・ゲート';
const STILT = '竹馬の超人';
const BLUEPRINT = '巨大設計図';
const HADES = '冥界を統べる新月のハーデス';
const SHEBA = '剛撃聖霊シェバ・エリクシア';
const VELVET = '閃光の神官 ヴェルベット';
const GIO = '超七極 Gio';
const NERO = '邪光魔縛 ネロマノフ=ルドルフI世';
const MIKADO = '終末縫合王 ミカドレオ';

describe('T01 ウェルキウス / T02 サイフォゲート / T03 アケルナル / T04 ヘブンズ・ゲート', () => {
  it('ウェルキウス: 出た時、カードを1枚引く。その後、「ブロッカー」を持つクリーチャーを1体、手札から出してもよい', () => {
    const sim = new Sim({ p0: { hand: [WELK, SIPHO], mana: mana(9, L), deck: [N, N] } });
    sim.play(WELK);
    sim.yes();
    sim.pick(SIPHO);
    sim.drain();
    expect(sim.has(0, 'battle', SIPHO)).toBe(true);
    expect(sim.count(0, 'hand')).toBe(1);
  });
  it('サイフォゲート: 出た時、光の「ブロッカー」を持つ進化ではないクリーチャーを1体、手札から出してもよい', () => {
    const sim = new Sim({ p0: { hand: [SIPHO, VELVET], mana: mana(6, L) } });
    sim.play(SIPHO);
    sim.yes();
    sim.pick(VELVET);
    sim.drain();
    expect(sim.has(0, 'battle', VELVET)).toBe(true);
  });
  it('アケルナル: 自分のターンの終わりに、光の「ブロッカー」を持つ進化ではないクリーチャーを手札から出してもよい', () => {
    const sim = new Sim({ p0: { battle: [{ c: AKERNAR }], hand: [VELVET] } });
    sim.endTurn();
    sim.yes();
    sim.pick(VELVET);
    sim.drain();
    expect(sim.has(0, 'battle', VELVET)).toBe(true);
  });
  it('スターゲイズ・ゲート: 光の「ブロッカー」を持つ進化ではないクリーチャーを1体、手札から出す', () => {
    const sim = new Sim({ p0: { hand: [AKERNAR, SIPHO], mana: mana(5, L) } });
    sim.play(AKERNAR, { face: 1 });
    sim.pick(SIPHO);
    sim.drain();
    expect(sim.has(0, 'battle', SIPHO)).toBe(true);
  });
  it('ヘブンズ・ゲート: 光の「ブロッカー」を持つ進化ではないクリーチャーを2体まで、手札から出す', () => {
    const sim = new Sim({ p0: { hand: [HEAVEN, SIPHO, VELVET], mana: mana(6, L) } });
    sim.play(HEAVEN);
    sim.pick(SIPHO, VELVET);
    sim.drain();
    expect(sim.count(0, 'battle')).toBe(2);
  });
});

describe('T05 竹馬の超人 / テイクバック・チャージャー / T06 巨大設計図', () => {
  it('テイクバック・チャージャー: コスト3以下のエレメントを1つ選び、タップして持ち主のマナゾーンに置く。チャージャー: 唱えた後、マナゾーンに置く', () => {
    const sim = new Sim({ p0: { hand: [STILT], mana: mana(3, N) }, p1: { battle: [{ c: W }, { c: 'AQvibrato' }] } });
    sim.play(STILT, { face: 1 });
    sim.pick('AQvibrato');
    sim.drain();
    expect(sim.has(1, 'mana', 'AQvibrato')).toBe(true);
    expect(sim.s.cards[sim.uid(1, 'mana', 'AQvibrato')].tapped).toBe(true);
    expect(sim.has(0, 'mana', STILT)).toBe(true); // チャージャー
    expect(sim.has(0, 'grave', STILT)).toBe(false);
  });
  it('竹馬の超人: 出た時、山札の上から2枚をタップしてマナゾーンに置く', () => {
    const sim = new Sim({ p0: { hand: [STILT], mana: mana(7, N), deck: [N, N, N] } });
    sim.play(STILT);
    expect(sim.count(0, 'mana')).toBe(9);
  });
  it('巨大設計図: 山札の上から4枚を表向きにして、コスト7以上のクリーチャーをすべて手札に加える', () => {
    const sim = new Sim({ p0: { hand: [BLUEPRINT], mana: mana(2, N), deck: [STILT, N, SHEBA, N, N] } });
    sim.play(BLUEPRINT);
    expect(sim.count(0, 'hand')).toBe(2);
  });
});

describe('T07 ハーデス / T08 シェバ・エリクシア', () => {
  it('ハーデス: 自分のクリーチャーすべてに「エスケープ」を与える(破壊される時、かわりにシールドを1つ手札に加えてもよい)', () => {
    const sim = new Sim({
      p0: { battle: [{ c: HADES }, { c: W }], shield: 2 },
      p1: { hand: ['青銅のバンビシカット'], mana: mana(9, 'ドンドン火噴くナウ'), deck: [N, N] },
      active: 1,
    });
    sim.play('青銅のバンビシカット', { face: 1 });
    let guard = 0;
    while (sim.s.pending && sim.s.pending.why !== 'turnAction' && guard++ < 8) {
      const inp: any = sim.s.pending.input;
      if (inp.shape === 'option') sim.option(0);
      else sim.drain(1);
    }
    expect(sim.has(0, 'battle', W)).toBe(true);
  });
  it('ハーデス オシオキムーン: カードが自分のシールドゾーンを離れた時、相手のクリーチャーを1体選び、破壊する', () => {
    const sim = new Sim({ p0: { battle: [{ c: HADES }], shield: 3 }, p1: { battle: [{ c: W, sick: false }], deck: [N, N] }, active: 1 });
    sim.attack(W, 'player');
    sim.drain();
    expect(sim.has(1, 'battle', W)).toBe(false);
  });
  it('シェバ・エリクシア: 出た時、コストの合計が7以下になるように、クリーチャーを2体まで自分のマナゾーンから出す', () => {
    const sim = new Sim({ p0: { hand: [SHEBA], mana: [...mana(4, L), ...mana(4, N), W, 'AQvibrato'] } });
    sim.play(SHEBA);
    sim.pick(W, 'AQvibrato');
    sim.drain();
    expect(sim.has(0, 'battle', W)).toBe(true);
    expect(sim.has(0, 'battle', 'AQvibrato')).toBe(true);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
});

describe('T09 ヴェルベット / T10 Gio', () => {
  it('ヴェルベット: 相手のクリーチャーは、タップして出る', () => {
    const sim = new Sim({ p0: { battle: [{ c: VELVET }] }, p1: { hand: [W], mana: mana(4, W) }, active: 1 });
    sim.play(W);
    expect(sim.s.players[1].battle[0].tapped).toBe(true);
  });
  it('フェアリー・パワー: 山札の上から1枚目をマナゾーンに置く。それがパワー6000以上のクリーチャーなら、カードを1枚引く', () => {
    const sim = new Sim({ p0: { hand: [VELVET], mana: mana(3, N), deck: [STILT, N, N] } });
    sim.play(VELVET, { face: 1 });
    expect(sim.count(0, 'mana')).toBe(4);
    expect(sim.count(0, 'hand')).toBe(1);
  });
  it('Gio: 手札にある他のコスト9のカード1枚につき、召喚コストを1少なくする(光のクリーチャーの上に進化)', () => {
    const sim = new Sim({ p0: { hand: [GIO, VELVET, AKERNAR], battle: [{ c: SIPHO }], mana: mana(7, L) } });
    sim.play(GIO, { extra: { onto: sim.pid(0, SIPHO) } });
    expect(sim.has(0, 'battle', GIO)).toBe(true);
    expect(sim.tappedMana(0)).toBe(7);
  });
});

describe('T11 ネロマノフ / T12 ミカドレオ', () => {
  it('ネロマノフ: 出た時、山札の上から2枚をタップしてマナゾーンに置き、その後、カードを2枚まで、自分のマナゾーンから手札に戻す', () => {
    const sim = new Sim({ p0: { hand: [NERO], mana: [...mana(3, L), ...mana(2, N), ...mana(2, 'フットレス=トレース')], deck: [N, N, N, N, N, N] } });
    sim.play(NERO);
    sim.pick(N, N);
    sim.drain();
    expect(sim.count(0, 'hand')).toBe(2);
  });
  it('ネロマノフ: 各ターンはじめて、自分が攻撃された時、各相手の手札を1枚見ないで選び、捨てさせる', () => {
    const sim = new Sim({ p0: { battle: [{ c: NERO }], shield: 3 }, p1: { battle: [{ c: W }], hand: [N, N] }, active: 1 });
    sim.attack(W, 'player');
    sim.drain();
    expect(sim.count(1, 'grave')).toBe(1);
  });
  it('ミカドレオ: 召喚によって出た時、山札の上から4枚を表向きにする。好きな数のクリーチャーを出し、残りをマナゾーンに置く', () => {
    const sim = new Sim({ p0: { hand: [MIKADO], mana: [...mana(4, W), ...mana(3, N), ...mana(3, 'フットレス=トレース')], deck: [W, N, STILT, N, N] } });
    sim.play(MIKADO);
    sim.pick(STILT); // EXライフで、山札の上の1枚がシールドになる
    sim.drain();
    expect(sim.has(0, 'battle', STILT)).toBe(true);
    expect(sim.count(0, 'shield')).toBeGreaterThanOrEqual(1);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('ミカドレオ: 自分のターンのはじめに、自分のコスト8以上のクリーチャーが4体以上あれば、自分はゲームに勝つ', () => {
    const sim = new Sim({ p0: { battle: [{ c: MIKADO }, { c: SHEBA }, { c: STILT }, { c: HADES }, { c: WELK }] }, p1: { deck: [N, N] }, active: 1 });
    sim.endTurn();
    sim.drain();
    expect(sim.s.winner).toBe(0);
  });
});
