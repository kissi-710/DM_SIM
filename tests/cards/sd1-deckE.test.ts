// デッキE「呪文連打でコンボを目指せゴスペルデッキ」の新規カード(docs/decks-25oudou.md)のシナリオテスト。
import { describe, expect, it } from 'vitest';
import { costOf } from '../../src/engine/derive';
import { mkCtx } from '../../src/engine/state';
import { Sim, mana, reg } from '../scenario';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const D = 'ロスト・Re:ソウル';
const L = 'ドラゴンズ・サイン';
const F = 'ドンドン火噴くナウ'; // 水火自然

describe('E01 オリオティス・ジャッジ', () => {
  it('各プレイヤーは、自身のマナの枚数以上のコストのクリーチャーをすべて、山札の下に置く', () => {
    const sim = new Sim({
      p0: { hand: ['オリオティス・ジャッジ'], mana: [L, L, L, N, N], battle: [{ c: W }, { c: '流星のガイアッシュ・カイザー' }, { c: '天災 デドダム' }] },
      p1: { mana: mana(4), battle: [{ c: W }, { c: '天災 デドダム' }] },
    });
    sim.play('オリオティス・ジャッジ');
    // 自分: マナ5(使用後の3枚タップを含め5枚): コスト5以上 = ガイアッシュ(6)。相手: マナ4: コスト4以上 = アクアン(4)
    expect(sim.has(0, 'battle', '流星のガイアッシュ・カイザー')).toBe(false);
    expect(sim.has(0, 'battle', '天災 デドダム')).toBe(true);
    expect(sim.has(1, 'battle', W)).toBe(false);
    expect(sim.has(1, 'battle', '天災 デドダム')).toBe(true);
  });
});

describe('E02 ファイナル・ストップ / E03 セイレーン・コンチェルト', () => {
  it('ファイナル・ストップ: 相手は次の自分のターンの終わりまで呪文を唱えられず、1枚引く', () => {
    const sim = new Sim({ p0: { hand: ['ファイナル・ストップ'], mana: [L, W, L, W], deck: [N, N] }, p1: { hand: [D], mana: mana(9, D) } });
    sim.play('ファイナル・ストップ');
    expect(sim.count(0, 'hand')).toBe(1);
    sim.endMain();
    sim.endTurn();
    sim.skipMana();
    expect(sim.canPlay(D)).toBe(false);
  });
  it('セイレーン・コンチェルト: マナ1枚を手札に戻し、その後、手札1枚をマナゾーンに置く', () => {
    const sim = new Sim({ p0: { hand: ['セイレーン・コンチェルト', D], mana: [W, N] } });
    sim.play('セイレーン・コンチェルト');
    sim.pick(N);
    sim.pick(D);
    expect(sim.has(0, 'mana', D)).toBe(true);
    expect(sim.has(0, 'hand', N)).toBe(true);
  });
});

describe('E04 キリモミ・ヤマアラシ', () => {
  it('このターン、次に召喚する自分のクリーチャーのコストを1少なくし、スピードアタッカーを与える', () => {
    const sim = new Sim({ p0: { hand: ['キリモミ・ヤマアラシ', 'アクアン'], mana: [F, W, W, W] } });
    sim.play('キリモミ・ヤマアラシ');
    sim.play('アクアン'); // コスト4 → 3(マナは 3 枚タップ)
    expect(sim.tappedMana(0)).toBe(1 + 3);
    sim.drain();
    // 出たターンに攻撃できる
    sim.attack('アクアン', 'player');
    expect(sim.evs('shieldBroken').length).toBe(1);
  });
  it('効果は次の1体の召喚で使い切る', () => {
    const sim = new Sim({ p0: { hand: ['キリモミ・ヤマアラシ', 'アクアン', 'アクアン'], mana: [F, W, W, W, W, W, W, W] } });
    sim.play('キリモミ・ヤマアラシ');
    sim.play('アクアン');
    sim.drain();
    sim.play('アクアン');
    sim.drain();
    expect(sim.tappedMana(0)).toBe(1 + 3 + 4);
  });
});

