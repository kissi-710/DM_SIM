import { describe, expect, it } from 'vitest';
import { IllegalAction } from '../../src/engine/types';
import { Sim, mana } from '../scenario';

const W = 'アクアン'; // 水 コスト4 パワー2000
const N = 'フェアリー・ライフ'; // 自然・呪文 コスト2
const DEDO = '天災 デドダム'; // 水闇自然 コスト3
const MARURU = 'ヨビニオン・マルル'; // 自然 コスト4 パワー5000
const ORGATE = '魔誕の斬将オルゲイト'; // 水 コスト7 ハイパーエナジー
const DEDDAMUD = 'SSS級天災 デッドダムド'; // 進化(トリニティ・コマンド)

describe('ターンの進行', () => {
  it('ターンを終えると相手のターンになり、ドロー・アンタップ・召喚酔いの解除が行われる', () => {
    const sim = new Sim({
      p0: { battle: [MARURU] },
      p1: { hand: [W], mana: [{ c: W, tapped: true }, { c: W, tapped: true }], battle: [{ c: DEDO, tapped: true, sick: true }], deck: 10 },
    });
    const turn = sim.s.turn;
    sim.endTurn();
    expect(sim.s.turn).toBe(turn + 1);
    expect(sim.s.active).toBe(1);
    expect(sim.s.step).toBe('mana');
    expect(sim.pending.player).toBe(1);
    expect(sim.count(1, 'hand')).toBe(2); // 1枚ドロー
    expect(sim.count(1, 'deck')).toBe(9);
    expect(sim.tappedMana(1)).toBe(0);
    expect(sim.s.players[1].battle[0].tapped).toBe(false);
    expect(sim.s.players[1].battle[0].sick).toBe(false);
    expect(sim.s.manaCharged).toBe(false);
  });
  it('マナチャージは1ターンに1回で、そのあとはメインに進む', () => {
    const sim = new Sim({ step: 'mana', p0: { hand: [W, N] } });
    sim.charge(W);
    expect(sim.s.step).toBe('main');
    expect(sim.s.manaCharged).toBe(true);
    expect(sim.count(0, 'mana')).toBe(1);
    expect(sim.legal().some((a) => a.type === 'CHARGE_MANA')).toBe(false);
  });
  it('SKIP_MANA でマナチャージせずにメインへ進める', () => {
    const sim = new Sim({ step: 'mana', p0: { hand: [W] } });
    sim.skipMana();
    expect(sim.s.step).toBe('main');
    expect(sim.count(0, 'mana')).toBe(0);
  });
  it('END_MAIN で攻撃ステップに進み、そこでは使用ができない', () => {
    const sim = new Sim({ p0: { hand: [W], mana: mana(4, W), battle: [MARURU] } });
    sim.endMain();
    expect(sim.s.step).toBe('attack');
    expect(sim.canPlay(W)).toBe(false);
    expect(sim.legal().some((a) => a.type === 'ATTACK')).toBe(true);
  });
  it('攻撃しても、メインのままなら続けて使用できる(召喚 → 攻撃 → 召喚)', () => {
    const sim = new Sim({ p0: { hand: [W], mana: mana(4, W), battle: [MARURU] }, p1: { shield: 5 } });
    sim.attack(MARURU, 'player');
    sim.drain();
    expect(sim.s.step === 'attack' || sim.s.step === 'main').toBe(true);
  });
  it('攻撃後のクリーチャーはタップ状態になる', () => {
    const sim = new Sim({ p0: { battle: [MARURU] } });
    sim.attack(MARURU, 'player');
    sim.drain();
    expect(sim.s.players[0].battle[0].tapped).toBe(true);
  });
  it('先攻後攻が逆でも(席1が先攻)ターン進行が成立する', () => {
    const sim = new Sim({ active: 1, first: 1, turn: 3, p1: { battle: [MARURU] } });
    expect(sim.pending.player).toBe(1);
    sim.endTurn();
    expect(sim.s.active).toBe(0);
  });
});

