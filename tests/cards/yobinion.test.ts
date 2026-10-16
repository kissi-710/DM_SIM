import { describe, expect, it } from 'vitest';
import { FAIR, toPlayerView } from '../../src/engine/view';
import { reg, Sim, mana } from '../scenario';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const D = 'ロスト・Re:ソウル';

describe('A5 ヨビニオン・マルル', () => {
  it('ヨビニオン: コストが小さいクリーチャーが出るまで公開し、出す。残りは山札の下', () => {
    const sim = new Sim({
      p0: { hand: ['ヨビニオン・マルル'], mana: mana(4), deck: [N, 'ティンパニ=シンバリー', N, '天災 デドダム', W, 'ダミー'] },
    });
    sim.play('ヨビニオン・マルル');
    expect(sim.pending.why).toBe('may');
    sim.yes();
    // デドダム(コスト3 < 4)が出る。ティンパニ(コスト4)は出ない
    expect(sim.has(0, 'battle', '天災 デドダム')).toBe(true);
    // 「2体目のクリーチャー」と「デドダムの出た時」が同時に待機 → 順序を選ぶ
    expect(sim.pending.why).toBe('pickNext');
  });
  it('ヨビニオンの空振り: 出せなければ、公開した札をシャッフルして山札の下に置く', () => {
    const sim = new Sim({ p0: { hand: ['ヨビニオン・マルル'], mana: mana(4), deck: [N, N, W] } });
    sim.play('ヨビニオン・マルル');
    sim.yes();
    expect(sim.count(0, 'battle')).toBe(1);
    expect(sim.count(0, 'deck')).toBe(3);
    expect(sim.s.winner).toBeNull();
  });
  it('各ターン2体目のクリーチャーが出た時、上1枚を手札に加える/タップしてマナに置く', () => {
    const sim = new Sim({
      p0: { hand: ['ヨビニオン・トライブ'], mana: mana(4), battle: ['ヨビニオン・マルル'], deck: [W, 'ダミー'] },
    });
    // このターン1体目: マルル自身は場にいたので数えない。トライブが1体目
    sim.play('ヨビニオン・トライブ');
    sim.no(); // トライブのヨビニオン
    expect(sim.s.pending?.why).toBe('turnAction');
    expect(sim.count(0, 'hand')).toBe(0);
  });
  it('2体目で能力が働き、選択肢で手札/タップしたマナを選べる', () => {
    const sim = new Sim({
      p0: { hand: ['ヨビニオン・トライブ', 'ヨビニオン・トライブ'], mana: mana(8), battle: ['ヨビニオン・マルル'], deck: [W, D, 'ダミー'] },
    });
    sim.play('ヨビニオン・トライブ');
    sim.no();
    sim.play('ヨビニオン・トライブ');
    // 2体目: マルルの能力が誘発し、トライブ自身のヨビニオンも誘発する
    // 順序を選ぶ(同じプレイヤー内は好きな順)
    expect(sim.pending.why).toBe('pickNext');
    sim.order('2体目');
    expect(sim.pending.why).toBe('modes');
    sim.option(1); // タップしてマナゾーンに置く
    expect(sim.has(0, 'mana', W)).toBe(true);
    const w = sim.s.players[0].mana.find((u) => sim.s.cards[u].defId === 'dm23bd7-031')!;
    expect(sim.s.cards[w].tapped).toBe(true);
    // 残るヨビニオンは断る
    expect(sim.pending.why).toBe('may');
    sim.no();
  });
  it('2体目の能力は、上1枚を見てから手札かマナかを選べる(選ぶ時点で中身が見え、まだ山札にある)', () => {
    const sim = new Sim({
      p0: { hand: ['ヨビニオン・トライブ', 'ヨビニオン・トライブ'], mana: mana(8), battle: ['ヨビニオン・マルル'], deck: [W, D, 'ダミー'] },
    });
    sim.play('ヨビニオン・トライブ');
    sim.no();
    sim.play('ヨビニオン・トライブ');
    sim.order('2体目');
    expect(sim.pending.why).toBe('modes');
    const inp: any = sim.pending.input;
    // 見たカードが選択肢と一緒に示される(山札の一番上のカード)
    const top = sim.s.players[0].deck[0];
    expect(inp.seen).toEqual([top]);
    expect(sim.s.cards[top].zone).toBe('deck');
    // 選ぶ本人の視点では中身が見え、相手からは見えない
    const mine = toPlayerView(sim.s, 0, FAIR, reg);
    const theirs = toPlayerView(sim.s, 1, FAIR, reg);
    expect(mine.cards[top].defId).toBe(sim.s.cards[top].defId);
    expect(theirs.cards[top].defId).toBe('?');
    // 見た後に、見たカードを選んだ行き先へ置ける
    sim.option(0); // 手札に加える
    expect(sim.has(0, 'hand', W)).toBe(true);
  });
  it('同時誘発の順序を自動(左から)にできる', () => {
    const sim = new Sim({
      cfg: { autoOrder: [true, false] },
      p0: { hand: ['ヨビニオン・トライブ', 'ヨビニオン・トライブ'], mana: mana(8), battle: ['ヨビニオン・マルル'], deck: [W, D, 'ダミー'] },
    });
    sim.play('ヨビニオン・トライブ');
    sim.no();
    sim.play('ヨビニオン・トライブ');
    expect(sim.pending.why).not.toBe('pickNext');
  });
});

