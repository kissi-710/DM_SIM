// 攻撃(総合ルール 505〜509)のうち、「攻撃する時」の誘発で攻撃の前提が変わる場面を、テストで固定する。
// 505.6a: 攻撃クリーチャー・攻撃先のクリーチャーが「その攻撃」から取り除かれたら、攻撃は即座に終わる。
import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../../src/cards';
import { loadRegistry } from '../../src/engine/registry';
import type { CardDB, CardDef } from '../../src/engine/types';
import { step } from '../../src/engine/engine';
import { Sim, reg } from '../scenario';

/** 「攻撃する時、クリーチャーを1体まで選び、持ち主の手札に戻す」攻撃クリーチャー */
const T_BOUNCER: CardDef = {
  id: 't-atk-bounce',
  name: 'T攻撃時バウンス',
  faces: [
    {
      name: 'T攻撃時バウンス',
      type: 'creature',
      cost: 1,
      civs: ['water'],
      power: 3000,
      races: [],
      abilities: [
        { kind: 'keyword', name: 'breaker', n: 2 },
        {
          kind: 'trigger',
          spec: { on: { type: 'attackDeclared' }, subject: 'self' },
          steps: [
            { op: 'select', as: '$t', from: { zone: 'battle', owner: 'any', type: 'creature' }, min: 0, max: 1 },
            { op: 'act', act: { move: { sel: '$t', to: 'hand', cause: 'bounce' } } },
          ],
        },
      ],
    },
  ],
} as unknown as CardDef;

const DB: CardDB = { ...CARD_DB, [T_BOUNCER.id]: T_BOUNCER };
const R = loadRegistry(DB);

const setup = (p1: any) => new Sim({ p0: { battle: ['t-atk-bounce'] }, p1 }, R);

describe('攻撃する時の誘発で攻撃の前提が変わる', () => {
  it('攻撃クリーチャー自身が手札に戻ったら、攻撃は終わり、シールドは割れない(505.6a)', () => {
    const sim = setup({ battle: ['ティンパニ=シンバリー'], shield: 5 });
    sim.attack('t-atk-bounce', 'player');
    sim.pick('t-atk-bounce');
    sim.drain();
    expect(sim.has(0, 'hand', 't-atk-bounce')).toBe(true);
    expect(sim.count(1, 'shield')).toBe(5);
    expect(sim.s.pending?.why).not.toBe('block');
  });

  it('攻撃先のクリーチャーが手札に戻ったら、攻撃は終わる(バトルしない)', () => {
    const sim = setup({ battle: [{ c: 'ヨビニオン・マルル', tapped: true }], shield: 5 });
    sim.attack('t-atk-bounce', 'ヨビニオン・マルル');
    sim.pick('ヨビニオン・マルル');
    sim.drain();
    expect(sim.has(1, 'hand', 'ヨビニオン・マルル')).toBe(true);
    expect(sim.has(0, 'battle', 't-atk-bounce')).toBe(true);
    expect(sim.count(1, 'shield')).toBe(5);
  });

  it('相手のブロッカーが手札に戻れば、ブロックは聞かれず、シールドが割られる', () => {
    const sim = setup({ battle: ['ティンパニ=シンバリー'], shield: 5 });
    sim.attack('t-atk-bounce', 'player');
    sim.pick('ティンパニ=シンバリー');
    sim.drain();
    expect(sim.s.pending?.why).not.toBe('block');
    expect(sim.count(1, 'shield')).toBe(3); // W・ブレイカー
  });
});

// 手札で誘発する侵略・革命チェンジは、どの効果を解決するより前に使用宣言する(506.3b。公式Q&A 40435 / 42940)。
// 宣言したものは取りやめられず、宣言しなかったものは誘発しなかったことになる。
describe('使用宣言が必要な能力(侵略)', () => {
  const setup = () =>
    new Sim({
      p0: { battle: ['天災 デドダム'], hand: ['SSS級天災 デッドダムド'] },
      p1: { battle: ['ヨビニオン・マルル'], shield: 5 },
    });
  it('攻撃の宣言の直後に、使用宣言を聞かれる', () => {
    const sim = setup();
    sim.attack('天災 デドダム', 'player');
    expect(sim.pending.why).toBe('may');
    expect(sim.pending.player).toBe(0);
    expect(sim.s.players[0].battle[0].cards.length).toBe(1); // まだ重なっていない
  });
  it('宣言しなければ、侵略されず、解決の途中でも聞き直されない', () => {
    const sim = setup();
    sim.attack('天災 デドダム', 'player');
    sim.no();
    expect(sim.s.pending?.why).not.toBe('may');
    sim.drain();
    expect(sim.s.players[0].battle[0].cards.length).toBe(1);
    expect(sim.has(0, 'hand', 'SSS級天災 デッドダムド')).toBe(true);
    expect(sim.count(1, 'shield')).toBe(4); // 攻撃は続いて、デドダムが1枚割る
  });
  it('宣言したら取りやめられない: 重なった後に「してもよい」の確認を重ねない', () => {
    const sim = setup();
    sim.attack('天災 デドダム', 'player');
    sim.yes();
    expect(sim.s.players[0].battle[0].cards.length).toBe(2);
    expect(sim.pending.why).not.toBe('may');
  });
  it('使用宣言を確定しても、入力の状態は書き換わらない(step は純粋)', () => {
    const sim = setup();
    sim.attack('天災 デドダム', 'player');
    const before = JSON.stringify(sim.s);
    step(sim.s, { type: 'ANSWER', id: sim.pending.id, value: true }, reg);
    expect(JSON.stringify(sim.s)).toBe(before);
  });
});
