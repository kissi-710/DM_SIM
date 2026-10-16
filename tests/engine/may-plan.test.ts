// 任意効果(may)の聞き方と、選択の自明判定(docs/effects.md 11.6)。
// 判定はエンジン側の関数(vm.ts の planMay / interchangeable)で、ここでは結果の質問で固定する。
import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../../src/cards';
import type { StepDef } from '../../src/engine/ast';
import { loadRegistry } from '../../src/engine/registry';
import type { CardDB, CardDef } from '../../src/engine/types';
import { Sim, type Setup } from '../scenario';

const act = (a: Record<string, any>): StepDef => ({ op: 'act', act: a });
const spell = (id: string, steps: StepDef[]): CardDef => ({
  id,
  name: id,
  faces: [{ name: id, type: 'spell', cost: 1, civs: ['nature'], abilities: [{ kind: 'spell', steps }] }],
});
const creature = (id: string, abilities: any[] = []): CardDef => ({
  id,
  name: id,
  faces: [{ name: id, type: 'creature', cost: 1, civs: ['nature'], power: 1000, abilities }],
});
const onEntered = (steps: StepDef[], optional = false) => ({
  kind: 'trigger',
  optional,
  label: '相手を手札に戻す',
  spec: { on: { type: 'entered' }, subject: 'self' },
  steps,
});

const oppCreature = { zone: 'battle', owner: 'opponent', type: 'creature' };
const bounce: StepDef[] = [
  { op: 'select', as: '$t', from: oppCreature as any, min: 1, max: 1 },
  act({ move: { sel: '$t', to: 'hand', cause: 'bounce' } }),
];

const cards: CardDef[] = [
  creature('vanilla'),
  creature('other'),
  // 出た時、相手のクリーチャーを手札に戻してもよい(任意の誘発)
  creature('c-bounce', [onEntered(bounce, true)]),
  // 出た時、引いてもよい(対象を選ばない)
  creature('c-draw', [onEntered([act({ draw: 1 })], true)]),
  // 出た時、選んだ相手のクリーチャーを破壊する(強制)
  creature('c-destroy', [
    onEntered([
      { op: 'select', as: '$t', from: oppCreature as any, min: 1, max: 1 },
      act({ move: { sel: '$t', to: 'grave', cause: 'destroy' } }),
    ]),
  ]),
  // 手順中の may: 選んで戻す / 選べなければ3枚引く(else)
  spell('s-may-bounce', [{ op: 'may', then: bounce, else: [act({ draw: 3 })] }]),
  // may の本体が「選ぶ」のあとに、対象がなくても起きることがある(引く)
  spell('s-may-select-draw', [
    {
      op: 'may',
      then: [{ op: 'select', as: '$h', from: { zone: 'hand' } as any, min: 1, max: 1 }, act({ move: { sel: '$h', to: 'grave' } }), act({ draw: 1 })],
    },
  ]),
  // 1〜2体を選ぶ
  spell('s-may-bounce-upto2', [
    {
      op: 'may',
      then: [{ op: 'select', as: '$t', from: oppCreature as any, min: 1, max: 2 }, act({ move: { sel: '$t', to: 'hand' } })],
    },
  ]),
  // 空かどうかで分岐する本体
  spell('s-may-if', [
    {
      op: 'may',
      then: [
        { op: 'select', as: '$t', from: oppCreature as any, min: 1, max: 1 },
        act({ move: { sel: '$t', to: 'grave', cause: 'destroy', as: '$d' } }),
        { op: 'if', cond: { nonEmpty: '$d' }, then: [act({ draw: 2 })] },
      ],
    },
  ]),
  // 手札から2枚を捨てる / マナから1枚を手札に戻す
  spell('s-discard2', [{ op: 'select', as: '$t', from: { zone: 'hand' } as any, min: 2, max: 2 }, act({ move: { sel: '$t', to: 'grave' } })]),
  spell('s-mana-back', [{ op: 'select', as: '$t', from: { zone: 'mana', owner: 'self' } as any, min: 1, max: 1 }, act({ move: { sel: '$t', to: 'hand' } })]),
  spell('s-destroy-opp', [
    { op: 'select', as: '$t', from: oppCreature as any, min: 1, max: 1 },
    act({ move: { sel: '$t', to: 'grave', cause: 'destroy' } }),
  ]),
];