describe('E05 最期の竜炎 / E06 勇愛の天秤 / E07 バーニング・フィンガー', () => {
  it('最期の竜炎: 手札を1枚捨て、そのカード以下のコストの相手のエレメントを破壊する', () => {
    const sim = new Sim({ p0: { hand: ['最期の竜炎', W], mana: [F] }, p1: { battle: [{ c: W }, { c: '流星のガイアッシュ・カイザー' }] } });
    sim.play('最期の竜炎');
    // 捨てるのはアクアン(コスト4)の1枚だけ、破壊できるのも相手のアクアン(コスト4以下)だけなので、聞かれない
    expect(sim.has(1, 'battle', W)).toBe(false);
    expect(sim.has(1, 'battle', '流星のガイアッシュ・カイザー')).toBe(true);
  });
  it('勇愛の天秤: 選択肢から、相手のパワー2000以下のクリーチャーの破壊を選べる', () => {
    const sim = new Sim({ p0: { hand: ['勇愛の天秤'], mana: [F, F] }, p1: { battle: [{ c: W }, { c: '終末の監視者 ジ・ウォッチ' }] } });
    sim.play('勇愛の天秤');
    sim.option(1);
    expect(sim.has(1, 'battle', W)).toBe(false);
    expect(sim.has(1, 'battle', '終末の監視者 ジ・ウォッチ')).toBe(true);
  });
  it('バーニング・フィンガー: 手札を1枚捨てて2枚引く。S・トリガーで、そのターンに2つ以上ブレイクされていれば相手のエレメントを破壊する', () => {
    const sim = new Sim({
      p0: { shield: ['バーニング・フィンガー', 'ダミー', 'ダミー'], hand: [N], deck: [N, N, N, N] },
      p1: { battle: [{ c: '流星のガイアッシュ・カイザー' }, { c: W }] },
      active: 1,
    });
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, '流星のガイアッシュ・カイザー'), target: { kind: 'player' } });
    sim.pick('バーニング・フィンガー');
    sim.pick(N); // 捨てる
    sim.pick(W); // P: コスト6以下のエレメントを破壊
    expect(sim.has(1, 'battle', W)).toBe(false);
  });
  it('バーニング・フィンガー: 自分のターンに普通に唱えても、P能力は働かない', () => {
    const sim = new Sim({ p0: { hand: ['バーニング・フィンガー', N], mana: [F, F], deck: [N, N, N] }, p1: { battle: [{ c: W }] } });
    sim.play('バーニング・フィンガー'); // 捨てるのは手札の1枚だけ(聞かれない)
    expect(sim.has(1, 'battle', W)).toBe(true);
  });
});

describe('E08 水晶の王 ゴスペル', () => {
  it('召喚コストを、自分の墓地の呪文1枚につき1少なくする(2以下にはならない)', () => {
    const sim = new Sim({ p0: { hand: ['水晶の王 ゴスペル'], mana: [L, W, L, W, L, W, L, W, L], grave: [N, N, N] } });
    expect(sim.canPlay('水晶の王 ゴスペル')).toBe(true); // コスト 9 - 3 = 6 で足りる
    const sim2 = new Sim({ p0: { hand: ['水晶の王 ゴスペル'], mana: [L, W, L, W, L], grave: [N, N] } });
    expect(sim2.canPlay('水晶の王 ゴスペル')).toBe(false); // 9 - 2 = 7 > 5
    const sim3 = new Sim({ p0: { hand: ['水晶の王 ゴスペル'], mana: [L, W], grave: Array.from({ length: 12 }, () => N) } });
    expect(sim3.canPlay('水晶の王 ゴスペル')).toBe(true); // 最低2
  });
  it('出た時、呪文を好きな数、墓地から手札に戻す。攻撃する時、手札の呪文を無料で唱えてもよい', () => {
    const sim = new Sim({ p0: { hand: ['水晶の王 ゴスペル'], mana: [L, W, N, N, N], grave: [N, N, N, D], deck: [N, N, N] } });
    sim.play('水晶の王 ゴスペル');
    sim.pick(N, N, N, D);
    expect(sim.count(0, 'hand')).toBe(4);
    expect(sim.count(0, 'grave')).toBe(0);
  });
  it('攻撃する時に呪文を唱える', () => {
    const sim = new Sim({ p0: { battle: [{ c: '水晶の王 ゴスペル' }], hand: [N], mana: mana(2), deck: [N, N, N] } });
    sim.attack('水晶の王 ゴスペル', 'player');
    sim.pick(N);
    expect(sim.count(0, 'mana')).toBe(3);
  });
});

