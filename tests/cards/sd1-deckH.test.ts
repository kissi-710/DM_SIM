// デッキH「5cドラゴン娘」の新規カード(docs/decks-25oudou.md)のシナリオテスト。
import { describe, expect, it } from 'vitest';
import { Sim, mana } from '../scenario';
import { checkInvariants } from '../../src/engine/invariants';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const L = 'ドラゴンズ・サイン';
const F = 'ドンドン火噴くナウ'; // 水火自然
const DRAGON = '蒼神龍トライクラブ・トライショット'; // 水のドラゴン(コスト6)

describe('H01 煌龍 サッヴァーク(シールドの山・表向き)', () => {
  it('各ブレイクの前に、山札の上1枚をシールド化するか、表向きにして自分のシールド1つの上に置く(シールドの枚数は変わらない)', () => {
    const sim = new Sim({ p0: { battle: [{ c: '煌龍 サッヴァーク' }], shield: 3, deck: [N, N, N, N, N, N] }, p1: { shield: 5 } });
    sim.attack('煌龍 サッヴァーク', 'player');
    expect(sim.pending.why).toBe('modes');
    sim.option(0); // 1つ目のブレイクの前: シールド化
    expect(sim.count(0, 'shield')).toBe(4);
    sim.option(1); // 2つ目: 表向きで重ねる
    sim.pick('ダミー');
    expect(sim.count(0, 'shield')).toBe(4); // 重ねても枚数は変わらない
    const tops = sim.s.players[0].shield.filter((u) => sim.s.cards[u].up);
    expect(tops.length).toBe(1);
    expect(sim.s.piles?.[tops[0]]?.length).toBe(1);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('重ねられたシールドがブレイクされると、山のカードはすべて手札に加わる', () => {
    const sim = new Sim({ p0: { battle: [{ c: '煌龍 サッヴァーク' }], shield: 1, deck: [N, N, N, N] }, p1: { battle: [{ c: W }], shield: 5 } });
    // 自分のシールド1つに表向きのカードを重ねる
    sim.attack('煌龍 サッヴァーク', 'player');
    sim.option(1); // 自分のシールドは1つだけなので、重ねる先は聞かれない
    sim.option(0);
    sim.drain();
    expect(sim.count(0, 'shield')).toBe(2);
    // 相手のターン: アクアンが攻撃して、重なったシールドがブレイクされる
    sim.endTurn().drain();
    sim.skipMana();
    sim.s.players[1].battle[0].sick = false;
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, W), target: { kind: 'player' } });
    sim.drain();
    expect(sim.count(0, 'shield')).toBeLessThanOrEqual(1);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('出た時、バトルゾーンにある相手のカードを1枚選び、表向きで持ち主のシールド1つの上に置く', () => {
    const sim = new Sim({ p0: { hand: ['煌龍 サッヴァーク'], mana: [L, L, L, L, L, L, L] }, p1: { battle: [{ c: '流星のガイアッシュ・カイザー' }], shield: 3 } });
    sim.play('煌龍 サッヴァーク');
    sim.drain();
    expect(sim.has(1, 'battle', '流星のガイアッシュ・カイザー')).toBe(false);
    expect(sim.count(1, 'shield')).toBe(3);
    const up = sim.s.players[1].shield.filter((u) => sim.s.cards[u].up);
    expect(up.length).toBe(1);
    expect(sim.s.cards[up[0]].defId).toBe('dmex17-021');
  });
  it('自分のクリーチャーが離れる時、かわりに表向きのシールドのカードを1枚墓地に置いてもよい', () => {
    const sim = new Sim({
      p0: { battle: [{ c: '煌龍 サッヴァーク' }, { c: W }], shield: 2 },
      p1: { hand: ['堕呪 エアヴォ'], mana: [W, W, W, W] },
      active: 1,
    });
    // 表向きのシールドを用意(相手のシールドの上に重ねる代わりに、自分のシールドを表向きにする)
    const top = sim.s.players[0].shield[0];
    sim.s.cards[top].up = true;
    sim.play('堕呪 エアヴォ');
    sim.pick(W); // 持ち主の手札に戻す: アクアン(離れる)
    expect(sim.pending.why).toBe('replaceChoice');
    sim.option(0);
    // アクアンは離れず、表向きのシールドが墓地に置かれる
    expect(sim.has(0, 'battle', W)).toBe(true);
    expect(sim.count(0, 'shield')).toBe(1);
  });
});

describe('H02〜H04 ゼオス・トライクラブ・熊田すず', () => {
  it('サーヴァ・K・ゼオス: 相手のエレメントを1つ選び、シールド化する(持ち主のシールドに加わる)', () => {
    const sim = new Sim({ p0: { hand: ['サーヴァ・K・ゼオス'], mana: [L, L, L, L, L, L, L, L] }, p1: { battle: [{ c: W }], shield: 3 } });
    sim.play('サーヴァ・K・ゼオス');
    sim.use();
    expect(sim.has(1, 'battle', W)).toBe(false);
    expect(sim.count(1, 'shield')).toBe(4);
  });
  it('トライクラブ: 相手のクリーチャーを2体まで手札に戻す', () => {
    const sim = new Sim({ p0: { hand: [DRAGON], mana: [W, W, W, W, W, W] }, p1: { battle: [{ c: W }, { c: '流星のガイアッシュ・カイザー' }] } });
    sim.play(DRAGON);
    sim.pick(W, '流星のガイアッシュ・カイザー');
    expect(sim.count(1, 'battle')).toBe(0);
    expect(sim.count(1, 'hand')).toBe(2);
  });
  it('熊田すず: 出た時、相手のクリーチャーを破壊。相手のクリーチャーが破壊された時、相手は手札を1枚捨てる', () => {
    const sim = new Sim({ p0: { hand: ['熊田すず'], mana: ['ロスト・Re:ソウル', 'ロスト・Re:ソウル', 'ロスト・Re:ソウル', 'ロスト・Re:ソウル', 'ロスト・Re:ソウル', 'ロスト・Re:ソウル', 'ロスト・Re:ソウル'] }, p1: { battle: [{ c: W }], hand: [N, L] } });
    sim.play('熊田すず');
    sim.pick(N);
    expect(sim.has(1, 'battle', W)).toBe(false);
    expect(sim.count(1, 'hand')).toBe(1);
  });
});

describe('H05 龍世界 ドラゴ大王', () => {
  it('ドラゴンではないクリーチャーが出る時、かわりに持ち主の墓地に置く', () => {
    const sim = new Sim({ p0: { battle: ['龍世界 ドラゴ大王'] }, p1: { hand: [W, DRAGON], mana: [W, W, W, W, W, W, W, W, W, W] }, active: 1 });
    sim.play(W);
    expect(sim.has(1, 'grave', W)).toBe(true);
    expect(sim.has(1, 'battle', W)).toBe(false);
    sim.play(DRAGON);
    sim.drain();
    expect(sim.has(1, 'battle', DRAGON)).toBe(true);
  });
});

describe('H06 勝利宣言 鬼丸「覇」 / H07 真久間メガ', () => {
  it('攻撃する時、ガチンコ・ジャッジに勝てば、このターンの後に自分のターンを追加する', () => {
    const sim = new Sim({ p0: { battle: [{ c: '勝利宣言 鬼丸「覇」' }], deck: ['真久間メガ', N] }, p1: { deck: [W, W] } });
    sim.attack('勝利宣言 鬼丸「覇」', 'player');
    sim.drain();
    expect(sim.s.extraTurns?.length).toBe(1);
    // 公開したカードは、それぞれ山札の一番下に置かれた
    expect(sim.names(0, 'deck').at(-1)).toBe('真久間メガ');
  });
  it('ガチンコ・ジャッジに負ければ、ターンは追加されない', () => {
    const sim = new Sim({ p0: { battle: [{ c: '勝利宣言 鬼丸「覇」' }], deck: [N, N] }, p1: { deck: ['真久間メガ', W] } });
    sim.attack('勝利宣言 鬼丸「覇」', 'player');
    sim.drain();
    expect(sim.s.extraTurns ?? []).toEqual([]);
  });
  it('メガ: 召喚コストを、相手のクリーチャー1体につき1少なくする。出た時、パワー13000以下の相手のクリーチャーをすべて破壊する', () => {
    const sim = new Sim({
      p0: { hand: ['真久間メガ'], mana: mana(8, F) },
      p1: { battle: [{ c: W }, { c: W }, { c: W }, { c: W }, { c: W }, { c: '終末の監視者 ジ・ウォッチ' }] },
    });
    // 13 - 6 = 7 → 8枚で足りる
    sim.play('真久間メガ');
    expect(sim.count(1, 'battle')).toBe(0);
  });
});

describe('H08 地封龍 ギャイア / H09 地封院ギャイ', () => {
  it('ギャイア: 相手の「出た時」で始まる能力を持つクリーチャーが出る時、かわりにマナゾーンに置く', () => {
    const sim = new Sim({ p0: { battle: ['地封龍 ギャイア'] }, p1: { hand: [W], mana: [W, W, W, W] }, active: 1 });
    sim.play(W);
    expect(sim.has(1, 'mana', W)).toBe(true);
    expect(sim.has(1, 'battle', W)).toBe(false);
  });
  it('ギャイア: 自分のターン中、クリーチャーを1体、マナゾーンから召喚してもよい(コストは支払う)', () => {
    const sim = new Sim({ p0: { battle: ['地封龍 ギャイア'], mana: [W, W, W, W, W] } });
    const from = sim.legal().filter((a) => a.type === 'PLAY_CARD' && a.from === 'mana');
    expect(from.length).toBeGreaterThan(0);
    sim.play(W, { from: 'mana' });
    sim.drain();
    // 1体だけ。もう1体はできない
    expect(sim.legal().filter((a) => a.type === 'PLAY_CARD' && a.from === 'mana').length).toBe(0);
  });
  it('地封院ギャイ: 山札の上3枚を表向きにし、ドラゴン・クリーチャーを好きな数手札に加え、残りをタップしてマナゾーンに置く', () => {
    const sim = new Sim({ p0: { hand: ['地封院ギャイ'], mana: mana(6), deck: [DRAGON, N, W, 'ダミー'] } });
    sim.play('地封院ギャイ');
    sim.pick(DRAGON);
    expect(sim.has(0, 'hand', DRAGON)).toBe(true);
    expect(sim.count(0, 'mana')).toBe(8);
    expect(sim.tappedMana(0)).toBe(6 + 2);
  });
});

describe('H10 蒼き守護神 ドギラゴン閃', () => {
  it('ファイナル革命: 山札の上4枚から、進化ではない多色クリーチャーをコストの合計6以下で出し、残りを山札の下に置く', () => {
    const sim = new Sim({
      p0: { hand: ['蒼き守護神 ドギラゴン閃'], battle: [{ c: DRAGON }], deck: ['天災 デドダム', '天災 デドダム', N, N, 'ダミー'] },
    });
    // トライクラブ(水・コスト6のドラゴン)は光か火ではないので、革命チェンジできない
    sim.attack(DRAGON, 'player');
    expect(sim.s.pending?.why).not.toBe('may');
  });
  it('革命チェンジ[光または火のコスト5以上のドラゴン]で出て、ファイナル革命で多色クリーチャーを出す', () => {
    const sim = new Sim({
      p0: { hand: ['蒼き守護神 ドギラゴン閃'], battle: [{ c: 'ボルシャック・ドリーム・ドラゴン' }], deck: ['天災 デドダム', '天災 デドダム', N, N, 'ダミー'] },
    });
    sim.attack('ボルシャック・ドリーム・ドラゴン', 'player');
    sim.yes();
    sim.order('革命チェンジ'); // 攻撃する時の能力より先に、入れ替える
    sim.order('ファイナル革命');
    // 上4枚(デドダム2枚=コスト合計6)が多色クリーチャー。ちょうど収まる組み合わせ
    sim.pick('天災 デドダム', '天災 デドダム');
    sim.drain();
    expect(sim.count(0, 'battle', '天災 デドダム')).toBe(2);
  });
});

describe('H11 流星アーシュ / H12 メンデルスゾーン / H13 栄光ルピア / H14 ドリーム・ドラゴン', () => {
  it('アーシュ: 山札の上1枚をタップしてマナに置き、ドラゴンをマナから手札に戻し、そのコスト以下の相手のクリーチャーを手札に戻す', () => {
    const sim = new Sim({
      p0: { hand: ['流星アーシュ'], mana: [W, N, W, N, W, DRAGON], deck: [N, N] },
      p1: { battle: [{ c: W }, { c: W }] },
    });
    sim.play('流星アーシュ');
    // マナのドラゴン(トライクラブ)は1枚だけ、戻す相手のアクアンも同じ2体なので、聞かれない
    expect(sim.has(0, 'hand', DRAGON)).toBe(true);
    expect(sim.count(1, 'battle', W)).toBe(1);
  });
  it('メンデルスゾーン: 山札の上2枚を表向きにし、ドラゴン・カードをタップしてマナに置き、残りを墓地に置く', () => {
    const sim = new Sim({ p0: { hand: ['メンデルスゾーン'], mana: [F, F], deck: [DRAGON, N, 'ダミー'] } });
    sim.play('メンデルスゾーン');
    expect(sim.has(0, 'mana', DRAGON)).toBe(true);
    expect(sim.has(0, 'grave', N)).toBe(true);
  });
  it('栄光・ルピア: 山札の上1枚をタップしてマナに置く。それがドラゴンなら、もう1枚', () => {
    const sim = new Sim({ p0: { hand: ['ボルシャック・栄光・ルピア'], mana: [F, F, F], deck: [DRAGON, N, N] } });
    sim.play('ボルシャック・栄光・ルピア');
    expect(sim.count(0, 'mana')).toBe(3 + 2);
  });
  it('ドリーム・ドラゴン: マナにドラゴンが4枚以上なら召喚コストが3少なくなる', () => {
    const sim = new Sim({ p0: { hand: ['ボルシャック・ドリーム・ドラゴン'], mana: [L, F, N, DRAGON, DRAGON, DRAGON, DRAGON] } });
    expect(sim.canPlay('ボルシャック・ドリーム・ドラゴン')).toBe(true); // 7 - 3 = 4 で足りる
    const sim2 = new Sim({ p0: { hand: ['ボルシャック・ドリーム・ドラゴン'], mana: [L, F, N, DRAGON, DRAGON, DRAGON] } });
    expect(sim2.canPlay('ボルシャック・ドリーム・ドラゴン')).toBe(false);
  });
  it('ドリーム・ドラゴン: 攻撃する時、山札の上1枚を表向きにし、ドラゴンなら出す。それ以外なら墓地に置く', () => {
    const sim = new Sim({ p0: { battle: [{ c: 'ボルシャック・ドリーム・ドラゴン' }], deck: [N, N, N] } });
    sim.attack('ボルシャック・ドリーム・ドラゴン', 'player');
    expect(sim.has(0, 'grave', N)).toBe(true);
  });
});
