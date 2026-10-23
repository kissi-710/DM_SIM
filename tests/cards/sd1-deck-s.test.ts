// デッキS「相手を翻弄せよ！光闇メカ＆シノビデッキ」の新規カード(docs/decks-25oudou.md)のシナリオテスト。ニンジャ・チェンジ・ハイパー化・離れない・S・トリガーを与えるなど。
import { describe, expect, it } from 'vitest';
import { Sim, mana, reg } from '../scenario';
import { checkInvariants } from '../../src/engine/invariants';
import { powerOf } from '../../src/engine/derive';
import { mkCtx } from '../../src/engine/state';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const L = 'ダミー'; // 光
const D = 'フットレス=トレース'; // 闇
const KAOS = '聖カオスマントラ';
const VENE = 'ヴェネラック-F5';
const AMELIA = '光器アメリア';
const PETRO = '獲銀月 ペトローバ';
const KUSARI = '忍鎖の聖沌 94nm4';
const GOLD = 'ゴールド・フラウム';
const ENGELS = 'ハイパー・エン・ゲルス';
const SHEKE = 'シェケダン・ドメチアーレ';
const ATER = 'アーテル・ゴルギーニ';
const ALDED = 'アシステスト・アルデッド';
const BRAJE = 'ブラジェスコ-W1';
const BOJI = '千羽忍革 ボジソワカ';
const DRAN = 'ドラン・ゴル・ゲルス';
const power = (sim: Sim, p: 0 | 1, name: string) => powerOf(mkCtx(sim.s, reg), sim.s.players[p].battle.find((x) => x.pid === sim.pid(p, name))!);
const attackActions = (sim: Sim) => sim.legal().filter((a) => a.type === 'ATTACK');

