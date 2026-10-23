// L1 ルールベースAIは、クロスギアをクロスし、ハイパー化できるなら攻撃の前にハイパー化する(25の王道の行動)。
import { describe, expect, it } from 'vitest';
import { chooseTurnAction } from '../../src/ai/rulebased';
import { mulberry } from '../../src/sim/playGame';
import { Sim, mana, reg } from '../scenario';

const choose = (sim: Sim) => chooseTurnAction(sim.s, sim.legal(), { rand: mulberry(1), reg });

describe('ルールベースAI: クロス・ハイパー化', () => {
  it('クロスギアを出した後、クロスできるなら、クロスする(攻撃や終了より先)', () => {
    const sim = new Sim({ p0: { hand: ['竜装 ゴウソク・タキオンアーマー'], battle: [{ c: '爆炎ホワイトグレンオー' }], mana: mana(4, 'ドンドン火噴くナウ') } });
    sim.play('竜装 ゴウソク・タキオンアーマー');
    expect(choose(sim).type).toBe('CROSS');
  });
  it('ハイパー化できるなら、攻撃の前にハイパー化する', () => {
    const sim = new Sim({ p0: { battle: [{ c: '獲銀月 ペトローバ' }, { c: 'アクアン' }] } });
    expect(choose(sim).type).toBe('HYPERIZE');
  });
});
