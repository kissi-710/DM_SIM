// 攻撃まわりのイベント・手続き(総合ルール 507 / 509 / 115 / 701.13 / 409.2b)を、テスト用のカードで固定する。
//   D-11 複数ブロッカー・強制ブロック(507.1a / 507.1b / 507.2a)
//   D-8  「ブレイクする前に」(509.3 / 509.4c)
//   D-7  「バトルする時」「バトルの後」(115.2 / 115.3a / 701.13d)
//   D-9  呪文自身の効果による、墓地のかわりの置換(409.2b / 609.8a)
//   D-16 使用宣言は、ターン・プレイヤーの効果を解決した後に、非ターン・プレイヤーが行う(506.3b〜e)
import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../../src/cards';
import { loadRegistry } from '../../src/engine/registry';
import type { CardDB } from '../../src/engine/types';
import { ATTACK_TEST_CARDS } from '../fixtures/attack-cards';
import { Sim, mana } from '../scenario';

const DB: CardDB = { ...CARD_DB, ...Object.fromEntries(ATTACK_TEST_CARDS.map((c) => [c.id, c])) };
const R = loadRegistry(DB);
const labels = (sim: Sim) => {
  sim.drain();
  return sim.evs('resolve').map((e) => e.label as string);
};

describe('D-11 複数ブロッカー・強制ブロック(507.1a / 507.1b / 507.2a)', () => {
  const BL = 'ティンパニ=シンバリー';
  it('複数体を同時に選べる。選んだ全員がタップし、最後に解決する1体だけがブロックする', () => {
    const sim = new Sim({
      p0: { battle: ['アクアン'] },
      p1: { battle: [BL, BL], shield: 5 },
    });
    sim.attack('アクアン', 'player');
    expect((sim.pending.input as any).max).toBe(2);
    sim.pick(BL, BL); // 2体とも選ぶ
    expect(sim.pending.why).toBe('block'); // 最後に解決する1体を選ぶ
    expect((sim.pending.input as any).min).toBe(1);
    sim.pick(BL);
    expect(sim.s.players[1].battle.every((p) => p.tapped)).toBe(true); // 2体ともタップ
    expect(sim.evs('blocked').length).toBe(1); // 「ブロックした時」は、最後の1体だけ
    expect(sim.count(1, 'shield')).toBe(5);
  });
  it('1体だけを選べば、最後の1体を選ぶ質問は出ない', () => {
    const sim = new Sim({ p0: { battle: ['アクアン'] }, p1: { battle: [BL, BL], shield: 5 } });
    sim.attack('アクアン', 'player');
    sim.pick(BL);
    expect(sim.s.pending?.why).not.toBe('block');
    expect(sim.s.players[1].battle.filter((p) => p.tapped).length).toBe(1);
  });
  it('ブロックを強制する効果を受けたブロッカーは、質問されず必ずブロックする(507.1b)', () => {
    const sim = new Sim({ p0: { battle: ['アクアン'] }, p1: { battle: [BL, BL], shield: 5 } });
    const pid = sim.pid(1, BL, 0);
    sim.s.effects.push({ id: 99, pid, mod: { kind: 'mustBlock' }, until: { kind: 'endOfTurn', turn: sim.s.turn }, controller: 1 });
    sim.attack('アクアン', 'player');
    expect(sim.s.pending?.why).not.toBe('block');
    expect(sim.evs('blocked').length).toBe(1);
    expect(sim.count(1, 'shield')).toBe(5);
  });
});

describe('D-8 「ブレイクする前に」(509.3 / 509.4c)', () => {
  it('ブレイクするシールドを選んだ後、ブレイクする前に解決する。攻撃クリーチャーが離れても、選んだシールドはブレイクされる', () => {
    const sim = new Sim({ p0: { battle: ['ヨビニオン・マルル'] }, p1: { battle: ['t-before-break'], shield: 5 } }, R);
    sim.attack('ヨビニオン・マルル', 'player');
    expect(sim.s.pending?.why).not.toBe('block');
    sim.drain();
    expect(labels(sim).some((l) => l.includes('T:ブレイクする前に'))).toBe(true);
    expect(sim.has(0, 'hand', 'ヨビニオン・マルル')).toBe(true); // 攻撃クリーチャーは手札に戻った
    expect(sim.count(1, 'shield')).toBe(4); // それでも、選んだ1枚はブレイクされた
  });
});

describe('D-7 「バトルする時」「バトルの後」(115.2 / 115.3a / 701.13d)', () => {
  it('バトルする時の効果で、どちらかが場を離れていれば、バトルは行われない', () => {
    const sim = new Sim({ p0: { battle: ['ヨビニオン・マルル'] }, p1: { battle: [{ c: 't-bs-bounce', tapped: true }], shield: 5 } }, R);
    sim.attack('ヨビニオン・マルル', 't-bs-bounce');
    sim.drain();
    expect(labels(sim).some((l) => l.includes('T:バトルする時'))).toBe(true);
    expect(sim.has(0, 'hand', 'ヨビニオン・マルル')).toBe(true);
    expect(sim.has(1, 'battle', 't-bs-bounce')).toBe(true); // パワーで負けるはずだが、バトルが行われず残る
    expect(sim.evs('battleEnded').length).toBe(0);
  });
  it('バトルの後の効果は、勝敗の処理の後に誘発する', () => {
    const sim = new Sim({ p0: { battle: ['t-after'] }, p1: { battle: [{ c: 'ヨビニオン・マルル', tapped: true }], shield: 5 } }, R);
    sim.attack('t-after', 'ヨビニオン・マルル');
    sim.drain();
    const ls = labels(sim);
    expect(ls.some((l) => l.includes('T:バトルの後'))).toBe(true);
    const types = sim.s.turnLog.map((e) => e.type);
    expect(types.indexOf('afterBattle')).toBeGreaterThan(types.indexOf('battleEnded'));
  });
});

describe('D-9 呪文自身の効果による置換(409.2b / 609.8a)', () => {
  it('唱えた呪文は、墓地のかわりに、自身の置換効果でマナゾーンに置かれる', () => {
    const sim = new Sim({ p0: { hand: ['t-charger'], mana: mana(1) } }, R);
    sim.play('t-charger');
    sim.drain();
    expect(sim.has(0, 'mana', 't-charger')).toBe(true);
    expect(sim.count(0, 'grave', 't-charger')).toBe(0);
  });
});

describe('D-16 使用宣言の順序(506.3b〜e)', () => {
  it('非ターン・プレイヤーの宣言は、ターン・プレイヤーの待機中の効果を解決し終えた後に聞かれる', () => {
    const sim = new Sim({ p0: { battle: ['t-atk'] }, p1: { hand: ['t-ntp-declare'], shield: 5 } }, R);
    sim.attack('t-atk', 'player');
    // 攻撃する時の効果(ターン・プレイヤー)が先に解決され、その後に、非ターン・プレイヤーの宣言を聞く
    expect(sim.pending.why).toBe('may');
    expect(sim.pending.player).toBe(1);
    expect(sim.evs('resolve').some((e) => String(e.label).includes('T:攻撃する時'))).toBe(true);
    sim.yes();
    expect(labels(sim).some((l) => l.includes('T:相手の攻撃に宣言'))).toBe(true);
  });
});
