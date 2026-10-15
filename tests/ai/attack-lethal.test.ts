// L1 ルールベースAIの「勝ち確定の攻撃」判定(攻撃時の判断)を固定する。
// ダイレクトアタックには、シールドを割り切るための攻撃と、最後の1体(ダイレクトアタック役)が要る。
import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../../src/cards';
import { chooseTurnAction } from '../../src/ai/rulebased';
import { legalActions } from '../../src/engine/engine';
import { loadRegistry } from '../../src/engine/registry';
import type { Action, CardDB, CardDef, GameState } from '../../src/engine/types';
import { mulberry } from '../../src/sim/playGame';
import { buildState } from '../scenario';

/** パワーが低い W・ブレイカー(ブロッカーに受けられると負ける) */
const T_WEAK_W: CardDef = {
  id: 't-weak-w',
  name: 'T弱いW',
  faces: [
    { name: 'T弱いW', type: 'creature', cost: 1, civs: ['fire'], power: 2000, races: [], abilities: [{ kind: 'keyword', name: 'breaker', n: 2 }] },
  ],
} as unknown as CardDef;

const DB: CardDB = { ...CARD_DB, [T_WEAK_W.id]: T_WEAK_W };
const R = loadRegistry(DB);
const choose = (s: GameState): Action => chooseTurnAction(s, legalActions(s, R), { rand: mulberry(1), reg: R });

describe('勝ち確定の攻撃の判定', () => {
  it('1体しか通らないなら、シールドを割り切っても勝てないので、ブロッカーに負ける攻撃はしない', () => {
    // W・ブレイカー2体のうち1体はブロックされ、通る1体がシールド1枚を割るだけ(ダイレクトアタックの攻撃役がいない)
    const s = buildState({
      p0: { battle: ['t-weak-w', 't-weak-w'] },
      p1: { battle: ['ティンパニ=シンバリー'], shield: 1 },
    }, R);
    expect(choose(s)).toEqual({ type: 'END_TURN' });
  });
  it('割り切って、さらに最後の1体が残るなら、弱い攻撃でも仕掛ける', () => {
    // 3体のうち1体はブロックされ、通る2体が W・ブレイカー(2枚)+最後の1体でダイレクトアタック
    const s = buildState({
      p0: { battle: ['t-weak-w', 't-weak-w', 't-weak-w'] },
      p1: { battle: ['ティンパニ=シンバリー'], shield: 2 },
    }, R);
    expect(choose(s)).toMatchObject({ type: 'ATTACK', target: { kind: 'player' } });
  });
  it('「ブロックされない」攻撃は、ブロッカーがいても仕掛ける', () => {
    // 轟く革命 レッドギラゾーン(タップ状態)が、自分のコマンドに「ブロックされない」を与える
    const s = buildState({
      p0: { battle: [{ c: '轟く革命 レッドギラゾーン', tapped: true }, { c: '天災 デドダム', sick: false }] },
      p1: { battle: ['ティンパニ=シンバリー'], shield: 5 },
    }, R);
    expect(choose(s)).toMatchObject({ type: 'ATTACK', target: { kind: 'player' } });
  });
});