describe('E09 氷柱と炎弧の決断 / E10 T・T・T', () => {
  it('墓地に呪文が2枚以上あれば、シールドゾーンからS・トリガーで使える', () => {
    const sim = new Sim({
      p0: { shield: ['氷柱と炎弧の決断'], grave: [N, N] },
      p1: { battle: [{ c: W }] },
      active: 1,
    });
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, W), target: { kind: 'player' } });
    expect(sim.pending.why).toBe('triggerDeclare');
  });
  it('墓地に呪文が1枚だけなら、S・トリガーにならない', () => {
    const sim = new Sim({
      p0: { shield: ['氷柱と炎弧の決断'], grave: [N] },
      p1: { battle: [{ c: W }] },
      active: 1,
    });
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, W), target: { kind: 'player' } });
    expect(sim.s.pending?.why).not.toBe('triggerDeclare');
  });
  it('決断: 同じものを2回選べる(手札を捨てて2枚引くを2回)', () => {
    const sim = new Sim({ p0: { hand: ['氷柱と炎弧の決断', N, N], mana: [F, F, F], deck: [N, N, N, N, N, N] } });
    sim.play('氷柱と炎弧の決断');
    sim.option(1, 1);
    sim.pick(N);
    sim.pick(N);
    expect(sim.count(0, 'hand')).toBe(4); // 2枚捨てて4枚引いた(元から1枚残る)
  });
  it('T・T・T: 相手のクリーチャーを3体まで選んでタップする', () => {
    const sim = new Sim({ p0: { hand: ['T・T・T'], mana: [L, W, F] }, p1: { battle: [{ c: W }, { c: W }, { c: W }, { c: W }] } });
    sim.play('T・T・T');
    sim.option(0);
    sim.pick(W, W, W);
    expect(sim.s.players[1].battle.filter((p) => p.tapped).length).toBe(3);
  });
  it('T・T・T: コスト3少なく召喚し、スピードアタッカーを与える', () => {
    const sim = new Sim({ p0: { hand: ['T・T・T', '流星のガイアッシュ・カイザー'], mana: [L, W, F, W, N, N, N] } });
    sim.play('T・T・T');
    sim.option(2);
    sim.play('流星のガイアッシュ・カイザー'); // コスト6 → 3
    expect(sim.tappedMana(0)).toBe(3 + 3);
  });
});

describe('次に召喚するクリーチャーのコスト軽減は、0以下にならない', () => {
  it('T・T・T: コスト3のクリーチャーは、3少なくしても1(0にはならない)', () => {
    const sim = new Sim({ p0: { hand: ['T・T・T', '天災 デドダム'], mana: [L, W, F, W, N, N, N] } });
    sim.play('T・T・T');
    sim.option(2);
    expect(costOf(mkCtx(sim.s, reg), sim.uid(0, 'hand', '天災 デドダム'), 0)).toBe(1);
  });
  it('キリモミ・ヤマアラシ: コスト3のクリーチャーは2', () => {
    const sim = new Sim({ p0: { hand: ['キリモミ・ヤマアラシ', '天災 デドダム'], mana: [F, W, W, W] } });
    sim.play('キリモミ・ヤマアラシ');
    expect(costOf(mkCtx(sim.s, reg), sim.uid(0, 'hand', '天災 デドダム'), 0)).toBe(2);
  });
});

describe('E11 エンドレス・フローズン・カーニバル', () => {
  const marulu = Array.from({ length: 5 }, () => 'ヨビニオン・マルル');
  it('マナを払うかわりに、手札のスノーフェアリーを5体捨てて唱えられる', () => {
    const sim = new Sim({ p0: { hand: ['エンドレス・フローズン・カーニバル', ...marulu], mana: [] }, p1: { battle: [{ c: W }, { c: W }], mana: mana(3) } });
    // マナがないので、通常は唱えられない。別のコストなら唱えられる
    const alt = sim.legal().filter((a) => a.type === 'PLAY_CARD' && sim.s.cards[a.uid].defId === 'dm26sd1-E11');
    expect(alt.length).toBe(1);
    sim.play('エンドレス・フローズン・カーニバル', { extra: { alt: 'snow5' } });
    expect(sim.count(0, 'hand')).toBe(0);
    expect(sim.count(0, 'grave')).toBe(6);
    // 相手のクリーチャーとマナをすべてタップし、次の相手のターンのはじめにアンタップしない
    expect(sim.s.players[1].battle.every((p) => p.tapped)).toBe(true);
    expect(sim.tappedMana(1)).toBe(3);
    sim.endMain();
    sim.endTurn();
    expect(sim.s.active).toBe(1);
    expect(sim.s.players[1].battle.every((p) => p.tapped)).toBe(true);
    expect(sim.tappedMana(1)).toBe(3);
  });
  it('スノーフェアリーが5体なければ、別のコストは使えない', () => {
    const sim = new Sim({ p0: { hand: ['エンドレス・フローズン・カーニバル', ...marulu.slice(0, 4)], mana: [] } });
    expect(sim.legal().some((a) => a.type === 'PLAY_CARD' && a.extra?.alt === 'snow5')).toBe(false);
  });
  it('バトルゾーンの相手の、クリーチャーではないカードをすべて破壊する', () => {
    const sim = new Sim({ p0: { hand: ['エンドレス・フローズン・カーニバル', ...marulu] }, p1: { battle: [{ c: '卍 新世壊 卍' }, { c: W }] } });
    sim.play('エンドレス・フローズン・カーニバル', { extra: { alt: 'snow5' } });
    expect(sim.has(1, 'battle', '卍 新世壊 卍')).toBe(false);
    expect(sim.has(1, 'battle', W)).toBe(true);
  });
});