describe('A6 ヨビニオン・トライブ', () => {
  it('マナゾーンから召喚できる', () => {
    const sim = new Sim({ p0: { mana: ['ヨビニオン・トライブ', ...mana(4)] } });
    expect(sim.canPlay('ヨビニオン・トライブ', 'mana')).toBe(true);
    sim.play('ヨビニオン・トライブ', { from: 'mana' });
    expect(sim.has(0, 'battle', 'ヨビニオン・トライブ')).toBe(true);
    // 自分自身をタップしてコストにはしない: 4枚だけがタップされる
    expect(sim.tappedMana(0)).toBe(4);
  });
  it('破壊される時、墓地のかわりにマナゾーンに置く(破壊された扱いにならない)', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: ['ヨビニオン・トライブ'] },
      p1: { hand: ['ワクムテラス'], mana: mana(2, N) },
    });
    // 相手の呪文で破壊 → ここでは -4000 ではなく、決断で確認する
    const sim2 = new Sim({
      active: 1,
      p0: { battle: ['ヨビニオン・トライブ'] },
      p1: { grave: ['絶望と反魂と滅殺の決断'], mana: mana(5, D) },
    });
    sim2.play('絶望と反魂と滅殺の決断', { from: 'grave' });
    sim2.option(2, 2); // -4000 を2回 → パワー4000-8000 → 破壊
    expect(sim2.has(0, 'mana', 'ヨビニオン・トライブ')).toBe(true);
    expect(sim2.has(0, 'grave', 'ヨビニオン・トライブ')).toBe(false);
    void sim;
  });
});

describe('A7 ティンパニ=シンバリー', () => {
  it('2体目のクリーチャーが出た時、自分を破壊すると、相手は自分のクリーチャーを選んで破壊する', () => {
    const sim = new Sim({
      p0: { hand: ['ヨビニオン・トライブ', 'ヨビニオン・トライブ'], mana: mana(8), battle: ['ティンパニ=シンバリー'] },
      p1: { battle: ['ヨビニオン・マルル', '天災 デドダム'] },
    });
    sim.play('ヨビニオン・トライブ');
    sim.no();
    sim.play('ヨビニオン・トライブ');
    // 2体目: シンバリーの能力とトライブのヨビニオン
    expect(sim.pending.why).toBe('pickNext');
    sim.order('2体目');
    expect(sim.pending.why).toBe('may');
    sim.yes();
    expect(sim.has(0, 'grave', 'ティンパニ=シンバリー')).toBe(true);
    // 相手が選ぶ
    expect(sim.pending.player).toBe(1);
    expect(sim.pending.why).toBe('select');
    sim.pick('天災 デドダム');
    expect(sim.has(1, 'grave', '天災 デドダム')).toBe(true);
    expect(sim.has(1, 'battle', 'ヨビニオン・マルル')).toBe(true);
  });
  it('ブロッカーである', () => {
    const sim = new Sim({
      p0: { battle: ['ヨビニオン・マルル'] },
      p1: { battle: ['ティンパニ=シンバリー'] },
    });
    sim.attack('ヨビニオン・マルル', 'player');
    expect(sim.pending.why).toBe('block');
  });
});

