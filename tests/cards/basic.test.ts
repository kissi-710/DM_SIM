import { describe, expect, it } from 'vitest';
import { Sim, mana } from '../scenario';

// 単色マナの代用カード
const N = 'フェアリー・ライフ'; // 自然
const W = 'アクアン'; // 水
const D = 'ロスト・Re:ソウル'; // 闇
const L = 'ドラゴンズ・サイン'; // 光
const F = '王道の革命 ドギラゴン'; // 光・火・自然(火の代用)

describe('A1 フェアリー・ライフ', () => {
  it('山札の上1枚をマナゾーンに置き、墓地へ行く', () => {
    const sim = new Sim({ p0: { hand: [N], mana: mana(2), deck: ['アクアン', 'ダミー', 'ダミー'] } });
    sim.play(N);
    expect(sim.count(0, 'mana')).toBe(3);
    expect(sim.has(0, 'mana', 'アクアン')).toBe(true);
    expect(sim.has(0, 'grave', N)).toBe(true);
  });
  it('S・トリガーとして使える', () => {
    const sim = new Sim({
      p0: { battle: ['終末縫合王 ザ=キラー・キーナリー'] },
      p1: { shield: [N], deck: ['ティンパニ=シンバリー', 'ダミー'] },
    });
    sim.attack('終末縫合王 ザ=キラー・キーナリー', 'player');
    sim.pick(N);
    expect(sim.has(1, 'mana', 'ティンパニ=シンバリー')).toBe(true);
  });
});

describe('A2 フェアリー・Re:ライフ', () => {
  it('呪文として唱えるとブーストする(S・トリガーはない)', () => {
    const sim = new Sim({ p0: { hand: ['フェアリー・Re:ライフ'], mana: mana(2), deck: [W, 'ダミー'] } });
    sim.play('フェアリー・Re:ライフ');
    expect(sim.has(0, 'mana', W)).toBe(true);
  });
  it('G・ストライク: 相手のクリーチャー1体をそのターン攻撃できなくする', () => {
    const sim = new Sim({
      p0: { battle: ['ヨビニオン・マルル', 'ヨビニオン・トライブ'] },
      p1: { shield: ['フェアリー・Re:ライフ'] },
    });
    sim.attack('ヨビニオン・マルル', 'player');
    expect(sim.pending.why).toBe('triggerDeclare');
    sim.pick('フェアリー・Re:ライフ');
    expect(sim.pending.why).toBe('select');
    sim.pick('ヨビニオン・トライブ');
    const atk = sim.legal().filter((a) => a.type === 'ATTACK');
    expect(atk.length).toBe(0); // マルルは攻撃済み、トライブは攻撃できない
    expect(sim.s.effects.some((e) => e.mod.kind === 'cannotAttack')).toBe(true);
    // Re:ライフ自体は呪文として唱えられていない(手札に加わっている)
    expect(sim.has(1, 'hand', 'フェアリー・Re:ライフ')).toBe(true);
  });
  it('効果の期限はそのターン中(ターンが変わると攻撃できる)', () => {
    const sim = new Sim({
      p0: { battle: ['ヨビニオン・マルル', 'ヨビニオン・トライブ'] },
      p1: { shield: ['フェアリー・Re:ライフ'] },
    });
    sim.attack('ヨビニオン・マルル', 'player');
    sim.pick('フェアリー・Re:ライフ');
    sim.pick('ヨビニオン・トライブ');
    sim.endTurn(); // p1のターン
    expect(sim.s.effects.length).toBe(0);
  });
});