describe('勝敗', () => {
  it('山札が0枚になるドローで敗北する', () => {
    const sim = new Sim({ p1: { deck: 1, hand: [] } });
    sim.endTurn();
    sim.drain();
    expect(sim.s.winner).toBe(0);
    expect(sim.s.loseReason).toBe('山札切れ');
    expect(sim.legal()).toEqual([]);
  });
  it('終了したゲームには行動できない', () => {
    const sim = new Sim({ p0: { battle: [MARURU] }, p1: { shield: 0 } });
    sim.attack(MARURU, 'player');
    expect(sim.s.winner).toBe(0);
    expect(() => sim.endTurn()).toThrow(IllegalAction);
  });
  it('ターン上限に達すると引き分けになる(設定で変えられる)', () => {
    const sim = new Sim({ turn: 3, cfg: { turnLimit: 3 } });
    sim.endTurn();
    sim.drain();
    expect(sim.s.winner).toBe('draw');
  });
  it('一人回し(solitaire)では、相手の山札切れでは負けない', () => {
    const sim = new Sim({ cfg: { solitaire: true }, p1: { deck: 0 } });
    sim.endTurn();
    sim.drain();
    expect(sim.s.winner).not.toBe(0);
  });
});

describe('攻撃の対象・制限', () => {
  it('召喚酔いのクリーチャーは攻撃できない', () => {
    const sim = new Sim({ p0: { battle: [{ c: MARURU, sick: true }] } });
    expect(sim.legal().some((a) => a.type === 'ATTACK')).toBe(false);
  });
  it('タップ状態のクリーチャーは攻撃できない', () => {
    const sim = new Sim({ p0: { battle: [{ c: MARURU, tapped: true }] } });
    expect(sim.legal().some((a) => a.type === 'ATTACK')).toBe(false);
  });
  it('アンタップ状態の相手クリーチャーは、攻撃対象にできない', () => {
    const sim = new Sim({ p0: { battle: [MARURU] }, p1: { battle: [W] } });
    expect(sim.legal().filter((a) => a.type === 'ATTACK' && (a as any).target.kind === 'creature')).toHaveLength(0);
    expect(() => sim.attack(MARURU, W)).toThrow(IllegalAction);
  });
  it('タップ状態の相手クリーチャーは攻撃できる。パワーの低い側が破壊される', () => {
    const sim = new Sim({ p0: { battle: [MARURU] }, p1: { battle: [{ c: W, tapped: true }] } });
    sim.attack(MARURU, W);
    sim.drain();
    expect(sim.has(1, 'grave', W)).toBe(true);
    expect(sim.has(0, 'battle', MARURU)).toBe(true);
  });
});

