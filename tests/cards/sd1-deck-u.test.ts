// デッキU「ツインパクトの極み！光水自然清永デッキ」の新規カード(docs/decks-25oudou.md)のシナリオテスト。ツインパクト・マナの文明・シールドの大量ブレイクなど。
import { describe, expect, it } from 'vitest';
import { Sim, mana } from '../scenario';
import { checkInvariants } from '../../src/engine/invariants';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const L = 'ダミー';
const TWIN = '同期の妖精'; // ツインパクト(同期の妖精 / ド浮きの動悸)
const MINO = '全虹帝 ミノガミ';
const KING = 'キングダム・オウ禍武斗';
const ELIZA = '天雷龍姫エリザベス';
const CASA = '怪盗妖精カサブランカ';
const KIYO = '五輪の求道者 清永';
const ZENON = 'アカシック・ゼノン';
const attackActions = (sim: Sim) => sim.legal().filter((a) => a.type === 'ATTACK');

describe('U01 全虹帝 ミノガミ / ハザード・パクト', () => {
  it('出た時、ツインパクトカードを1枚、自分の墓地からマナゾーンに置く', () => {
    const sim = new Sim({ p0: { hand: [MINO], mana: mana(5, N), grave: [TWIN, N] } });
    sim.play(MINO);
    sim.drain(); // ツインパクトは墓地に1枚だけなので、聞かずにマナゾーンに置く(「置く」は強制)
    expect(sim.has(0, 'mana', TWIN)).toBe(true);
  });
  it('ハザード・パクト: 山札の上から1枚目をマナゾーンに置く。それがツインパクトカードなら、カードを1枚引く', () => {
    const sim = new Sim({ p0: { hand: [MINO], mana: mana(3, N), deck: [TWIN, N, N] } });
    sim.play(MINO, { face: 1 });
    expect(sim.count(0, 'mana')).toBe(4);
    expect(sim.count(0, 'hand')).toBe(1);
  });
});