describe('A3 ワクムテラス / オリジナル・ライフ', () => {
  it('クリーチャー面: 出た時にカードを2枚引く', () => {
    const sim = new Sim({ p0: { hand: ['ワクムテラス'], mana: mana(4, W), deck: 5 } });
    sim.play('ワクムテラス');
    expect(sim.count(0, 'hand')).toBe(2);
    expect(sim.has(0, 'battle', 'ワクムテラス')).toBe(true);
  });
  it('呪文面: コスト2の自然の呪文として唱えられ、ブーストする', () => {
    const sim = new Sim({ p0: { hand: ['ワクムテラス'], mana: mana(2), deck: ['アクアン', 'ダミー'] } });
    expect(sim.canPlay('ワクムテラス')).toBe(true);
    sim.play('ワクムテラス', { face: 1 });
    expect(sim.count(0, 'mana')).toBe(3);
    expect(sim.has(0, 'grave', 'ワクムテラス')).toBe(true);
    expect(sim.count(0, 'battle')).toBe(0);
  });
  it('マナゾーンでは両方の文明を持つ多色カードとしてタップ状態で置かれる', () => {
    const sim = new Sim({ step: 'mana', p0: { hand: ['ワクムテラス'] } });
    sim.charge('ワクムテラス');
    expect(sim.tappedMana(0)).toBe(1);
  });
});

describe('A4/B2 天災 デドダム', () => {
  it('出た時、上3枚を手札・マナ・墓地に1枚ずつ振り分ける', () => {
    const sim = new Sim({
      p0: { hand: ['天災 デドダム'], mana: [W, D, N], deck: [N, 'ティンパニ=シンバリー', 'ジ・ウォッチ', 'ダミー'] },
    });
    sim.play('天災 デドダム');
    expect(sim.pending.why).toBe('assign');
    sim.assign({ hand: ['ジ・ウォッチ'], mana: [N], grave: ['ティンパニ=シンバリー'] });
    expect(sim.has(0, 'hand', 'ジ・ウォッチ')).toBe(true);
    expect(sim.count(0, 'mana')).toBe(4);
    expect(sim.has(0, 'grave', 'ティンパニ=シンバリー')).toBe(true);
    expect(sim.count(0, 'deck')).toBe(1);
  });
  it('割り振りは枠ごとの枚数制限を守らないと受け付けない', () => {
    const sim = new Sim({ p0: { hand: ['天災 デドダム'], mana: [W, D, N], deck: [N, N, N, 'ダミー'] } });
    sim.play('天災 デドダム');
    const inp: any = sim.pending.input;
    expect(() => sim.answer({ hand: inp.items, mana: [], grave: [] })).toThrow();
  });
  it('山札が3枚未満でも、あるだけ振り分ける', () => {
    const sim = new Sim({ p0: { hand: ['天災 デドダム'], mana: [W, D, N], deck: [N, W] } });
    sim.play('天災 デドダム');
    sim.assign({ hand: [N], grave: [W] });
    expect(sim.count(0, 'deck')).toBe(0);
    expect(sim.s.winner).toBe(1); // 山札が0枚になったので敗北
  });
});

describe('B1 フェアリー・ミラクル', () => {
  it('最初のブーストは無条件。5文明がそろっていなければ1枚だけ', () => {
    const sim = new Sim({ p0: { hand: ['フェアリー・ミラクル'], mana: mana(3), deck: [N, N, N, N] } });
    sim.play('フェアリー・ミラクル');
    expect(sim.count(0, 'mana')).toBe(4);
  });
  it('マナゾーンに5文明がそろっていれば、さらに1枚置く', () => {
    const sim = new Sim({
      p0: { hand: ['フェアリー・ミラクル'], mana: [N, N, W, D, L, F], deck: [N, N, N, N] },
    });
    // 光・火は多色カードで代用: 水=アクアン 闇=ロスト 光=ドラゴンズ・サイン 火=ドギラゴン 自然
    sim.play('フェアリー・ミラクル');
    expect(sim.count(0, 'mana')).toBe(8);
  });
  it('1枚目のブーストで5文明がそろう場合も、確認はそのあと', () => {
    const sim = new Sim({
      p0: { hand: ['フェアリー・ミラクル'], mana: [N, N, N, W, D, L], deck: [F, N, N, N] },
    });
    // 火が足りないが、1枚目に置いたドギラゴン(火)で5文明になる
    sim.play('フェアリー・ミラクル');
    expect(sim.count(0, 'mana')).toBe(8);
  });
});

