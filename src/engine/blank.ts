// 無能力のカード(カード単体の強さの測定で、カードを差し替える先)。
// 元のカードと同じコスト・文明の、能力のないクリーチャー。マナカーブと文明の構成を保ったまま、カードの「能力だけ」を取り除ける。
import { CIVS, CIV_LABEL, type CardDB, type CardDef, type Civ } from './types';

export const BLANK_PREFIX = 'blank-';

export const isBlankId = (id: string): boolean => id.startsWith(BLANK_PREFIX);

/** 無能力カードのパワー。コスト × 1000(最低 1000)。能力のないクリーチャーとしての標準的な体 */
export const blankPower = (cost: number): number => Math.max(1000, cost * 1000);

/** カードを差し替える先の(コスト, 文明)。コストは先頭の面(ツインパクトならクリーチャー面)、文明は全面の和 */
function blankKey(def: CardDef): { cost: number; civs: Civ[] } {
  return { cost: def.faces[0].cost, civs: CIVS.filter((c) => def.faces.some((f) => f.civs.includes(c))) };
}

const idOf = (cost: number, civs: Civ[]): string => `${BLANK_PREFIX}${cost}-${civs.join('+')}`;

/** そのカードを差し替える無能力カードの ID */
export function blankId(def: CardDef): string {
  const { cost, civs } = blankKey(def);
  return idOf(cost, civs);
}

/** 差し替え先の ID(登録されていなければ、何もしない dummy) */
export function blankFor(defs: CardDB, defId: string): string {
  const def = defs[defId];
  if (!def) return 'dummy';
  const id = blankId(def);
  return defs[id] ? id : 'dummy';
}

/** 与えたカード定義のすべての(コスト, 文明)に対する無能力カードを作る(重複なし・出現順) */
export function blankDefsFor(defs: CardDef[]): CardDef[] {
  const seen = new Map<string, CardDef>();
  for (const def of defs) {
    if (def.id === 'dummy' || def.id === '?' || isBlankId(def.id) || !def.faces.length) continue;
    const { cost, civs } = blankKey(def);
    if (cost >= 99 || seen.has(idOf(cost, civs))) continue;
    const id = idOf(cost, civs);
    const label = civs.map((c) => CIV_LABEL[c]).join('');
    seen.set(id, {
      id,
      name: `無能力(${label}${cost})`,
      text: 'カード単体の強さの測定で、カードを差し替える何もしないクリーチャー(コスト・文明は元のカードに合わせる)。',
      faces: [{ name: `無能力(${label}${cost})`, type: 'creature', cost, civs, power: blankPower(cost), races: [], abilities: [] }],
    });
  }
  return [...seen.values()];
}