describe('S01 聖カオスマントラ', () => {
  it('ニンジャ・チェンジ5: 相手のクリーチャーが攻撃した時、手札のこのクリーチャーと、自分のコスト5以上のメカまたはシノビを入れ替えてもよい', () => {
    const sim = new Sim({
      p0: { hand: [KAOS], battle: [{ c: '忍蛇の聖沌 c0br4' }], shield: 3 },
      p1: { battle: [{ c: W }] },
      active: 1,
    });
    sim.attack(W, 'player');
    sim.yes();
    sim.drain();
    expect(sim.has(0, 'battle', KAOS)).toBe(true);
    expect(sim.has(0, 'hand', '忍蛇の聖沌 c0br4')).toBe(true);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('出た時、相手のクリーチャーをすべてタップする。相手のクリーチャーは、出たターン攻撃できない', () => {
    const sim = new Sim({ p0: { hand: [KAOS], mana: mana(7, L) }, p1: { battle: [{ c: W }, { c: W }] } });
    sim.play(KAOS);
    sim.drain();
    expect(sim.s.players[1].battle.every((p) => p.tapped)).toBe(true);
    const sim2 = new Sim({ p0: { battle: [{ c: KAOS }] }, p1: { battle: [{ c: W, sick: true }], shield: 5 }, active: 1 });
    sim2.s.players[1].battle[0].enteredTurn = sim2.s.turn;
    expect(attackActions(sim2)).toEqual([]);
  });
});

describe('S02 ヴェネラック-F5 / S03 光器アメリア', () => {
  it('ヴェネラック: 相手のターン中に、相手のクリーチャーが相手のマナゾーンのカードをタップせずに出た時、それをシールド化してもよい', () => {
    const sim = new Sim({ p0: { battle: [{ c: VENE }], shield: 0 }, p1: { hand: ['ナ・チュラルゴ・デンジャー', 'コレンココ・タンク'], mana: mana(7, N), shield: 0 }, active: 1 });
    sim.play('ナ・チュラルゴ・デンジャー');
    sim.use('コレンココ・タンク'); // コストを支払わずに出す
    sim.yes(); // ヴェネラック: そのクリーチャーをシールド化する
    sim.drain();
    expect(sim.has(1, 'battle', 'コレンココ・タンク')).toBe(false);
    expect(sim.count(1, 'shield')).toBe(1);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('アメリア: 出た時、山札の上から1枚目をシールド化する。次の自分のターンのはじめに、自分のシールドを1つ手札に加える(「S・トリガー」は使えない)', () => {
    const sim = new Sim({ p0: { hand: [AMELIA], mana: mana(2, L), deck: [N, N, N], shield: 1 }, p1: { deck: [N, N, N] } });
    sim.play(AMELIA);
    expect(sim.count(0, 'shield')).toBe(2);
    sim.endTurn();
    sim.drain();
    sim.skipMana();
    sim.endTurn();
    sim.drain();
    expect(sim.count(0, 'shield')).toBe(1);
    expect(sim.count(0, 'hand')).toBeGreaterThanOrEqual(1);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
});

describe('S04 獲銀月 ペトローバ', () => {
  it('出た時、次の自分のターンのはじめまで、このクリーチャーは離れない', () => {
    const sim = new Sim({
      p0: { hand: [PETRO], mana: mana(3, L) },
      p1: { hand: ['青銅のバンビシカット'], mana: mana(9, 'ドンドン火噴くナウ'), deck: [N, N] },
    });
    sim.play(PETRO);
    sim.endTurn();
    sim.drain();
    sim.skipMana();
    sim.play('青銅のバンビシカット', { face: 1 });
    sim.drain();
    expect(sim.has(0, 'battle', PETRO)).toBe(true);
  });
  it('ハイパー化: 自分の他のクリーチャーを1体タップする。ハイパーモードのパワーは7500', () => {
    const sim = new Sim({ p0: { battle: [{ c: PETRO }, { c: W }] } });
    const hy = sim.legal().find((a) => a.type === 'HYPERIZE' && a.pid === sim.pid(0, PETRO));
    expect(hy).toBeDefined();
    sim.do(hy!);
    expect(power(sim, 0, PETRO)).toBe(7500);
  });
});

describe('S05 忍鎖の聖沌 94nm4 / S06 ゴールド・フラウム', () => {
  it('94nm4: 攻撃する時、山札の上から1枚をシールド化してもよい。各ターンに1度、シールドゾーンにカードを置いた時、メカ・メクレイド5する', () => {
    const sim = new Sim({ p0: { battle: [{ c: KUSARI }], deck: [N, GOLD, N, N, N], shield: 1 }, p1: { shield: 5 } });
    sim.attack(KUSARI, 'player');
    sim.yes();
    sim.pick(GOLD);
    sim.drain();
    expect(sim.has(0, 'battle', GOLD)).toBe(true);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('ゴールド・フラウム: 出た時、山札の上から1枚目をシールド化してもよい', () => {
    const sim = new Sim({ p0: { hand: [GOLD], mana: mana(4, L), deck: [N, N], shield: 0 } });
    sim.play(GOLD);
    sim.order('出た時');
    sim.yes();
    sim.drain();
    expect(sim.count(0, 'shield')).toBe(1);
  });
});

describe('S07 ハイパー・エン・ゲルス / S08 シェケダン・ドメチアーレ', () => {
  it('エン・ゲルス: 自分のターンの終わりに、自分のクリーチャーを3体までアンタップする', () => {
    const sim = new Sim({ p0: { battle: [{ c: ENGELS }, { c: W, tapped: true }] } });
    sim.endTurn();
    sim.use(W);
    sim.drain();
    expect(sim.s.players[0].battle.every((p) => !p.tapped)).toBe(true);
  });
  it('シェケダン: 出た時、自分の光のクリーチャーまたは光のタマシード1つにつき、カードを1枚引いてもよい。光のクリーチャーを使うコストを2少なくする', () => {
    const sim = new Sim({ p0: { hand: [SHEKE, KAOS], mana: mana(10, L), deck: [N, N, N, N] } });
    sim.play(SHEKE);
    sim.yes();
    sim.drain();
    expect(sim.count(0, 'hand')).toBe(2); // カオスマントラ + 1枚(自身のぶん)
    sim.play(KAOS);
    expect(sim.tappedMana(0)).toBe(5 + 5); // 5(シェケダン) + 7-2
  });
});

describe('S09 アーテル・ゴルギーニ / S10 アルデッド / S11 ブラジェスコ', () => {
  it('アーテル・ゴルギーニ: 出た時、次の中から2回選ぶ(山札の上から4枚を墓地に置く、を2回)', () => {
    const sim = new Sim({ p0: { hand: [ATER], mana: mana(5, D), deck: [N, N, N, N, N, N, N, N, N] } });
    sim.play(ATER);
    sim.option(1, 1);
    sim.drain();
    expect(sim.count(0, 'grave')).toBe(8);
  });
  it('アーテル・ゴルギーニ: 離れる時、かわりに自分の他のクリーチャーを1体破壊してもよい', () => {
    const sim = new Sim({
      p0: { battle: [{ c: ATER }, { c: W }] },
      p1: { hand: ['青銅のバンビシカット'], mana: mana(9, 'ドンドン火噴くナウ'), deck: [N, N] },
      active: 1,
    });
    sim.play('青銅のバンビシカット', { face: 1 });
    sim.drain(1);
    if (sim.s.pending?.input?.shape === 'pick') sim.pick(ATER);
    while (sim.s.pending && sim.s.pending.why !== 'turnAction') {
      const inp: any = sim.s.pending.input;
      if (inp.shape === 'option') sim.option(0);
      else sim.drain(1);
    }
    expect(sim.has(0, 'battle', ATER)).toBe(true);
    expect(sim.has(0, 'grave', W)).toBe(true);
  });
  it('アシステスト・アルデッド: 出た時、自分の他のメカがあれば、カードを1枚引く', () => {
    const sim = new Sim({ p0: { hand: [ALDED], battle: [{ c: GOLD }], mana: mana(3, D), deck: [N, N] } });
    sim.play(ALDED);
    expect(sim.count(0, 'hand')).toBe(1);
  });
  it('ブラジェスコ-W1: 出た時、相手のクリーチャーを1体選ぶ。このターン、そのクリーチャーのパワーを-3000する', () => {
    const sim = new Sim({ p0: { hand: [BRAJE], mana: mana(2, D) }, p1: { battle: [{ c: W }] } });
    sim.play(BRAJE);
    sim.drain();
    expect(sim.has(1, 'battle', W)).toBe(false); // 2000 - 3000
  });
});

describe('S12 千羽忍革 ボジソワカ / S13 ドラン・ゴル・ゲルス / 豪龍の記憶', () => {
  it('ボジソワカ: 自分のターンの終わりに、自分のコスト4以下のクリーチャーを手札と墓地から最大1体ずつ出してもよい。「ブロッカー」を与える', () => {
    const sim = new Sim({ p0: { battle: [{ c: BOJI }], hand: [W], grave: ['AQvibrato'] } });
    sim.endTurn();
    sim.pick(W);
    sim.pick('AQvibrato');
    sim.drain();
    expect(sim.has(0, 'battle', W)).toBe(true);
    expect(sim.has(0, 'battle', 'AQvibrato')).toBe(true);
    expect(sim.s.effects.filter((e) => e.mod.kind === 'grant').length).toBe(2);
  });
  it('ドラン・ゴル・ゲルス: 出た時、自分のシールドを1つブレイクしてもよい。その後、コスト3以下のメカを1枚、手札から出してもよい', () => {
    const sim = new Sim({ p0: { hand: [DRAN, ALDED], mana: [...mana(3, L), ...mana(2, D)], shield: 2 } });
    sim.play(DRAN);
    sim.yes();
    sim.use(ALDED);
    sim.drain();
    expect(sim.has(0, 'battle', ALDED)).toBe(true);
    expect(sim.count(0, 'shield')).toBe(1);
  });
  it('豪龍の記憶: 山札の上から1枚をシールド化する。次の自分のターンのはじめまで、そのシールドに「S・トリガー」を与える', () => {
    const sim = new Sim({ p0: { hand: [DRAN], mana: mana(5, L), deck: [N, N, N], shield: 0 }, p1: { battle: [{ c: W }] } });
    sim.play(DRAN, { face: 1 });
    expect(sim.count(0, 'shield')).toBe(1);
    sim.endTurn();
    sim.drain();
    sim.skipMana();
    // 相手のクリーチャーがそのシールドをブレイク: S・トリガーを宣言できる
    sim.attack(W, 'player');
    expect(sim.s.pending?.why).toBe('triggerDeclare');
  });
});
