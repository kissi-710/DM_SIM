// クロス済みのクロスギアの再クロスを、探索の候補から外す(freeCross のデッキで、同じ手を選び続けて試合が終わらなかった)。
import { describe, expect, it } from 'vitest';
import type { Action } from '../../src/engine/types';
import { dropRecross } from '../../src/ai/mcts';

const view = (crossedOn: number | undefined) => ({
  pending: { player: 0 },
  players: [{ battle: [{ pid: 6, crossedOn }, { pid: 8 }, { pid: 9 }] }, { battle: [] }],
});
const legal: Action[] = [
  { type: 'CROSS', gear: 6, target: 9 },
  { type: 'CROSS', gear: 7, target: 8 },
  { type: 'END_MAIN' },
];

describe('dropRecross', () => {
  it('クロスしているギアの再クロスだけを外す(まだクロスしていないギアのクロスは残す)', () => {
    expect(dropRecross(view(8), legal)).toEqual([legal[1], legal[2]]);
  });
  it('どのギアもクロスしていなければ、そのまま', () => {
    expect(dropRecross(view(undefined), legal)).toBe(legal);
  });
  it('外すと候補が空になる時は、そのまま返す', () => {
    const only: Action[] = [{ type: 'CROSS', gear: 6, target: 9 }];
    expect(dropRecross(view(8), only)).toBe(only);
  });
});
