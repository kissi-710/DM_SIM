// ターン終了の確認を出す理由(うっかりの時だけ止める)
import { describe, expect, it } from 'vitest';
import type { Action, GameState } from '../../src/engine/types';
import { endTurnWarning } from '../../src/ui/endTurn';

const st = (turnLog: Array<Record<string, unknown>>) => ({ turnLog: turnLog.map((e, i) => ({ id: i, causedBy: null, turn: 1, ...e })) }) as unknown as GameState;
const play: Action = { type: 'PLAY_CARD', uid: 1 };
const charge: Action = { type: 'CHARGE_MANA', uid: 1 };
const end: Action = { type: 'END_TURN' };

describe('endTurnWarning', () => {
  it('マナチャージがまだできるなら、止める', () => {
    expect(endTurnWarning(st([]), [charge, { type: 'SKIP_MANA' }], 0)).toMatch(/マナチャージ/);
  });
  it('出せるカードがあるのに、このターン何もしていないなら止める', () => {
    expect(endTurnWarning(st([]), [play, end], 0)).toMatch(/何もしていません/);
  });
  it('このターンに自分が1つでもカードを出す・唱える・攻撃していれば、残りの手札では止めない', () => {
    for (const type of ['cast', 'entered', 'attackDeclared']) {
      expect(endTurnWarning(st([{ type, owner: 0 }]), [play, end], 0)).toBeNull();
    }
  });
  it('相手の行動は「何かした」に数えない', () => {
    expect(endTurnWarning(st([{ type: 'cast', owner: 1 }]), [play, end], 0)).toMatch(/何もしていません/);
  });
  it('出せるカードもチャージもなければ止めない', () => {
    expect(endTurnWarning(st([]), [end], 0)).toBeNull();
  });
});