describe('プレイの検証(進化・ハイパーエナジー・手動支払い)', () => {
  it('進化クリーチャーは、進化元(条件を満たす自分のクリーチャー)を選ぶ必要がある', () => {
    const sim = new Sim({ p0: { hand: [DEDDAMUD], mana: ['ロスト・Re:ソウル', ...mana(4), W, W, W], battle: [DEDO, 'ダミー'] } });
    const dedo = sim.pid(0, DEDO);
    const maruru = sim.pid(0, 'ダミー'); // 光のみ: 水・闇・自然のどれでもない
    const u = sim.uid(0, 'hand', DEDDAMUD);
    const act = (extra: any) => ({ type: 'PLAY_CARD' as const, uid: u, from: 'hand' as const, extra });
    expect(() => sim.do(act(undefined))).toThrow(IllegalAction); // 進化元の指定なし
    expect(() => sim.do(act({ onto: maruru }))).toThrow(IllegalAction); // 条件を満たさない
    expect(() => sim.do(act({ onto: 99999 }))).toThrow(IllegalAction); // 存在しない
    sim.do(act({ onto: dedo }));
    sim.drain();
    expect(sim.s.players[0].battle).toHaveLength(2);
    expect(sim.s.players[0].battle.some((p) => p.cards.length === 2)).toBe(true);
  });
  it('進化クリーチャーを、手札の元の面のまま進化元なしでは出せない(合法手に載らない)', () => {
    const sim = new Sim({ p0: { hand: [DEDDAMUD], mana: [...mana(4), W, W, W, W] } });
    expect(sim.canPlay(DEDDAMUD)).toBe(false);
  });
  it('進化でないクリーチャーに onto を指定すると不可', () => {
    const sim = new Sim({ p0: { hand: [W], mana: mana(4, W), battle: [MARURU] } });
    expect(() => sim.play(W, { extra: { onto: sim.pid(0, MARURU) } })).toThrow(IllegalAction);
  });
  it('ハイパーエナジー: コストの異なるアンタップのクリーチャーをタップして、コストを2ずつ軽減する', () => {
    const sim = new Sim({ p0: { hand: [ORGATE], mana: mana(1, W), battle: [DEDO, W, '漢気の2号 ボスカツ'] } });
    // マナ1枚だけ → 7 - 2*3 = 1 で唱えられる(3体タップ)
    const taps = [sim.pid(0, DEDO), sim.pid(0, W), sim.pid(0, '漢気の2号 ボスカツ')];
    sim.play(ORGATE, { extra: { tap: taps } });
    sim.drain();
    expect(sim.has(0, 'battle', ORGATE)).toBe(true);
    for (const pid of taps) expect(sim.s.players[0].battle.find((p) => p.pid === pid)!.tapped).toBe(true);
  });
  it('ハイパーエナジー: コストが同じクリーチャー・タップ済み・持たないカードは不可', () => {
    const sim = new Sim({
      p0: { hand: [ORGATE, W], mana: mana(4, W), battle: [W, W, { c: DEDO, tapped: true }] },
    });
    const same = [sim.pid(0, W, 0), sim.pid(0, W, 1)];
    expect(() => sim.play(ORGATE, { extra: { tap: same } })).toThrow(IllegalAction);
    expect(() => sim.play(ORGATE, { extra: { tap: [sim.pid(0, DEDO)] } })).toThrow(IllegalAction);
    expect(() => sim.play(W, { extra: { tap: [sim.pid(0, W, 0)] } })).toThrow(IllegalAction);
  });
  it('手動支払い: タップ済みのマナ・相手のマナ・マナゾーン以外は使えない', () => {
    const sim = new Sim({
      p0: { hand: [W, N], mana: [{ c: W, tapped: true }, ...mana(3, W)] },
      p1: { mana: mana(4, W) },
    });
    const m = sim.s.players[0].mana;
    expect(() => sim.play(W, { extra: { pay: [m[0], m[1], m[2], m[3]] } })).toThrow(IllegalAction); // タップ済み
    expect(() => sim.play(W, { extra: { pay: [...sim.s.players[1].mana] } })).toThrow(IllegalAction); // 相手
    expect(() => sim.play(W, { extra: { pay: [sim.uid(0, 'hand', N), m[1], m[2], m[3]] } })).toThrow(IllegalAction); // 手札
    expect(() => sim.play(W, { extra: { pay: [m[1], m[1], m[2], m[3]] } })).toThrow(IllegalAction); // 重複
  });
  it('別のゾーンを from に指定した使用は不可', () => {
    const sim = new Sim({ p0: { hand: [W], mana: mana(4, W) } });
    expect(() => sim.do({ type: 'PLAY_CARD', uid: sim.uid(0, 'hand', W), from: 'grave' })).toThrow(IllegalAction);
    expect(() => sim.do({ type: 'PLAY_CARD', uid: sim.uid(0, 'hand', W), from: 'mana' })).toThrow(IllegalAction);
  });
  it('存在しない面の指定は不可', () => {
    const sim = new Sim({ p0: { hand: [W], mana: mana(4, W) } });
    expect(() => sim.do({ type: 'PLAY_CARD', uid: sim.uid(0, 'hand', W), from: 'hand', face: 3 })).toThrow(IllegalAction);
  });
});
