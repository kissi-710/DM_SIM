// 呪文が「相手のクリーチャーがいなければ空振りになる」かの判定(L1 が、相手の盤面が空の時に避ける)
import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../../src/cards';
import { spellNeedsOpponentCreature } from '../../src/ai/spellTargets';
import { loadRegistry } from '../../src/engine/registry';
import type { CardDB, CardDef } from '../../src/engine/types';

const spell = (id: string, steps: unknown[]): CardDef =>
  ({ id, name: id, faces: [{ name: id, type: 'spell', cost: 2, civs: ['fire'], abilities: [{ kind: 'spell', steps }] }] }) as unknown as CardDef;
const selOpp = { op: 'select', as: '$t', from: { zone: 'battle', owner: 'opponent', type: 'creature', chooseable: true }, min: 1, max: 1 };
const destroy = { op: 'act', act: { move: { sel: '$t', to: 'grave', cause: 'destroy' } } };
const draw = { op: 'act', act: { draw: 1 } };

const db: CardDB = {
  kill: spell('kill', [selOpp, destroy]),
  mass: spell('mass', [{ op: 'act', act: { move: { sel: { zone: 'battle', owner: 'opponent' }, to: 'grave', cause: 'destroy' } } }]),
  draw: spell('draw', [draw]),
  optional: spell('optional', [{ ...selOpp, min: 0 }, destroy]),
  allModes: spell('allModes', [{ op: 'modes', pick: 1, options: [{ steps: [selOpp, destroy] }, { steps: [selOpp, destroy] }] }]),
  mixedModes: spell('mixedModes', [{ op: 'modes', pick: 1, options: [{ steps: [selOpp, destroy] }, { steps: [draw] }] }]),
  drawThenKill: spell('drawThenKill', [draw, selOpp, destroy]),
  selfHand: spell('selfHand', [{ op: 'select', as: '$h', from: { zone: 'hand', owner: 'self' }, min: 1, max: 1 }, destroy]),
};
const reg = loadRegistry(db);

describe('spellNeedsOpponentCreature(データから判定)', () => {
  it('最初の効果が、相手のクリーチャーを選ぶ・直接指定する呪文は、いなければ空振り', () => {
    expect(spellNeedsOpponentCreature(reg, 'kill', 0)).toBe(true);
    expect(spellNeedsOpponentCreature(reg, 'mass', 0)).toBe(true);
    expect(spellNeedsOpponentCreature(reg, 'allModes', 0)).toBe(true);
  });
  it('対象なしで効果がある呪文は、空振りにならない(ドロー・選ばなくてよい・一部の選択肢・先に効果がある)', () => {
    for (const id of ['draw', 'optional', 'mixedModes', 'drawThenKill', 'selfHand']) expect(spellNeedsOpponentCreature(reg, id, 0)).toBe(false);
  });
});

describe('実際のカード: 説明文の「戻・破壊・選び」に反応していた呪文は、対象なしでも効果がある', () => {
  const real = loadRegistry(CARD_DB);
  const needs = (name: string, face: number) => {
    const d = Object.values(real.defs).find((x) => x.name === name || x.faces.some((f) => f.name === name))!;
    return spellNeedsOpponentCreature(real, d.id, face);
  };
  it('G・ストライクの文言や、手札を捨てさせる効果は、相手のクリーチャーを要しない', () => {
    expect(needs('フェアリー・Re:ライフ', 0)).toBe(false);
    expect(needs('ロスト・Re:ソウル', 0)).toBe(false);
    expect(needs('「この先は修羅の道ぞ」', 0)).toBe(false);
    expect(needs('ドンドン火噴くナウ', 0)).toBe(false);
  });
});
