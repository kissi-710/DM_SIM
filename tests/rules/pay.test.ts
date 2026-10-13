import { describe, expect, it } from 'vitest';
import { Sim, mana } from '../scenario';

const D = 'ロスト・Re:ソウル';

describe('マナの手動支払い(spec 3.4)', () => {
  it('選んだマナがタップされる', () => {
    const sim = new Sim({ p0: { hand: ['ヨビニオン・マルル'], mana: mana(6) } });
    const pay = sim.s.players[0].mana.slice(2, 6);
    sim.play('ヨビニオン・マルル', { extra: { pay } });
    if (sim.s.pending?.why === 'may') sim.no();
    for (const u of pay) expect(sim.s.cards[u].tapped).toBe(true);
    expect(sim.tappedMana(0)).toBe(4);
  });
  it('枚数が違う・使えないマナ・文明が足りない支払いは受け付けない', () => {
    const sim = new Sim({ p0: { hand: ['ティンパニ=シンバリー'], mana: [D, ...mana(5)] } });
    const m = sim.s.players[0].mana;
    expect(() => sim.play('ティンパニ=シンバリー', { extra: { pay: m.slice(0, 3) } })).toThrow(); // 枚数
    expect(() => sim.play('ティンパニ=シンバリー', { extra: { pay: m.slice(1, 5) } })).toThrow(); // 闇がない
    sim.play('ティンパニ=シンバリー', { extra: { pay: m.slice(0, 4) } });
    expect(sim.has(0, 'battle', 'ティンパニ=シンバリー')).toBe(true);
  });
});
