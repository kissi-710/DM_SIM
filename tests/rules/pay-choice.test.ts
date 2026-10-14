// 支払いの選択肢(UI が「聞くか自動で払うか」を決める自明判定)のテスト
import { describe, expect, it } from 'vitest';
import { payChoice } from '../../src/engine/procs';
import { mkCtx } from '../../src/engine/state';
import { Sim, mana, reg } from '../scenario';

const DEDADAM = '天災 デドダム'; // 水・闇・自然 / コスト3
const WATER = 'アクアン'; // 水
const DARK = 'ティンパニ=シンバリー'; // 闇
const NATURE = 'フェアリー・ライフ'; // 自然 / コスト2

function choice(sim: Sim, name: string) {
  const uid = sim.uid(0, 'hand', name);
  return payChoice(mkCtx(sim.s, reg), 0, uid, 'hand', 0, undefined, false);
}

describe('payChoice: 支払いに選択があるか', () => {
  it('マナが必要枚数ちょうどなら、自明(選びようがない)', () => {
    const sim = new Sim({ p0: { hand: [NATURE], mana: [NATURE, NATURE] } });
    const c = choice(sim, NATURE);
    expect(c.need).toBe(2);
    expect(c.obvious).toBe(true);
  });
  it('同じ文明のマナしかなければ、何枚あっても自明', () => {
    const sim = new Sim({ p0: { hand: [NATURE], mana: [NATURE, NATURE, NATURE, NATURE] } });
    expect(choice(sim, NATURE).obvious).toBe(true);
  });
  it('異なる文明のマナが余るなら、どれを払うか選べる(自明でない)', () => {
    // 自然のカード(コスト2)を、自然・自然・水・闇のマナから払う
    const sim = new Sim({ p0: { hand: [NATURE], mana: [NATURE, NATURE, WATER, DARK] } });
    const c = choice(sim, NATURE);
    expect(c.obvious).toBe(false);
    expect(c.auto.length).toBe(2);
    expect(c.avail.length).toBe(4);
  });
  it('文明の制約で払い方が1通りに決まるなら自明', () => {
    // 3文明のデドダムを「水・闇・自然」の3枚から払う: 全部使うしかない
    const sim = new Sim({ p0: { hand: [DEDADAM], mana: [WATER, DARK, NATURE] } });
    expect(choice(sim, DEDADAM).obvious).toBe(true);
  });
  it('払えないなら、選択はない(自明として扱い、通常の「プレイ不可」に任せる)', () => {
    const sim = new Sim({ p0: { hand: [NATURE], mana: mana(1) } });
    const c = choice(sim, NATURE);
    expect(c.obvious).toBe(true);
    expect(c.auto).toEqual([]);
  });
});
