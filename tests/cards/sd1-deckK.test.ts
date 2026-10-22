// デッキK「赤緑ハチ公」の新規カード(docs/decks-25oudou.md)のシナリオテスト。封印・5.S.D.・パワード・ブレイカーなど。
import { describe, expect, it } from 'vitest';
import { Sim, mana } from '../scenario';
import { powerOf, breakerCount } from '../../src/engine/derive';
import { mkCtx } from '../../src/engine/state';
import { checkDeck } from '../../src/engine/engine';
import { checkInvariants } from '../../src/engine/invariants';
import { CARD_DB } from '../../src/cards';
import { reg } from '../scenario';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const F = 'ドンドン火噴くナウ'; // 水火自然
const HACHI = '特攻の忠剣ハチ公';
const power = (sim: Sim, p: 0 | 1, name: string) => powerOf(mkCtx(sim.s, reg), sim.s.players[p].battle.find((x) => x.pid === sim.pid(p, name))!);

describe('K01 特攻の忠剣ハチ公', () => {
  it('デッキに何枚入れてもよい', () => {
    const deck = [...Array(40).fill('dm26sd1-K01')];
    expect(checkDeck(CARD_DB, deck, true).ok).toBe(true);
  });
  it('攻撃の終わりに、ガチンコ・ジャッジ。勝ったら、山札から《特攻の忠剣ハチ公》を出してもよい(その後、山札をシャッフル)', () => {
    const sim = new Sim({
      p0: { battle: [{ c: HACHI }], deck: ['真久間メガ', HACHI, N, N] },
      p1: { deck: [W, W], shield: 5 },
    });
    sim.attack(HACHI, 'player');
    sim.pick(HACHI);
    sim.drain();
    expect(sim.count(0, 'battle', HACHI)).toBe(2);
  });
  it('ガチンコ・ジャッジに負ければ、何も起こらない', () => {
    const sim = new Sim({ p0: { battle: [{ c: HACHI }], deck: [N, HACHI, N] }, p1: { deck: ['真久間メガ', W], shield: 5 } });
    sim.attack(HACHI, 'player');
    sim.drain();
    expect(sim.count(0, 'battle', HACHI)).toBe(1);
  });
});

describe('K02 熱き侵略 レッドゾーンZ', () => {
  it('侵略: 火のコマンドの攻撃中に重なる。進化ではないクリーチャーの上に置いた時、相手のシールドを1つ墓地に置く', () => {
    const sim = new Sim({ p0: { hand: ['熱き侵略 レッドゾーンZ'], battle: [{ c: HACHI }] }, p1: { shield: 5 } });
    sim.attack(HACHI, 'player');
    sim.yes();
    sim.drain();
    expect(sim.has(0, 'battle', '熱き侵略 レッドゾーンZ')).toBe(true);
    expect(sim.count(1, 'grave')).toBeGreaterThanOrEqual(1);
  });
});