const DB: CardDB = Object.fromEntries([CARD_DB.dummy, ...cards].map((c) => [c.id, c]));
const R = loadRegistry(DB);
const G = (o: Setup['p0'] = {}) => ({ mana: Array(3).fill('vanilla'), ...o });
const sim = (setup: Setup) => new Sim(setup, R);

describe('任意効果: 使っても何も起きないなら聞かない', () => {
  it('相手のクリーチャーがいなければ、「手札に戻してもよい」は聞かれない', () => {
    const a = sim({ p0: G({ hand: ['c-bounce'] }) });
    a.play('c-bounce');
    expect(a.s.pending?.why).toBe('turnAction');
  });
  it('相手のクリーチャーがいれば、使うか + 対象を1問で聞く(0枚 = 使わない)', () => {
    const a = sim({ p0: G({ hand: ['c-bounce'] }), p1: { battle: ['vanilla', 'other'] } });
    a.play('c-bounce');
    expect(a.pending.why).toBe('may');
    expect(a.pending.player).toBe(0);
    expect(a.pending.input).toMatchObject({ shape: 'pick', min: 0, max: 1 });
    expect((a.pending.input as any).candidates).toHaveLength(2);
    a.pick('other');
    expect(a.has(1, 'hand', 'other')).toBe(true);
    expect(a.count(1, 'battle')).toBe(1);
  });
  it('選ばなければ使わない', () => {
    const a = sim({ p0: G({ hand: ['c-bounce'] }), p1: { battle: ['vanilla', 'other'] } });
    a.play('c-bounce');
    a.answer([]);
    expect(a.count(1, 'battle')).toBe(2);
    expect(a.s.pending?.why).toBe('turnAction');
  });
  it('同じものしか選べない時は、そのカードを示す1択(選ぶか選ばないか)', () => {
    const a = sim({ p0: G({ hand: ['c-bounce'] }), p1: { battle: ['vanilla', 'vanilla'] } });
    a.play('c-bounce');
    expect(a.pending.input).toMatchObject({ shape: 'pick', min: 0, max: 1 });
    expect((a.pending.input as any).candidates).toHaveLength(1);
  });
  it('対象を選ばない任意効果は、従来どおり はい/いいえ', () => {
    const a = sim({ p0: G({ hand: ['c-draw'] }) });
    a.play('c-draw');
    expect(a.pending.input?.shape).toBe('yesno');
  });
  it('強制の「選んで破壊」は、対象がいなければ聞かずに何も起きない', () => {
    const a = sim({ p0: G({ hand: ['c-destroy'] }) });
    a.play('c-destroy');
    expect(a.s.pending?.why).toBe('turnAction');
  });
});

describe('任意効果: 手順の中の may', () => {
  it('対象がなければ、使わない側(else)へ進む', () => {
    const a = sim({ p0: G({ hand: ['s-may-bounce'] }) });
    a.play('s-may-bounce');
    expect(a.s.pending?.why).toBe('turnAction');
    expect(a.count(0, 'hand')).toBe(3); // else で3枚引いた
  });
  it('対象があれば、使うか + 対象を1問で聞く。選べば使い、選ばなければ else', () => {
    const y = sim({ p0: G({ hand: ['s-may-bounce'] }), p1: { battle: ['vanilla', 'other'] } });
    y.play('s-may-bounce');
    expect(y.pending.input).toMatchObject({ shape: 'pick', min: 0, max: 1 });
    y.pick('vanilla');
    expect(y.has(1, 'hand', 'vanilla')).toBe(true);
    expect(y.count(0, 'hand')).toBe(0);
    const n = sim({ p0: G({ hand: ['s-may-bounce'] }), p1: { battle: ['vanilla', 'other'] } });
    n.play('s-may-bounce');
    n.answer([]);
    expect(n.count(1, 'battle')).toBe(2);
    expect(n.count(0, 'hand')).toBe(3);
  });
  it('対象がなくても起きることがある本体(引く)は、従来どおり はい/いいえ', () => {
    const a = sim({ p0: G({ hand: ['s-may-select-draw'] }) });
    a.play('s-may-select-draw');
    expect(a.pending.input?.shape).toBe('yesno');
    a.yes();
    expect(a.count(0, 'hand')).toBe(1); // 選ぶ手札がなく、引くだけ
  });
  it('1〜2体を選ぶ本体も、使うか + 対象を1問(0枚 = 使わない、1〜2枚 = 使う)', () => {
    const a = sim({ p0: G({ hand: ['s-may-bounce-upto2'] }), p1: { battle: ['vanilla', 'other'] } });
    a.play('s-may-bounce-upto2');
    expect(a.pending.input).toMatchObject({ shape: 'pick', min: 0, max: 2 });
    a.pick('vanilla', 'other');
    expect(a.count(1, 'hand')).toBe(2);
  });
  it('空かで分岐する本体も、対象がなければ聞かない', () => {
    const a = sim({ p0: G({ hand: ['s-may-if'] }) });
    a.play('s-may-if');
    expect(a.s.pending?.why).toBe('turnAction');
    expect(a.count(0, 'hand')).toBe(0);
  });
});