describe('B3 アクアン', () => {
  it('上5枚を公開し、光と闇のカードをすべて手札に、残りを墓地に置く', () => {
    const sim = new Sim({
      p0: { hand: [W], mana: mana(4, W), deck: [L, D, N, F, 'ダミー', 'ティンパニ=シンバリー'] },
    });
    sim.play(W);
    sim.yes();
    // 光: ドラゴンズ・サイン / 闇: ロスト / 光(ドギラゴン) / 光(ダミー)
    expect(sim.count(0, 'hand')).toBe(4);
    expect(sim.has(0, 'hand', L)).toBe(true);
    expect(sim.has(0, 'hand', D)).toBe(true);
    expect(sim.has(0, 'hand', F)).toBe(true);
    expect(sim.has(0, 'grave', N)).toBe(true);
    expect(sim.count(0, 'deck')).toBe(1);
  });
  it('公開しないこともできる', () => {
    const sim = new Sim({ p0: { hand: [W], mana: mana(4, W), deck: [L, D, N, F, 'ダミー'] } });
    sim.play(W);
    sim.no();
    expect(sim.count(0, 'deck')).toBe(5);
  });
});

describe('A16 ジゴクバンカー', () => {
  it('シンパシー: マナ1枚につきコストが1少なくなる', () => {
    const few = new Sim({ p0: { hand: ['九番龍 ジゴクバンカー'], mana: mana(5) } });
    expect(few.canPlay('九番龍 ジゴクバンカー')).toBe(false); // 12-5=7 > 5
    const many = new Sim({ p0: { hand: ['九番龍 ジゴクバンカー'], mana: mana(7) } });
    expect(many.canPlay('九番龍 ジゴクバンカー')).toBe(true); // 12-7=5 <= 7
  });
  it('出た時、ブーストしてからマナを1枚手札に戻してもよい', () => {
    const sim = new Sim({ p0: { hand: ['九番龍 ジゴクバンカー'], mana: mana(8), deck: [W, 'ダミー'] } });
    sim.play('九番龍 ジゴクバンカー');
    expect(sim.count(0, 'mana')).toBe(9);
    sim.yes();
    sim.pick(W);
    expect(sim.has(0, 'hand', W)).toBe(true);
    expect(sim.count(0, 'mana')).toBe(8);
  });
});

describe('B11 ロスト・Re:ソウル', () => {
  it('相手は手札をすべて捨てる', () => {
    const sim = new Sim({ p0: { hand: [D], mana: mana(7, D) }, p1: { hand: [N, W, L] } });
    sim.play(D);
    expect(sim.count(1, 'hand')).toBe(0);
    expect(sim.count(1, 'grave')).toBe(3);
  });
  it('G・ストライクを持つ', () => {
    const sim = new Sim({
      p0: { battle: ['ヨビニオン・マルル'] },
      p1: { shield: [D], battle: [] },
    });
    sim.attack('ヨビニオン・マルル', 'player');
    sim.pick(D);
    // 相手(攻撃側)のクリーチャーを選ぶ
    expect(sim.pending.why).toBe('select');
  });
});

describe('B8 ドンドン火噴くナウ', () => {
  it('上3枚を振り分け、墓地に置いたカードのコスト以下の相手のクリーチャーを破壊する', () => {
    const sim = new Sim({
      p0: { hand: ['ドンドン火噴くナウ'], mana: [W, F, N, N, N], deck: ['ティンパニ=シンバリー', N, W, 'ダミー'] },
      p1: { battle: ['ヨビニオン・マルル', '終末の監視者 ジ・ウォッチ'] },
    });
    sim.play('ドンドン火噴くナウ');
    sim.assign({ mana: [N], hand: [W], grave: ['ティンパニ=シンバリー'] });
    // コスト4以下: マルル(4)のみ破壊できる(ジ・ウォッチ 10 は対象外)
    expect(sim.has(1, 'grave', 'ヨビニオン・マルル')).toBe(true);
    expect(sim.has(1, 'battle', '終末の監視者 ジ・ウォッチ')).toBe(true);
  });
});
