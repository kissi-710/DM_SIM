// デッキJ「めくりに命をかけろ！８軸ガチロボデッキ」の新規カード(docs/decks-25oudou.md)のシナリオテスト。
import { describe, expect, it } from 'vitest';
import { Sim, mana } from '../scenario';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const D = 'ロスト・Re:ソウル';
const F = 'ドンドン火噴くナウ'; // 水火自然
const DEDAM = '天災 デドダム'; // コスト3の水闇自然

describe('J01 ガチャンコ ガチロボ', () => {
  it('出た時、山札の上から3枚を表向きにし、すべて同じコストのクリーチャーなら出す', () => {
    const sim = new Sim({ p0: { hand: ['ガチャンコ ガチロボ'], mana: mana(6, W), deck: [DEDAM, DEDAM, DEDAM, N, N] } });
    sim.play('ガチャンコ ガチロボ');
    sim.drain();
    expect(sim.count(0, 'battle', DEDAM)).toBe(3);
  });
  it('そうでなければ、山札の下に置く', () => {
    const sim = new Sim({ p0: { hand: ['ガチャンコ ガチロボ'], mana: mana(6, W), deck: [DEDAM, W, DEDAM, N, N] } });
    sim.play('ガチャンコ ガチロボ');
    sim.drain();
    expect(sim.count(0, 'battle', DEDAM)).toBe(0);
    expect(sim.names(0, 'deck').slice(-3)).toEqual(['天災 デドダム', 'アクアン', '天災 デドダム']);
  });
  it('相手のシールドが2つ以下なら、自分の水のクリーチャーは攻撃もブロックもされない', () => {
    const sim = new Sim({
      p0: { battle: ['ガチャンコ ガチロボ', { c: W }] },
      p1: { battle: [{ c: W, tapped: false }], shield: 2 },
      active: 1,
    });
    // 相手(p1)から見た攻撃先: 自分のクリーチャーは選べない
    const atk = sim.legal().filter((a) => a.type === 'ATTACK' && a.target.kind === 'creature');
    expect(atk.length).toBe(0);
    const sim2 = new Sim({ p0: { battle: ['ガチャンコ ガチロボ', { c: W }] }, p1: { battle: [{ c: W }], shield: 3 }, active: 1 });
    sim2.s.players[0].battle.forEach((p) => (p.tapped = true));
    expect(sim2.legal().filter((a) => a.type === 'ATTACK' && a.target.kind === 'creature').length).toBe(2);
  });
});

describe('J02 カブトリアル・クーガ / J03 黒豆だんしゃく', () => {
  it('クーガ: バトルに勝った時、山札の上3枚から、クリーチャーを1体手札に加え、残りをマナゾーンに置く', () => {
    const sim = new Sim({ p0: { battle: [{ c: 'カブトリアル・クーガ' }], deck: [DEDAM, N, N, N] }, p1: { battle: [{ c: W, tapped: true }] } });
    sim.attack('カブトリアル・クーガ', W);
    sim.pick(DEDAM);
    expect(sim.has(0, 'hand', DEDAM)).toBe(true);
    expect(sim.count(0, 'mana')).toBe(2);
  });
  it('ミステリー・ディザスター: 山札をシャッフルし、上1枚が、クリーチャーなら出し、それ以外ならマナゾーンに置く', () => {
    const sim = new Sim({ p0: { hand: ['カブトリアル・クーガ'], mana: mana(5), deck: [N, N, N, N] } });
    sim.play('カブトリアル・クーガ', { face: 1 });
    expect(sim.count(0, 'mana')).toBe(6);
  });
  it('黒豆だんしゃく: 相手の「出た時」で始まる能力を持つクリーチャーが出た時、そのクリーチャーを持ち主のマナゾーンに置く', () => {
    const sim = new Sim({ p0: { battle: ['黒豆だんしゃく'] }, p1: { hand: [W], mana: [W, W, W, W] }, active: 1 });
    sim.play(W);
    sim.drain();
    expect(sim.has(1, 'mana', W)).toBe(true);
  });
});

