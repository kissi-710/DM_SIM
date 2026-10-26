// 同じ攻撃を選び続けて試合が終わらないのを防ぐ(withLoopGuard)。
import { describe, expect, it } from 'vitest';
import type { Action } from '../../src/engine/types';
import type { Agent } from '../../src/ai/types';
import { withLoopGuard } from '../../src/ai/loopGuard';

const atkC: Action = { type: 'ATTACK', attacker: 14, target: { kind: 'creature', pid: 4 } };
const atkP: Action = { type: 'ATTACK', attacker: 14, target: { kind: 'player' } };
const end: Action = { type: 'END_TURN' };
// 常に最初の候補を選ぶ AI(毎回同じ攻撃を選び続ける)
const first: Agent = { name: 'first', policy: undefined as never, chooseAction: (_v, l) => l[0] };
const view = (turn: number) => ({ turn }) as never;
const ctx = {} as never;

describe('withLoopGuard', () => {
  it('同じクリーチャーへの攻撃は 1 ターンに 2 回まで。3 回目は候補から外れる', () => {
    const ag = withLoopGuard(first);
    expect(ag.chooseAction(view(3), [atkC, atkP, end], ctx)).toEqual(atkC);
    expect(ag.chooseAction(view(3), [atkC, atkP, end], ctx)).toEqual(atkC);
    expect(ag.chooseAction(view(3), [atkC, atkP, end], ctx)).toEqual(atkP);
  });
  it('ターンが変われば数え直す', () => {
    const ag = withLoopGuard(first);
    ag.chooseAction(view(3), [atkC, end], ctx);
    ag.chooseAction(view(3), [atkC, end], ctx);
    expect(ag.chooseAction(view(4), [atkC, end], ctx)).toEqual(atkC);
  });
  it('プレイヤーへの攻撃は 8 回まで(シールドを順に割る連続攻撃を妨げない)', () => {
    const ag = withLoopGuard(first);
    for (let i = 0; i < 8; i++) expect(ag.chooseAction(view(5), [atkP, end], ctx)).toEqual(atkP);
    expect(ag.chooseAction(view(5), [atkP, end], ctx)).toEqual(end);
  });
});
