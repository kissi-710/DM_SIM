// ドロップ先マップ: ハイパー化・クロス(25の王道で増えた行動)にも、行き先と表示名が付く。
import { describe, expect, it } from 'vitest';
import { buildDropMap } from '../../src/ui/dropMap';
import { Sim, mana } from '../scenario';

const PETRO = '獲銀月 ペトローバ';
const GOUSOKU = '竜装 ゴウソク・タキオンアーマー';
const GRENOH = '爆炎ホワイトグレンオー';

describe('dropMap: 25の王道の行動', () => {
  it('ハイパー化は、そのクリーチャーの山から「バトルゾーン」へドロップする', () => {
    const sim = new Sim({ p0: { battle: [{ c: PETRO }, { c: 'アクアン' }] } });
    const drops = buildDropMap(sim.s, sim.legal()).get(`pile:${sim.pid(0, PETRO)}`) ?? [];
    expect(drops.some((d) => d.action.type === 'HYPERIZE' && d.dropKey === 'zone:battle' && d.label.startsWith('ハイパー化: '))).toBe(true);
  });
  it('クロスは、クロスギアの山から、クロス先の山へドロップする', () => {
    const sim = new Sim({ p0: { hand: [GOUSOKU], battle: [{ c: GRENOH }], mana: mana(4, 'ドンドン火噴くナウ') } });
    sim.play(GOUSOKU);
    const gear = sim.pid(0, GOUSOKU);
    const host = sim.pid(0, GRENOH);
    const drops = buildDropMap(sim.s, sim.legal()).get(`pile:${gear}`) ?? [];
    const d = drops.find((x) => x.action.type === 'CROSS');
    expect(d?.dropKey).toBe(`pile:${host}`);
    expect(d?.label).toBe(`クロス → ${GRENOH}`);
  });
});