describe('J04 ギュカウツ・マグル / J07 ニコル・ボーラス / J08 ブラック・ビッグバン', () => {
  it('ギュカウツ: 出た時、山札の上4枚から、多色クリーチャーをコストの合計9以下で出す', () => {
    const sim = new Sim({ p0: { hand: ['勝災電融王 ギュカウツ・マグル'], mana: [W, F, N, N, N, N, N, N], deck: [N, DEDAM, DEDAM, DEDAM, N, N] } }); // 先頭の1枚は EXライフのシールドになる
    sim.play('勝災電融王 ギュカウツ・マグル');
    sim.pick(DEDAM, DEDAM, DEDAM);
    expect(sim.count(0, 'battle', DEDAM)).toBe(3);
  });
  it('ニコル・ボーラス: 出た時、相手は手札を7枚選んで捨てる。攻撃する時、相手のクリーチャーを破壊する', () => {
    const sim = new Sim({ p0: { hand: ['ニコル・ボーラス'], mana: [W, D, F, N, N, N, N, N] }, p1: { hand: [N, N, N, N, N, N, N, N, W], battle: [{ c: W }] } });
    sim.play('ニコル・ボーラス');
    sim.pick(N, N, N, N, N, N, N);
    expect(sim.count(1, 'hand')).toBe(2);
    sim.drain();
  });
  it('ブラック・ビッグバン: 山札が0枚になっても負けない', () => {
    const sim = new Sim({ p0: { battle: ['不死鳥縫合 ブラック・ビッグバン'], deck: [] } });
    sim.endMain();
    sim.endTurn();
    expect(sim.s.winner).toBeNull();
  });
  it('ブラック・ビッグバン: 出た時、山札の上2枚を墓地に置いてカードを2枚引く。山札がなければ、かわりにクリーチャーを墓地から出してもよい', () => {
    const sim = new Sim({ p0: { hand: ['不死鳥縫合 ブラック・ビッグバン'], mana: [W, D, N, N, N, N, N, N], deck: [N, N, N], grave: [DEDAM] } });
    sim.play('不死鳥縫合 ブラック・ビッグバン');
    // EXライフで1枚、墓地へ2枚 → 山札0枚。2枚引く時は、かわりに墓地のクリーチャーを出してもよい
    sim.use();
    expect(sim.has(0, 'battle', DEDAM)).toBe(true);
  });
});

describe('J05 闇参謀グラン・ギニョール(ムゲンクライム)', () => {
  it('ムゲンクライム2: クリーチャーを2体タップし、[水/闇(2)]を支払って、墓地から使える', () => {
    const sim = new Sim({
      p0: { battle: [{ c: W }, { c: W }], grave: ['闇参謀グラン・ギニョール'], mana: [W, D, N] },
      p1: { battle: [{ c: W, tapped: true }] },
    });
    const from = sim.legal().filter((a) => a.type === 'PLAY_CARD' && a.from === 'grave');
    expect(from.length).toBe(1);
    expect(from[0].type === 'PLAY_CARD' && from[0].extra?.alt).toBe('mugen2');
    sim.play('闇参謀グラン・ギニョール', { from: 'grave', extra: { alt: 'mugen2' } });
    expect(sim.s.players[0].battle.filter((p) => p.tapped).length).toBe(2);
    expect(sim.tappedMana(0)).toBe(2);
    expect(sim.has(0, 'battle', '闇参謀グラン・ギニョール')).toBe(true);
  });
  it('クリーチャーが2体いなければ、ムゲンクライムは使えない', () => {
    const sim = new Sim({ p0: { battle: [{ c: W }], grave: ['闇参謀グラン・ギニョール'], mana: [W, D] } });
    expect(sim.legal().some((a) => a.type === 'PLAY_CARD' && a.from === 'grave')).toBe(false);
  });
});