describe('U02 キングダム・オウ禍武斗 / 轟破天九十九語', () => {
  it('破天九語: バトルに勝った時、相手のシールドを9つブレイクする', () => {
    const sim = new Sim({ p0: { battle: [{ c: KING }] }, p1: { battle: [{ c: W, tapped: true }], shield: 12, deck: [N, N] } });
    sim.attack(KING, W);
    sim.drain();
    expect(sim.count(1, 'shield')).toBe(3);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('轟破天九十九語: 各プレイヤーは、すべてのクリーチャーを自身のマナゾーンから出す(出ることによって起こる効果は無視する)', () => {
    const sim = new Sim({
      p0: { hand: [KING], mana: [...mana(9, N), W, '終末の監視者 ジ・ウォッチ'] },
      p1: { mana: [W, W] },
    });
    sim.play(KING, { face: 1 });
    sim.drain();
    expect(sim.has(0, 'battle', W)).toBe(true);
    expect(sim.count(1, 'battle', W)).toBe(2);
  });
});

describe('U03 天雷龍姫エリザベス / U04 怪盗妖精カサブランカ', () => {
  it('エリザベス: 自分のシールドゾーンから手札に加える呪文すべてに、「S・トリガー」を与える', () => {
    const sim = new Sim({ p0: { battle: [{ c: W }] }, p1: { battle: [{ c: ELIZA }], shield: ['ナチュラル・トラップ'.length ? 'フェアリー・ライフ' : N], mana: [] } });
    sim.attack(W, 'player');
    expect(sim.s.pending?.why).toBe('triggerDeclare');
  });
  it('インビンシブル・フォートレス: 相手のシールドを3つまで選び、持ち主の墓地に置く', () => {
    const sim = new Sim({ p0: { hand: [ELIZA], mana: mana(13, 'ドンドン火噴くナウ') }, p1: { shield: 5 } });
    sim.play(ELIZA, { face: 1 });
    sim.answer((sim.pending.input as { candidates: number[] }).candidates.slice(0, 3));
    sim.drain();
    expect(sim.count(1, 'shield')).toBe(2);
    expect(sim.count(1, 'grave')).toBe(3);
  });
  it('カサブランカ: 自分のマナゾーンにあるカードは、すべての文明を持つ。手札からマナゾーンに置いたカードはアンタップする', () => {
    const sim = new Sim({ p0: { hand: ['クリムゾン・ビクトリー', CASA], mana: [N], battle: [{ c: CASA }] }, step: 'mana' });
    sim.charge('クリムゾン・ビクトリー');
    expect(sim.s.cards[sim.uid(0, 'mana', 'クリムゾン・ビクトリー')].tapped).toBe(false);
  });
  it('「信じていたのに裏切られるなんて!」: コスト5以上のクリーチャーをすべて、持ち主の手札に戻す', () => {
    const sim = new Sim({ p0: { hand: [CASA], mana: mana(6, W), battle: [{ c: W }] }, p1: { battle: [{ c: KING }] } });
    sim.play(CASA, { face: 1 });
    expect(sim.has(1, 'hand', KING)).toBe(true);
    expect(sim.has(0, 'battle', W)).toBe(true);
  });
});

describe('U05 五輪の求道者 清永 / U06 アカシック・ゼノン', () => {
  it('清永: 攻撃する時、山札の上から3枚を表向きにする。すべて異なるコストなら、コスト9以下のエレメントを好きな数、コストを支払わずに実行する。残りをマナゾーンに置く', () => {
    const sim = new Sim({ p0: { battle: [{ c: KIYO }], deck: [W, 'AQvibrato', ZENON, N, N] }, p1: { shield: 5 } });
    sim.attack(KIYO, 'player');
    sim.pick(W, ZENON);
    sim.drain();
    expect(sim.has(0, 'battle', W)).toBe(true);
    expect(sim.has(0, 'battle', ZENON)).toBe(true);
    expect(sim.has(0, 'mana', 'AQvibrato')).toBe(true);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('清永: ツインパクトカードは、好きな方のコストを参照できる(公式Q&A 45933)。ボン・キゴマイム2枚(3と2)と同期の妖精(4)で、すべて異なるコストになる', () => {
    const sim = new Sim({ p0: { battle: [{ c: KIYO }], deck: ['ボン・キゴマイム', 'ボン・キゴマイム', '同期の妖精', N, N] }, p1: { shield: 5 } });
    sim.attack(KIYO, 'player');
    sim.pick('ボン・キゴマイム', 'ボン・キゴマイム', '同期の妖精');
    sim.drain();
    expect(sim.count(0, 'battle', 'ボン・キゴマイム')).toBe(2);
    expect(sim.has(0, 'battle', '同期の妖精')).toBe(true);
  });
  it('清永: コストがすべて異ならなければ、エレメントは実行できない。ただし、3枚ともマナゾーンに置く(「残りをすべてマナゾーンに置く」は独立した文)', () => {
    const sim = new Sim({ p0: { battle: [{ c: KIYO }], deck: [W, W, ZENON, N, N] }, p1: { shield: 5 } });
    sim.attack(KIYO, 'player');
    sim.drain();
    expect(sim.has(0, 'battle', W)).toBe(false);
    expect(sim.count(0, 'mana', W)).toBe(2);
    expect(sim.has(0, 'mana', ZENON)).toBe(true);
  });
  it('清永(台帳 L26): kiyonagaLeftoverOnFail を false にすると、異なるコストの時だけマナゾーンに置く(反対の解釈への切替)', () => {
    const fail = new Sim({ p0: { battle: [{ c: KIYO }], deck: [W, W, ZENON, N, N] }, p1: { shield: 5 }, cfg: { kiyonagaLeftoverOnFail: false } });
    fail.attack(KIYO, 'player');
    fail.drain();
    expect(fail.count(0, 'mana', W)).toBe(0);
    expect(fail.count(0, 'deck')).toBe(5);
    const ok = new Sim({ p0: { battle: [{ c: KIYO }], deck: [W, 'AQvibrato', ZENON, N, N] }, p1: { shield: 5 }, cfg: { kiyonagaLeftoverOnFail: false } });
    ok.attack(KIYO, 'player');
    ok.pick(W, ZENON);
    ok.drain();
    expect(ok.has(0, 'mana', 'AQvibrato')).toBe(true);
  });
  it('ゼノン: 自分のツインパクト・クリーチャーすべてに「スピードアタッカー」を与える', () => {
    const sim = new Sim({ p0: { battle: [{ c: ZENON }, { c: TWIN, sick: true }] }, p1: { shield: 5 } });
    expect(attackActions(sim).some((a) => a.type === 'ATTACK' && a.attacker === sim.pid(0, TWIN))).toBe(true);
  });
  it('ゼノン: 各ターンに一度、自分のツインパクト・クリーチャーが攻撃する時、呪文側を、バトルゾーンに置いたままコストを支払わずに唱えてもよい', () => {
    const sim = new Sim({ p0: { battle: [{ c: ZENON }, { c: TWIN }], deck: [N, N, N] }, p1: { battle: [{ c: W }], shield: 5 } });
    sim.attack(TWIN, 'player');
    sim.yes();
    sim.drain();
    // ド浮きの動悸: 相手のクリーチャーを手札に戻し、カードを1枚引く
    expect(sim.has(1, 'hand', W)).toBe(true);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
});

void L;