describe('選択: どれを選んでも同じなら聞かない', () => {
  it('手札の同名3枚から2枚: 聞かずに捨てる', () => {
    const a = sim({ p0: G({ hand: ['s-discard2', 'vanilla', 'vanilla', 'vanilla'] }) });
    a.play('s-discard2');
    expect(a.s.pending?.why).toBe('turnAction');
    expect(a.count(0, 'grave')).toBe(3); // 呪文と、捨てた2枚
    expect(a.count(0, 'hand')).toBe(1);
  });
  it('手札が同名ではなければ聞く', () => {
    const a = sim({ p0: G({ hand: ['s-discard2', 'vanilla', 'vanilla', 'other'] }) });
    a.play('s-discard2');
    expect(a.pending.why).toBe('select');
  });
  it('マナ: 同名でタップ状態も同じなら聞かない。タップ状態が違えば聞く', () => {
    const t = { c: 'vanilla', tapped: true };
    // 支払いでただ1枚の未タップを使うので、残りはすべてタップ済みの同名
    const same = sim({ p0: { hand: ['s-mana-back'], mana: [t, t, t, 'vanilla'] } });
    same.play('s-mana-back');
    expect(same.s.pending?.why).toBe('turnAction');
    expect(same.count(0, 'hand')).toBe(1);
    // 支払いで1枚タップされ、未タップの同名と混ざる
    const diff = sim({ p0: { hand: ['s-mana-back'], mana: ['vanilla', 'vanilla', 'vanilla'] } });
    diff.play('s-mana-back');
    expect(diff.pending.why).toBe('select');
  });
  it('バトルゾーン: 同名の同じ状態なら聞かない。タップ状態や召喚酔いが違えば聞く', () => {
    const same = sim({ p0: G({ hand: ['s-destroy-opp'] }), p1: { battle: ['vanilla', 'vanilla'] } });
    same.play('s-destroy-opp');
    expect(same.s.pending?.why).toBe('turnAction');
    expect(same.count(1, 'battle')).toBe(1);
    expect(same.count(1, 'grave')).toBe(1);
    const tapped = sim({ p0: G({ hand: ['s-destroy-opp'] }), p1: { battle: ['vanilla', { c: 'vanilla', tapped: true }] } });
    tapped.play('s-destroy-opp');
    expect(tapped.pending.why).toBe('select');
    const sick = sim({ p0: G({ hand: ['s-destroy-opp'] }), p1: { battle: ['vanilla', { c: 'vanilla', sick: true }] } });
    sick.play('s-destroy-opp');
    expect(sick.pending.why).toBe('select');
  });
  it('進化元を持つクリーチャーは、同名でも同じとは見なさない', () => {
    const a = sim({ p0: G({ hand: ['s-destroy-opp'] }), p1: { battle: ['vanilla', { c: 'vanilla', under: ['other'] }] } });
    a.play('s-destroy-opp');
    expect(a.pending.why).toBe('select');
  });
  it('継続効果を受けているクリーチャーは、同名でも同じとは見なさない', () => {
    const a = sim({ p0: G({ hand: ['s-destroy-opp'] }), p1: { battle: ['vanilla', 'vanilla'] } });
    const pid = a.s.players[1].battle[0].pid;
    a.s.effects.push({ id: 999, pid, mod: { kind: 'cannotAttack' }, until: { kind: 'endOfTurn', turn: a.s.turn }, controller: 0 });
    a.play('s-destroy-opp');
    expect(a.pending.why).toBe('select');
  });
});