describe('J06 斬龍電融 オロチリュウセイ / J09 永遠のリュウセイ・カイザー', () => {
  it('オロチリュウセイ: 自分のクリーチャーすべてにスピードアタッカーを与え、自分のターン中、山札の上からクリーチャーを1体召喚してもよい', () => {
    const sim = new Sim({ p0: { battle: [{ c: '斬龍電融 オロチリュウセイ', sick: true }, { c: W, sick: true }], mana: [W, W, W, W], deck: [W, N, N] } });
    const atk = sim.legal().filter((a) => a.type === 'ATTACK' && a.target.kind === 'player').length;
    expect(atk).toBe(2);
    const fromDeck = sim.legal().filter((a) => a.type === 'PLAY_CARD' && a.from === 'deck');
    expect(fromDeck.length).toBe(1);
    sim.play(W, { from: 'deck' });
    sim.drain();
    expect(sim.count(0, 'battle', W)).toBe(2);
    expect(sim.legal().some((a) => a.type === 'PLAY_CARD' && a.from === 'deck')).toBe(false); // 1体だけ
  });
  it('永遠のリュウセイ・カイザー: 相手のクリーチャーはタップして出る', () => {
    const sim = new Sim({ p0: { battle: ['永遠のリュウセイ・カイザー'] }, p1: { hand: [W, W], mana: mana(8, W) }, active: 1 });
    sim.play(W);
    sim.drain();
    sim.play(W);
    sim.drain();
    expect(sim.s.players[1].battle.every((p) => p.tapped)).toBe(true);
  });
  it('永遠のリュウセイ・カイザー: 相手の効果で手札から捨てられる時、墓地に置くかわりに出してもよい', () => {
    const sim = new Sim({ p0: { hand: ['永遠のリュウセイ・カイザー'] }, p1: { hand: ['解体人形ジェニー'], mana: [D, D, D, D] }, active: 1 });
    sim.play('解体人形ジェニー');
    expect(sim.pending.why).toBe('replaceChoice');
    sim.option(0);
    expect(sim.has(0, 'battle', '永遠のリュウセイ・カイザー')).toBe(true);
  });
});

describe('J10 ボルシャック・ガラワルド / J11 閃光の精霊カンビアーレ', () => {
  it('ガラワルド: 召喚コストを、クリーチャー1体につき1少なくする', () => {
    const sim = new Sim({
      p0: { hand: ['ボルシャック・ガラワルド'], battle: [{ c: W }], mana: [F, F, F, F] },
      p1: { battle: [{ c: W }, { c: W }, { c: W }, { c: W }] },
    });
    expect(sim.canPlay('ボルシャック・ガラワルド')).toBe(true); // 8 - 5 = 3 で足りる
  });
  it('ガラワルド: 出た時、相手のクリーチャーを1体選んでバトルさせてもよい', () => {
    const sim = new Sim({ p0: { hand: ['ボルシャック・ガラワルド'], mana: mana(8, F) }, p1: { battle: [{ c: W }] } });
    sim.play('ボルシャック・ガラワルド');
    sim.use();
    expect(sim.has(1, 'battle', W)).toBe(false);
  });
  it('カンビアーレ 革命0: シールドゾーンから手札に加えた時、シールドが1つもなければ、手札から召喚してもよい', () => {
    const sim = new Sim({ p0: { shield: ['閃光の精霊カンビアーレ'] }, p1: { battle: [{ c: W }] }, active: 1 });
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, W), target: { kind: 'player' } });
    expect(sim.pending.why).toBe('may');
    sim.yes();
    sim.drain();
    expect(sim.has(0, 'battle', '閃光の精霊カンビアーレ')).toBe(true);
  });
  it('カンビアーレ: 出た時、相手のクリーチャーをすべてタップし、次の相手のターンのはじめにアンタップしない', () => {
    const sim = new Sim({ p0: { hand: ['閃光の精霊カンビアーレ'], mana: mana(8, 'ドラゴンズ・サイン') }, p1: { battle: [{ c: W }, { c: W }] } });
    sim.play('閃光の精霊カンビアーレ');
    sim.endMain();
    sim.endTurn();
    expect(sim.s.players[1].battle.every((p) => p.tapped)).toBe(true);
  });
});