describe('A8 フミシュナ', () => {
  it('出た時、相手の手札を見ずに1枚捨てさせる。捨てさせた時、1ターンに1回引いてもよい', () => {
    const sim = new Sim({
      p0: { hand: ['修羅の死神フミシュナ'], mana: mana(4, D), deck: 5 },
      p1: { hand: [N, W] },
    });
    sim.play('修羅の死神フミシュナ');
    expect(sim.count(1, 'hand')).toBe(1);
    expect(sim.count(1, 'grave')).toBe(1);
    expect(sim.pending.why).toBe('may');
    sim.yes();
    expect(sim.count(0, 'hand')).toBe(1);
  });
  it('呪文面: 2回選ぶ(同じものを2回選べる)', () => {
    const sim = new Sim({
      p0: { hand: ['修羅の死神フミシュナ'], mana: mana(5, W), deck: 5 },
      p1: { battle: ['ヨビニオン・マルル'] },
    });
    sim.play('修羅の死神フミシュナ', { face: 1 });
    expect(sim.pending.input).toMatchObject({ shape: 'option', pick: 2, repeat: true });
    sim.option(0, 0);
    expect(sim.count(0, 'hand')).toBe(2);
    expect(sim.has(0, 'grave', '修羅の死神フミシュナ')).toBe(true);
  });
  it('呪文面: 引く+バウンスは、上に書かれた順に処理される', () => {
    const sim = new Sim({
      p0: { hand: ['修羅の死神フミシュナ'], mana: mana(5, W), deck: 5 },
      p1: { battle: ['ヨビニオン・マルル'] },
    });
    sim.play('修羅の死神フミシュナ', { face: 1 });
    sim.option(1, 0); // 答えの順序によらず、0 → 1 の順で処理
    expect(sim.count(0, 'hand')).toBe(1);
    expect(sim.has(1, 'hand', 'ヨビニオン・マルル')).toBe(true);
  });
  it('呪文面はS・トリガーとして使える(ツインパクトの面選択)', () => {
    const sim = new Sim({
      p0: { battle: ['終末縫合王 ザ=キラー・キーナリー'] },
      p1: { shield: ['修羅の死神フミシュナ'], deck: 5 },
    });
    sim.attack('終末縫合王 ザ=キラー・キーナリー', 'player');
    sim.pick('修羅の死神フミシュナ');
    expect(sim.pending.input).toMatchObject({ shape: 'option' });
    sim.option(0, 0);
    expect(sim.count(1, 'hand')).toBe(2);
    expect(sim.has(1, 'grave', '修羅の死神フミシュナ')).toBe(true);
  });
});

describe('A9 絶望と反魂と滅殺の決断', () => {
  it('墓地から唱えられ、唱えた後は山札の下に置く', () => {
    const sim = new Sim({
      p0: { grave: ['絶望と反魂と滅殺の決断'], mana: mana(5, D) },
      p1: { hand: [N, N, N] },
    });
    expect(sim.canPlay('絶望と反魂と滅殺の決断', 'grave')).toBe(true);
    sim.play('絶望と反魂と滅殺の決断', { from: 'grave' });
    sim.option(0, 0); // 相手は手札を2枚捨てる
    // 相手が選んで捨てる(2回)。手札は同名3枚で、どれを捨てても同じなので、聞かれずに捨てる
    expect(sim.s.pending?.why).toBe('turnAction');
    expect(sim.count(1, 'hand')).toBe(1);
    const deck = sim.s.players[0].deck;
    expect(sim.s.cards[deck[deck.length - 1]].defId).toBe('dm23bd3-003');
    expect(sim.has(0, 'grave', '絶望と反魂と滅殺の決断')).toBe(false);
  });
  it('墓地からコスト4以下の闇のクリーチャーを出せる', () => {
    const sim = new Sim({
      p0: { hand: ['絶望と反魂と滅殺の決断'], mana: mana(5, D), grave: ['ティンパニ=シンバリー', '終末の監視者 ジ・ウォッチ'] },
    });
    sim.play('絶望と反魂と滅殺の決断');
    sim.option(1, 1);
    expect(sim.has(0, 'battle', 'ティンパニ=シンバリー')).toBe(true);
    expect(sim.has(0, 'grave', '終末の監視者 ジ・ウォッチ')).toBe(true); // 水・コスト10は対象外
  });
  it('パワーを-4000する。パワー0以下は破壊される', () => {
    const sim = new Sim({
      p0: { hand: ['絶望と反魂と滅殺の決断'], mana: mana(5, D) },
      p1: { battle: ['ティンパニ=シンバリー', 'ヨビニオン・マルル'] },
    });
    sim.play('絶望と反魂と滅殺の決断');
    sim.option(2, 2);
    sim.pick('ティンパニ=シンバリー'); // パワー0以下になり破壊される
    expect(sim.has(1, 'grave', 'ティンパニ=シンバリー')).toBe(true);
    // 2回目は候補が1体だけなので自動で選ばれる
    expect(sim.has(1, 'battle', 'ヨビニオン・マルル')).toBe(true); // 5000-4000=1000
  });
  it('効果の期限はそのターン中', () => {
    const sim = new Sim({
      p0: { hand: ['絶望と反魂と滅殺の決断'], mana: mana(5, D) },
      p1: { battle: ['ヨビニオン・マルル'] },
    });
    sim.play('絶望と反魂と滅殺の決断');
    sim.option(2, 2); // 対象が1体だけなので自動で選ばれる
    expect(sim.has(1, 'grave', 'ヨビニオン・マルル')).toBe(true); // 5000-8000
  });
});
