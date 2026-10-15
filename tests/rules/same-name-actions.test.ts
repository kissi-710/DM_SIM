// 同名カードを複数枚持っている時、どの札もマナチャージ・召喚できること。
// legalActions は AI の分岐を減らすため同名を1枚に間引く。UI は札ごとに行き先を引くので、
// expandSameNameActions で広げた手に、すべての札が含まれる必要がある。
import { describe, expect, it } from 'vitest';
import { expandSameNameActions } from '../../src/engine/legal';
import { validateAction } from '../../src/engine/legal';
import { reg, Sim, mana } from '../scenario';

describe('同名カードの合法手(UI 用の展開)', () => {
  it('インターステラ: 手札に4枚あれば、4枚ともマナチャージできる', () => {
    const name = '偽りの月 インターステラ';
    const sim = new Sim({ step: 'mana', p0: { hand: [name, name, name, name] } });
    const raw = sim.legal().filter((a) => a.type === 'CHARGE_MANA');
    expect(raw).toHaveLength(1); // 間引かれている(AI 用)
    const all = expandSameNameActions(sim.s, reg, sim.legal()).filter((a) => a.type === 'CHARGE_MANA');
    expect(new Set(all.map((a) => (a as { uid: number }).uid))).toEqual(new Set(sim.s.players[0].hand));
  });

  it('全カード: 手札に2枚あれば、2枚ともマナチャージできる', () => {
    const bad: string[] = [];
    for (const def of Object.values(reg.defs)) {
      const sim = new Sim({ step: 'mana', p0: { hand: [def.name, def.name] } });
      const hand = sim.s.players[0].hand;
      const got = new Set(
        expandSameNameActions(sim.s, reg, sim.legal())
          .filter((a) => a.type === 'CHARGE_MANA')
          .map((a) => (a as { uid: number }).uid),
      );
      if (!hand.every((u) => got.has(u))) bad.push(def.name);
      for (const a of expandSameNameActions(sim.s, reg, sim.legal())) expect(validateAction(sim.s, reg, a)).toBeNull();
    }
    expect(bad).toEqual([]);
  });

  it('召喚: 手札に同名が2枚あれば、どちらも召喚できる', () => {
    const sim = new Sim({ p0: { hand: ['アクアン', 'アクアン'], mana: ['アクアン', 'ロスト・Re:ソウル', ...mana(5)] } });
    const plays = expandSameNameActions(sim.s, reg, sim.legal()).filter((a) => a.type === 'PLAY_CARD');
    const uids = new Set(plays.map((a) => (a as { uid: number }).uid));
    expect(uids).toEqual(new Set(sim.s.players[0].hand));
  });
});
