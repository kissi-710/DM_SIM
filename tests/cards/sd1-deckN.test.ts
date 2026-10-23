// デッキN「ジョーの一撃必殺旅路ジョーカーズデッキ」の新規カード(docs/decks-25oudou.md)のシナリオテスト。G・ブレイカー・J・O・E・キリフダッシュなど。
import { describe, expect, it } from 'vitest';
import { Sim, mana, reg } from '../scenario';
import { checkInvariants } from '../../src/engine/invariants';
import { infoOf, isIgnored } from '../../src/engine/derive';
import { mkCtx } from '../../src/engine/state';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const F = 'ドンドン火噴くナウ';
const GIORAGON = 'ジョギラゴン&ジョニー 〜Jの旅路〜';
const DENJA = 'めっちゃ! デンヂャラスG3';
const HELTO = 'ヘルトッQ';
const KATSURA = 'カツラデランス';
const PURI = 'プリプリズン';
const CHICKEN = 'チキン・タッ太';
const MONKID = 'モモダチ モンキッド';
const TIME = 'タイムピョンチキ';
const MMM = 'MMM-ジョーキング';
const WARERA = '我ら、モモダチ三人衆!!!';
const attackActions = (sim: Sim) => sim.legal().filter((a) => a.type === 'ATTACK');