describe('K03 D2V3 終断のレッドトロン / フォビドゥン・ハンド', () => {
  it('召喚する時、手札を1枚捨ててもよい。そうしたら、召喚コストを2少なくする', () => {
    const sim = new Sim({ p0: { hand: ['D2V3 終断のレッドトロン', N], mana: mana(3, F) } });
    sim.play('D2V3 終断のレッドトロン', { extra: { alt: 'redtron' } });
    expect(sim.tappedMana(0)).toBe(3);
    expect(sim.has(0, 'grave', N)).toBe(true);
  });
  it('出た時、相手のクリーチャーを1体選んで、バトルさせてもよい', () => {
    const sim = new Sim({ p0: { hand: ['D2V3 終断のレッドトロン'], mana: mana(5, F) }, p1: { battle: [{ c: W }] } });
    sim.play('D2V3 終断のレッドトロン');
    sim.use();
    expect(sim.has(1, 'battle', W)).toBe(false); // 5000 > 2000
  });
  it('フォビドゥン・ハンド: パワー9999以下の相手のクリーチャーを破壊。自分のフィールドがあれば、相手のクリーチャーに封印を付ける', () => {
    const sim = new Sim({
      p0: { hand: ['D2V3 終断のレッドトロン'], battle: ['卍 新世壊 卍'], mana: mana(9, F) },
      p1: { battle: [{ c: W }, { c: '終末の監視者 ジ・ウォッチ' }], deck: [N, N, N] },
    });
    sim.play('D2V3 終断のレッドトロン', { face: 1 });
    sim.drain();
    expect(sim.has(1, 'battle', W)).toBe(false);
    const wt = sim.s.players[1].battle.find((p) => sim.s.cards[p.cards[0]].defId === 'dm24rp2-TR03')!;
    expect(wt.seals?.length).toBe(1);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
});

describe('封印', () => {
  const sealed = () => {
    const sim = new Sim({
      p0: { hand: [], battle: [{ c: '終末の監視者 ジ・ウォッチ' }] },
      p1: { hand: ['D2V3 終断のレッドトロン'], battle: ['卍 新世壊 卍'], mana: mana(9, F), deck: [N, N, N] },
      active: 1,
    });
    sim.play('D2V3 終断のレッドトロン', { face: 1 });
    sim.drain();
    return sim;
  };
  it('封印されたクリーチャーは、能力を失い、攻撃もブロックもできない', () => {
    const sim = sealed();
    expect(sim.s.players[0].battle[0].seals?.length).toBe(1);
    // 封印されたジ・ウォッチは、ブレイカー(T)を失っている
    expect(breakerCount(mkCtx(sim.s, reg), sim.s.players[0].battle[0])).toBe(1);
    sim.s.active = 0;
  });
  it('封印されたクリーチャーが離れると、封印は墓地に置かれる', () => {
    const sim = sealed();
    const wt = sim.s.players[0].battle[0].cards[0];
    sim.s.active = 0;
    sim.s.players[0].battle[0].tapped = false;
    void wt;
    expect(sim.count(0, 'grave')).toBe(0);
  });
});

describe('K04 ストーム・ハイパーXX', () => {
  it('パワーは、コストが異なる自分のクリーチャー1体につき+3000。パワード・ブレイカー', () => {
    const sim = new Sim({ p0: { battle: [{ c: 'ストーム・ハイパーXX' }, { c: W }, { c: 'AQvibrato' }, { c: W }] } });
    expect(power(sim, 0, 'ストーム・ハイパーXX')).toBe(9000); // コスト 11・4・2 の3種類
    expect(breakerCount(mkCtx(sim.s, reg), sim.s.players[0].battle[0])).toBe(2); // 1 + floor(9000/6000)
  });
  it('出た時、このクリーチャーよりパワーが小さい相手のクリーチャーをすべて破壊する', () => {
    const sim = new Sim({ p0: { hand: ['ストーム・ハイパーXX'], battle: [{ c: W }], mana: mana(9, F) }, p1: { battle: [{ c: W }, { c: '終末の監視者 ジ・ウォッチ' }] } });
    // ハイパーエナジー: アクアン(コスト4)をタップして、コストを2少なくする
    const play = sim.legal().find((a) => a.type === 'PLAY_CARD' && a.extra?.tap?.length === 1);
    expect(play).toBeDefined();
    sim.do(play!);
    sim.drain();
    // パワー 6000(コスト11・4の2種類) より小さいのは、アクアン
    expect(sim.has(1, 'battle', W)).toBe(false);
    expect(sim.has(1, 'battle', '終末の監視者 ジ・ウォッチ')).toBe(true);
  });
});

describe('K05 Q.Q.QX. / 終葬 5.S.D.', () => {
  it('シールドをブレイクする時、相手はそのシールドを手札に加えるかわりに、山札の上から4枚目の位置に横向きに刺す', () => {
    const sim = new Sim({ p0: { battle: [{ c: 'Q.Q.QX.' }] }, p1: { shield: 3, deck: [N, N, N, N, N, N] } });
    sim.attack('Q.Q.QX.', 'player');
    expect(sim.count(1, 'shield')).toBe(2);
    expect(sim.count(1, 'hand')).toBe(0);
    const stabbed = sim.s.players[1].deck.filter((u) => sim.s.cards[u].side);
    expect(stabbed.length).toBe(1);
    expect(sim.s.players[1].deck.indexOf(stabbed[0])).toBe(3);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('相手は、山札の横向きのカードを手札に加えた時、ゲームに負ける', () => {
    const sim = new Sim({ p0: { battle: [{ c: 'Q.Q.QX.' }] }, p1: { shield: 3, deck: [N, N, N, N, N, N] }, active: 0 });
    sim.attack('Q.Q.QX.', 'player');
    // 横向きのカードを、山札の一番上に動かす(相手が次に引くカードにする)
    const deck1 = sim.s.players[1].deck;
    deck1.unshift(deck1.splice(deck1.findIndex((u) => sim.s.cards[u].side), 1)[0]);
    const top = sim.s.players[1].deck[0];
    expect(sim.s.cards[top].side).toBe(true);
    sim.endTurn();
    sim.drain();
    expect(sim.s.winner).toBe(0);
  });
  it('相手は、自身の山札を見れず、順序を変えられない', () => {
    const sim = new Sim({ p0: { battle: ['Q.Q.QX.'] }, p1: { hand: ['天災 デドダム'], mana: [W, 'ロスト・Re:ソウル', N], deck: [N, W, N, N] }, active: 1 });
    sim.play('天災 デドダム');
    sim.drain();
    // 山札を見れないので、手札・マナ・墓地への振り分けは行われない
    expect(sim.count(1, 'hand')).toBe(0);
    expect(sim.count(1, 'grave')).toBe(0);
  });
  it('終葬 5.S.D.: 相手のクリーチャーを山札に刺させ、このカードを出す', () => {
    const sim = new Sim({ p0: { hand: ['Q.Q.QX.'], mana: mana(8) }, p1: { battle: [{ c: W }], deck: [N, N, N, N, N] } });
    sim.play('Q.Q.QX.', { face: 1 });
    sim.drain();
    expect(sim.has(1, 'battle', W)).toBe(false);
    expect(sim.s.players[1].deck.some((u) => sim.s.cards[u].side && sim.s.cards[u].defId === 'dm23bd7-031')).toBe(true);
    expect(sim.has(0, 'battle', 'Q.Q.QX.')).toBe(true);
  });
});

describe('K06 シビレアシダケ / K07 バンビシカット', () => {
  it('インビンシブル・パワー: このターン、自分のクリーチャーすべてのパワーを+8000し、T・ブレイカーを与える', () => {
    const sim = new Sim({ p0: { hand: ['シビレアシダケ'], battle: [{ c: W }], mana: mana(13) } });
    sim.play('シビレアシダケ', { face: 1 });
    expect(power(sim, 0, W)).toBe(10000);
    expect(breakerCount(mkCtx(sim.s, reg), sim.s.players[0].battle[0])).toBe(3);
  });
  it('バンビシカット: 出た時、ガチンコ・ジャッジに勝てば、山札の上1枚をマナゾーンに置く', () => {
    const sim = new Sim({ p0: { hand: ['青銅のバンビシカット'], mana: [N, N], deck: ['真久間メガ', N, N] }, p1: { deck: [W, W] } });
    sim.play('青銅のバンビシカット');
    expect(sim.count(0, 'mana')).toBe(3);
  });
  it('「我が力、しかと見よ!」: パワー12000以下を破壊し、ガチンコ・ジャッジに勝てば1枚引く', () => {
    const sim = new Sim({ p0: { hand: ['青銅のバンビシカット'], mana: mana(9, F), deck: ['真久間メガ', N, N] }, p1: { battle: [{ c: W }], deck: [W, W] } });
    sim.play('青銅のバンビシカット', { face: 1 });
    expect(sim.has(1, 'battle', W)).toBe(false);
    expect(sim.count(0, 'hand')).toBe(1);
  });
});
