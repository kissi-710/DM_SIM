// ブロック(総合ルール 507)の挙動を、テストで固定する。
// 507.1a(選べないもの)・507.2c(ブロックされたままになる)・ブロッカーのタップ。
import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../../src/cards';
import { loadRegistry } from '../../src/engine/registry';
import type { CardDB, CardDef } from '../../src/engine/types';
import { Sim } from '../scenario';

// 「ブロックされた時、相手のクリーチャーを1体破壊する」攻撃クリーチャー(ブロッカーを破壊できる)
const T_KILLER: CardDef = {
  id: 't-block-killer',
  name: 'Tブロック破壊',
  faces: [
    {
      name: 'Tブロック破壊',
      type: 'creature',
      cost: 1,
      civs: ['fire'],
      power: 1000,
      races: [],
      abilities: [
        {
          kind: 'trigger',
          spec: { on: { type: 'blocked', role: 'attacker' }, subject: 'any' },
          steps: [
            { op: 'select', as: '$t', from: { zone: 'battle', owner: 'opponent', type: 'creature' }, min: 1, max: 1 },
            { op: 'act', act: { move: { sel: '$t', to: 'grave', cause: 'destroy' } } },
          ],
        },
      ],
    },
  ],
} as unknown as CardDef;

// ブロッカーに負ける、能力のない攻撃クリーチャー
const T_WEAK: CardDef = {
  id: 't-block-weak',
  name: 'T弱い攻撃',
  faces: [{ name: 'T弱い攻撃', type: 'creature', cost: 1, civs: ['fire'], power: 1000, races: [], abilities: [] }],
} as unknown as CardDef;

const DB: CardDB = { ...CARD_DB, [T_KILLER.id]: T_KILLER, [T_WEAK.id]: T_WEAK };
const R = loadRegistry(DB);

describe('507 ブロック', () => {
  it('ブロックしたブロッカーはタップする', () => {
    const sim = new Sim({ p0: { battle: ['t-block-weak'] }, p1: { battle: ['ティンパニ=シンバリー'], shield: 5 } }, R);
    sim.attack('t-block-weak', 'player');
    sim.pick('ティンパニ=シンバリー'); // 1000 vs 4000: ブロッカーが勝って場に残る
    expect(sim.count(1, 'shield')).toBe(5);
    expect(sim.s.players[1].battle[0].tapped).toBe(true);
  });

  it('タップ状態のブロッカーはブロックできない(ブロックを聞かれず、シールドが割られる)', () => {
    const sim = new Sim({
      p0: { battle: ['ヨビニオン・マルル'] },
      p1: { battle: [{ c: 'ティンパニ=シンバリー', tapped: true }], shield: 5 },
    });
    sim.attack('ヨビニオン・マルル', 'player');
    expect(sim.s.pending?.why).not.toBe('block');
    expect(sim.count(1, 'shield')).toBe(4);
  });

  it('ブロッカーでないクリーチャーは候補に出ない(ブロックを聞かれない)', () => {
    const sim = new Sim({ p0: { battle: ['ヨビニオン・マルル'] }, p1: { battle: ['ヨビニオン・トライブ'], shield: 5 } });
    sim.attack('ヨビニオン・マルル', 'player');
    expect(sim.s.pending?.why).not.toBe('block');
    expect(sim.count(1, 'shield')).toBe(4);
  });

  it('507.2c ブロッカーが取り除かれても、ブロックされたままなので、シールドは割れず攻撃は終わる', () => {
    const sim = new Sim({ p0: { battle: ['t-block-killer'] }, p1: { battle: ['ティンパニ=シンバリー'], shield: 5 } }, R);
    sim.attack('t-block-killer', 'player');
    sim.pick('ティンパニ=シンバリー'); // ブロックされた時の誘発で、そのブロッカーが破壊される
    sim.drain();
    expect(sim.has(1, 'grave', 'ティンパニ=シンバリー')).toBe(true);
    expect(sim.count(1, 'shield')).toBe(5);
    expect(sim.s.winner).toBeNull();
  });
});