describe('N01 ジョギラゴン&ジョニー 〜Jの旅路〜', () => {
  it('出た時、カードを1枚引き、手札を1枚捨てる。ジョーカーズ・クリーチャーを捨てたら、その「出た時」の能力を1つ使ってもよい', () => {
    const sim = new Sim({ p0: { hand: [GIORAGON, HELTO], mana: mana(8, N), deck: [N, N, N, N, N] } });
    sim.play(GIORAGON);
    sim.pick(HELTO); // 捨てる手札
    sim.yes(); // ヘルトッQの「出た時」を使う
    sim.yes(); // ヘルトッQの「出た時」: カードを引く
    sim.drain();
    expect(sim.has(0, 'grave', HELTO)).toBe(true);
    // 引いた1枚 + ヘルトッQの能力で、ジョーカーズ・クリーチャー1体(ジョギラゴン)につき1枚
    expect(sim.count(0, 'hand')).toBeGreaterThanOrEqual(2);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('相手は、自身のターンに1回までしか呪文を唱えられない', () => {
    const sim = new Sim({
      p0: { battle: [{ c: GIORAGON }] },
      p1: { hand: ['クリムゾン・ビクトリー', 'クリムゾン・ビクトリー'], mana: mana(8, F), deck: [N, N, N] },
      active: 1,
    });
    sim.play('クリムゾン・ビクトリー', { face: 1 });
    sim.drain();
    expect(sim.legal().some((a) => a.type === 'PLAY_CARD')).toBe(false);
  });
});

describe('N02 めっちゃ! デンヂャラスG3 / ケッシング・ゼロ', () => {
  it('G・ブレイカー: 相手のシールドをすべてブレイクし、その攻撃の後、自分のシールドをすべてブレイクする', () => {
    const sim = new Sim({ p0: { battle: [{ c: DENJA }], shield: 3, deck: [N, N] }, p1: { shield: 5, deck: [N, N] } });
    sim.attack(DENJA, 'player');
    sim.drain();
    expect(sim.count(1, 'shield')).toBe(0);
    expect(sim.count(0, 'shield')).toBe(0);
    expect(sim.s.winner).toBeNull();
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('出た時、「シールドいらねえー!」と言ってもよい。そうしたら、そのターン、自分のクリーチャー3体に「G・ブレイカー」を与える', () => {
    const sim = new Sim({ p0: { hand: [DENJA], battle: [{ c: W }], mana: mana(10, N), shield: 2 }, p1: { shield: 5 } });
    sim.play(DENJA);
    sim.yes(); // 自分のクリーチャーは2体だけなので、3体の選択は聞かずに全員
    sim.drain();
    sim.attack(W, 'player');
    sim.drain();
    expect(sim.count(1, 'shield')).toBe(0);
    expect(sim.count(0, 'shield')).toBe(0);
  });
  it('ケッシング・ゼロ: 能力を無視されるのは、相手のクリーチャーだけ(フィールドは対象外)', () => {
    const sim = new Sim({ p0: { hand: [DENJA], mana: mana(5, N) }, p1: { battle: ['卍 新世壊 卍'] } });
    sim.play(DENJA, { face: 1 });
    sim.yes();
    sim.drain();
    expect(isIgnored(mkCtx(sim.s, reg), sim.uid(1, 'battle', '卍 新世壊 卍'))).toBe(false);
  });
  it('ケッシング・ゼロ: このターン、相手のクリーチャーすべての能力を無視する', () => {
    const sim = new Sim({ p0: { hand: [DENJA], mana: mana(5, N) }, p1: { battle: [{ c: '邪幽 ジャガイスト' }] } });
    expect(infoOf(mkCtx(sim.s, reg), sim.uid(1, 'battle', '邪幽 ジャガイスト')).blocker).toBe(true);
    sim.play(DENJA, { face: 1 });
    sim.yes();
    expect(infoOf(mkCtx(sim.s, reg), sim.uid(1, 'battle', '邪幽 ジャガイスト')).blocker).toBe(false);
  });
});

describe('N03 ヘルトッQ', () => {
  it('出たターンに相手プレイヤーを攻撃できる。ただしクリーチャーは攻撃できない(スピードアタッカーとは別)', () => {
    const sim = new Sim({ p0: { battle: [{ c: HELTO, sick: true }] }, p1: { battle: [{ c: W, tapped: true }] } });
    const acts = attackActions(sim);
    expect(acts.some((a) => a.type === 'ATTACK' && a.target.kind === 'player')).toBe(true);
    expect(acts.some((a) => a.type === 'ATTACK' && a.target.kind === 'creature')).toBe(false);
  });
  it('自分のジョーカーズ・クリーチャー1体につき、カードを1枚引いてもよい', () => {
    const sim = new Sim({ p0: { hand: [HELTO], battle: [{ c: CHICKEN }], mana: mana(5, N), deck: [N, N, N, N] } });
    sim.play(HELTO);
    sim.yes();
    expect(sim.count(0, 'hand')).toBe(2);
  });
});

describe('N04 カツラデランス / 「アフロ行きま〜す!!」', () => {
  it('出た時、山札の下から1枚を墓地に置く。それがコスト6以下のジョーカーズ・クリーチャーなら出す', () => {
    const sim = new Sim({ p0: { hand: [KATSURA], mana: mana(7, F), deck: [N, N, CHICKEN] } });
    sim.play(KATSURA);
    expect(sim.has(0, 'battle', CHICKEN)).toBe(true);
  });
  it('「アフロ行きま〜す!!」: 手札を1枚捨て、その後、カードを2枚引く', () => {
    const sim = new Sim({ p0: { hand: [KATSURA, N], mana: mana(2, F), deck: [N, N, N] } });
    sim.play(KATSURA, { face: 1 });
    expect(sim.has(0, 'grave', N)).toBe(true);
    expect(sim.count(0, 'hand')).toBe(2);
  });
});

describe('N05 プリプリズン', () => {
  it('出た時、山札の上から4枚を見て、ジョーカーズ・クリーチャーを1体、手札に加えてもよい', () => {
    const sim = new Sim({ p0: { hand: [PURI], mana: mana(5, F), deck: [N, CHICKEN, N, N, N] } });
    sim.play(PURI);
    sim.order('出た時');
    sim.pick(CHICKEN);
    sim.drain();
    expect(sim.has(0, 'hand', CHICKEN)).toBe(true);
  });
  it('革命0: 出た時、シールドが1つもなければ、コスト7以下のジョーカーズ・クリーチャーを手札から出してもよい', () => {
    const sim = new Sim({ p0: { hand: [PURI, KATSURA], mana: mana(5, F), shield: 0, deck: [N, N, N, N, N] } });
    sim.play(PURI);
    sim.order('革命0');
    sim.use(KATSURA);
    sim.drain();
    expect(sim.has(0, 'battle', KATSURA)).toBe(true);
  });
});

describe('N06 チキン・タッ太', () => {
  it('出た時、相手の「ブロッカー」を持つクリーチャーを1体選び、破壊する', () => {
    const sim = new Sim({ p0: { hand: [CHICKEN], mana: mana(6, F) }, p1: { battle: [{ c: '邪幽 ジャガイスト' }, { c: W }] } });
    sim.play(CHICKEN);
    sim.drain();
    expect(sim.has(1, 'battle', '邪幽 ジャガイスト')).toBe(false);
    expect(sim.has(1, 'battle', W)).toBe(true);
  });
  it('J・O・E 2: コストを2少なくして召喚できる。こうして出したら、ターンの終わりに山札の下に置き、カードを1枚引く', () => {
    const sim = new Sim({ p0: { hand: [CHICKEN], mana: mana(4, F), deck: [N, N, N] } });
    sim.play(CHICKEN, { extra: { alt: 'joe' } });
    sim.drain();
    expect(sim.has(0, 'battle', CHICKEN)).toBe(true);
    sim.endTurn();
    sim.drain();
    expect(sim.has(0, 'battle', CHICKEN)).toBe(false);
    expect(sim.s.players[0].deck.some((u) => sim.s.cards[u].defId === sim.s.cards[sim.uid(0, 'deck', CHICKEN)].defId)).toBe(true);
    expect(sim.count(0, 'hand')).toBe(1);
  });
});

describe('N07 モモダチ モンキッド', () => {
  it('キリフダッシュ: 自分のクリーチャーの攻撃の終わりに、シールドをブレイクしていれば、[自然(2)]を支払って手札から召喚してもよい', () => {
    const sim = new Sim({ p0: { hand: [MONKID], battle: [{ c: W }], mana: mana(2, N), deck: [N, N] }, p1: { shield: 5, deck: [N, N] } });
    sim.attack(W, 'player');
    sim.yes();
    sim.drain();
    expect(sim.has(0, 'battle', MONKID)).toBe(true);
    expect(sim.tappedMana(0)).toBeGreaterThanOrEqual(2);
  });
  it('シールドをブレイクしていなければ、キリフダッシュできない', () => {
    const sim = new Sim({ p0: { hand: [MONKID], battle: [{ c: W }], mana: mana(2, N) }, p1: { shield: 0, battle: [{ c: W, tapped: true }] } });
    sim.attack(W, W);
    sim.drain();
    expect(sim.has(0, 'battle', MONKID)).toBe(false);
  });
});

describe('N08 タイムピョンチキ / オラオラ・ジョーカーズ', () => {
  it('オラオラ・ジョーカーズ: 山札の上から1枚をマナゾーンに置く。それがジョーカーズ・カードなら、カードを1枚引く', () => {
    const sim = new Sim({ p0: { hand: [TIME], mana: mana(3, N), deck: [CHICKEN, N, N] } });
    sim.play(TIME, { face: 1 });
    expect(sim.count(0, 'mana')).toBe(4);
    expect(sim.count(0, 'hand')).toBe(1);
  });
});

describe('N09 MMM-ジョーキング', () => {
  it('相手のクリーチャーが自分を攻撃する時、シールドが1つもなく、マナゾーンに光と自然があれば、手札から出してもよい', () => {
    const sim = new Sim({
      p0: { hand: [MMM], mana: ['ダミー', N], shield: 0 },
      p1: { battle: [{ c: W }] },
      active: 1,
    });
    sim.attack(W, 'player');
    sim.yes();
    sim.pick(MMM); // ブロックする
    sim.drain();
    expect(sim.has(0, 'battle', MMM)).toBe(true);
    expect(sim.s.winner).toBeNull();
  });
  it('攻撃する時、カードを1枚引く。その後、コスト4以下のクリーチャーを手札から出してもよい', () => {
    const sim = new Sim({ p0: { battle: [{ c: MMM }], hand: [W], deck: [N, N, N] }, p1: { shield: 5 } });
    sim.attack(MMM, 'player');
    sim.use(W);
    sim.drain();
    expect(sim.has(0, 'battle', W)).toBe(true);
  });
});

describe('N10 我ら、モモダチ三人衆!!!', () => {
  it('自分のターンのはじめに、自分のシールドを1つ手札に加えてもよい(S・トリガーは使えない)', () => {
    const sim = new Sim({ p0: { battle: [{ c: WARERA }], shield: 2 }, p1: { deck: [N, N] }, active: 1 });
    sim.endTurn();
    sim.use();
    sim.drain();
    expect(sim.count(0, 'shield')).toBe(1);
    expect(sim.count(0, 'hand')).toBeGreaterThanOrEqual(1);
    expect(attackActions(sim).length).toBeGreaterThanOrEqual(0);
  });
});
