import { describe, expect, it } from 'vitest';
import { CARD_DB, CARD_LIST } from '../../src/cards';
import { blankDefsFor, blankFor, blankId, blankPower, isBlankId } from '../../src/engine/blank';
import { loadRegistry } from '../../src/engine/registry';

describe('無能力カード(カード単体の強さの差し替え先)', () => {
  const defs = blankDefsFor(CARD_LIST);

  it('実在するカードの(コスト, 文明)ごとに、重複なく1つずつ作られる', () => {
    expect(defs.length).toBeGreaterThan(0);
    expect(new Set(defs.map((d) => d.id)).size).toBe(defs.length);
    expect(defs.every((d) => isBlankId(d.id))).toBe(true);
  });
  it('能力なし・クリーチャー。コスト・文明は元のカードに合い、パワーはコスト × 1000(最低 1000)', () => {
    for (const d of defs) {
      expect(d.faces).toHaveLength(1);
      const f = d.faces[0];
      expect(f.type).toBe('creature');
      expect(f.abilities).toEqual([]);
      expect(f.power).toBe(blankPower(f.cost));
    }
    expect(blankPower(0)).toBe(1000);
    expect(blankPower(5)).toBe(5000);
  });
  it('どの実在カードにも、同じコスト・文明の差し替え先が CARD_DB に登録されている', () => {
    for (const c of CARD_LIST) {
      if (c.id === 'dummy') continue;
      const to = blankFor(CARD_DB, c.id);
      // コスト99以上のカード(他の効果で、コストを支払わずに使う前提のもの)は、差し替え先がなく、dummy になる
      if (c.faces[0].cost >= 99) {
        expect(to).toBe('dummy');
        continue;
      }
      expect(to).toBe(blankId(c));
      const f = CARD_DB[to].faces[0];
      expect(f.cost).toBe(c.faces[0].cost);
      // 文明は全面の和
      const civs = new Set(c.faces.flatMap((x) => x.civs));
      expect(new Set(f.civs)).toEqual(civs);
    }
  });
  it('未登録のカード・dummy は dummy に差し替える', () => {
    expect(blankFor(CARD_DB, 'nope')).toBe('dummy');
    expect(blankFor(CARD_DB, 'dummy')).toBe('dummy');
    expect(blankFor({ x: CARD_LIST.find((c) => c.id !== 'dummy')! }, 'x')).toBe('dummy');
  });
  it('レジストリに載る(不明カードの「?」と dummy を含めて、実在 + 無能力 + 1)', () => {
    const reg = loadRegistry(CARD_DB);
    expect(Object.keys(reg.defs)).toHaveLength(CARD_LIST.length + defs.length + 1);
  });
});
