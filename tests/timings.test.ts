// spec 3.13-2: 「〜時」を表現できる(出た時・重なった時・攻撃する時・破壊された時 …)ことを、
// テスト用のカードで確認する。カードのデータ(能力の記述)を書くだけで、エンジンのコードは触らない。
import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../src/cards';
import { loadRegistry } from '../src/engine/registry';
import type { CardDB, CardDef } from '../src/engine/types';
import { Sim, mana } from './scenario';

const step = (label: string) => [{ op: 'act', act: { setVar: { as: '$x', value: label } } }];

function trig(label: string, on: any, extra: any = {}) {
  return { kind: 'trigger', label, spec: { on, subject: 'any', ...extra }, steps: step(label) };
}

function card(id: string, name: string, abilities: any[], o: Partial<{ cost: number; power: number; type: string; evolveFrom: any; spell: boolean }> = {}): CardDef {
  return {
    id,
    name,
    faces: [
      {
        name,
        type: (o.type ?? (o.spell ? 'spell' : 'creature')) as any,
        cost: o.cost ?? 1,
        civs: ['nature'],
        ...(o.spell ? {} : { power: o.power ?? 1000 }),
        races: [],
        abilities,
        ...(o.evolveFrom ? { evolveFrom: o.evolveFrom } : {}),
      },
    ],
  } as CardDef;
}

const extra: CardDef[] = [
  card('t-enter', 'T出現', [
    trig('T:出た時', { type: 'entered' }, { subject: 'self' }),
    trig('T:召喚によって出た時', { type: 'entered', via: 'summon' }, { subject: 'self' }),
  ]),
  card('t-base', 'Tベース', []),
  card('t-evo', 'T進化', [trig('T:重なった時', { type: 'evolved' }, { subject: 'self' })], { type: 'evolution', evolveFrom: { type: 'creature' } }),
  card(
    't-atk',
    'T攻撃',
    [
      trig('T:攻撃する時', { type: 'attackDeclared' }, { subject: 'self' }),
      trig('T:ブロックされた時', { type: 'blocked', role: 'attacker' }),
      trig('T:バトルに勝った時', { type: 'battleEnded', role: 'winner' }),
    ],
    { power: 5000 },
  ),
  card('t-def', 'T受け', [trig('T:バトルに負けた時', { type: 'battleEnded', role: 'loser' }, { watch: ['grave', 'battle'] })], { power: 1000 }),
  card(
    't-left',
    'T離脱',
    [
      trig('T:破壊された時', { type: 'moved', from: 'battle', to: 'grave', cause: 'destroy' }, { subject: 'self', watch: ['grave'] }),
      trig('T:バトルゾーンを離れた時', { type: 'moved', from: 'battle' }, { subject: 'self', watch: ['hand', 'grave', 'mana', 'deck'] }),
    ],
    { power: 1000 },
  ),
  card('t-zone', 'Tゾーン', [
    trig('T:手札に加わった時', { type: 'moved', to: 'hand' }, { subject: 'self', watch: ['hand'] }),
    trig('T:捨てられた時', { type: 'moved', from: 'hand', to: 'grave', cause: 'discard' }, { subject: 'self', watch: ['grave'] }),
    trig('T:マナゾーンに置かれた時', { type: 'moved', to: 'mana' }, { subject: 'self', watch: ['mana'] }),
  ]),
  card('t-cast', 'T詠唱', [trig('T:呪文を唱えた時', { type: 'cast', owner: 'self' })]),
  card('t-spell', 'Tの呪文', [{ kind: 'spell', steps: step('spell') }], { spell: true }),
  card('t-break', 'Tブレイク', [trig('T:シールドがブレイクされた時', { type: 'shieldBroken', owner: 'self' })]),
  card('t-turn', 'Tターン', [
    trig('T:自分のターン開始時', { type: 'stepStart', step: 'start', player: 'self' }),
    trig('T:自分のターン終了時', { type: 'stepStart', step: 'end', player: 'self' }),
    trig('T:相手のターン終了時', { type: 'stepStart', step: 'end', player: 'opponent' }),
  ]),
  card('t-trig', 'T能力監視', [trig('T:能力がトリガーした時', { type: 'abilityTriggered', controller: 'opponent' })]),
  card('t-once', 'T1回', [{ kind: 'trigger', label: 'T:1ターンに1回', spec: { on: { type: 'entered', owner: 'self' }, subject: 'any', limit: { perTurn: 1 } }, steps: step('once') }]),
  card('t-only-opp', 'T相手ターンのみ', [{ kind: 'trigger', label: 'T:相手のターン中のみ', spec: { on: { type: 'entered', owner: 'opponent' }, subject: 'any', turn: 'opponent' }, steps: step('o') }]),
];

const DB: CardDB = { ...CARD_DB, ...Object.fromEntries(extra.map((c) => [c.id, c])) };
const R = loadRegistry(DB);
// 同時に誘発した能力の順序の質問があれば、既定で進めてから確認する
const labels = (sim: Sim) => {
  sim.drain();
  return sim.evs('resolve').map((e) => e.label as string);
};
const has = (sim: Sim, part: string) => labels(sim).some((l) => l.includes(part));

describe('タイミングの表現(spec 3.13-2)', () => {
  it('出た時 / 召喚によって出た時', () => {
    const sim = new Sim({ p0: { hand: ['t-enter'], mana: mana(1) } }, R);
    sim.play('t-enter');
    expect(has(sim, 'T:出た時')).toBe(true);
    expect(has(sim, 'T:召喚によって出た時')).toBe(true);
  });
  it('効果で出した時は「召喚によって出た時」にならない(出た時のみ)', () => {
    const sim = new Sim({ p0: { hand: ['逆転の剣スカイソード'], mana: [...mana(10), 't-enter'] } }, R);
    sim.play('逆転の剣スカイソード');
    sim.no(); // 相手のクリーチャーはいない
    sim.yes(); // マナゾーンからクリーチャーを出す
    expect(has(sim, 'T:出た時')).toBe(true);
    expect(has(sim, 'T:召喚によって出た時')).toBe(false);
  });
  it('重なった時', () => {
    const sim = new Sim({ p0: { hand: ['t-evo'], mana: mana(1), battle: ['t-base'] } }, R);
    sim.play('t-evo', { extra: { onto: sim.pid(0, 't-base') } });
    expect(has(sim, 'T:重なった時')).toBe(true);
  });
  it('攻撃する時 / バトルに勝った時 / バトルに負けた時', () => {
    const sim = new Sim({ p0: { battle: ['t-atk'] }, p1: { battle: [{ c: 't-def', tapped: true }] } }, R);
    sim.attack('t-atk', 't-def');
    expect(has(sim, 'T:攻撃する時')).toBe(true);
    expect(has(sim, 'T:バトルに勝った時')).toBe(true);
    expect(has(sim, 'T:バトルに負けた時')).toBe(true);
  });
  it('ブロックされた時', () => {
    const sim = new Sim({ p0: { battle: ['t-atk'] }, p1: { battle: ['ティンパニ=シンバリー'], shield: 5 } }, R);
    sim.attack('t-atk', 'player');
    sim.pick('ティンパニ=シンバリー');
    expect(has(sim, 'T:ブロックされた時')).toBe(true);
  });
  it('破壊された時 / バトルゾーンを離れた時', () => {
    const sim = new Sim({ p0: { battle: [{ c: 't-atk' }] }, p1: { battle: [{ c: 't-left', tapped: true }] } }, R);
    sim.attack('t-atk', 't-left');
    expect(has(sim, 'T:破壊された時')).toBe(true);
    expect(has(sim, 'T:バトルゾーンを離れた時')).toBe(true);
  });
  it('離れた時(手札に戻る場合は、破壊された時ではない)', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: ['t-left'] },
      p1: { hand: ['修羅の死神フミシュナ'], mana: mana(5, 'アクアン'), deck: 5 },
    }, R);
    sim.play('修羅の死神フミシュナ', { face: 1 });
    sim.option(1, 1);
    expect(has(sim, 'T:バトルゾーンを離れた時')).toBe(true);
    expect(has(sim, 'T:破壊された時')).toBe(false);
  });
  it('手札に加わった時', () => {
    const sim = new Sim({ p0: { battle: [], deck: ['t-zone', 'ダミー', 'ダミー', 'ダミー'], hand: ['ワクムテラス'], mana: mana(4, 'アクアン') } }, R);
    sim.play('ワクムテラス');
    expect(has(sim, 'T:手札に加わった時')).toBe(true);
  });
  it('捨てた時', () => {
    const sim = new Sim({
      p0: { hand: ['t-zone'] },
      p1: { hand: ['修羅の死神フミシュナ'], mana: mana(4, 'ロスト・Re:ソウル'), deck: 5 },
      active: 1,
    }, R);
    sim.play('修羅の死神フミシュナ');
    expect(has(sim, 'T:捨てられた時')).toBe(true);
  });
  it('マナゾーンに置かれた時', () => {
    const sim = new Sim({ step: 'mana', p0: { hand: ['t-zone'] } }, R);
    sim.charge('t-zone');
    expect(has(sim, 'T:マナゾーンに置かれた時')).toBe(true);
  });
  it('呪文を唱えた時', () => {
    const sim = new Sim({ p0: { battle: ['t-cast'], hand: ['t-spell'], mana: mana(1) } }, R);
    sim.play('t-spell');
    expect(has(sim, 'T:呪文を唱えた時')).toBe(true);
  });
  it('シールドがブレイクされた時', () => {
    const sim = new Sim({ active: 1, p0: { battle: ['t-break'], shield: 5 }, p1: { battle: ['ヨビニオン・マルル'] } }, R);
    sim.attack('ヨビニオン・マルル', 'player');
    sim.drain();
    expect(has(sim, 'T:シールドがブレイクされた時')).toBe(true);
  });
  it('自分のターン開始時・終了時 / 相手のターン終了時', () => {
    const sim = new Sim({ p0: { battle: ['t-turn'], deck: 10 }, p1: { deck: 10 } }, R);
    sim.endTurn();
    expect(has(sim, 'T:自分のターン終了時')).toBe(true);
    expect(has(sim, 'T:相手のターン終了時')).toBe(false);
    sim.skipMana().endTurn();
    expect(has(sim, 'T:相手のターン終了時')).toBe(true);
    expect(has(sim, 'T:自分のターン開始時')).toBe(true);
  });
  it('能力がトリガーした時', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: ['t-trig'] },
      p1: { hand: ['天災 デドダム'], mana: ['アクアン', 'ロスト・Re:ソウル', 'フェアリー・ライフ'], deck: 5 },
    }, R);
    sim.play('天災 デドダム');
    expect(has(sim, 'T:能力がトリガーした時')).toBe(true);
  });
  it('ゲームに負ける時(置換)', () => {
    const sim = new Sim({
      p0: { battle: ['CRYMAX ジャオウガ'], mana: mana(4), deck: 0 },
      p1: { deck: 10 },
    }, R);
    sim.endTurn();
    expect(sim.pending.why).toBe('replaceChoice');
    sim.option(0);
    expect(sim.s.winner).toBeNull();
    expect(sim.has(0, 'battle', 'CRYMAX ジャオウガ')).toBe(true);
    expect(sim.count(0, 'grave')).toBe(3);
  });
});

describe('条件(spec 3.13-3)', () => {
  it('1ターンに1回', () => {
    const sim = new Sim({ p0: { battle: ['t-once'], hand: ['t-base', 't-base'], mana: mana(2) } }, R);
    sim.play('t-base');
    sim.play('t-base');
    expect(labels(sim).filter((l) => l.includes('T:1ターンに1回')).length).toBe(1);
  });
  it('相手のターン中のみ', () => {
    const sim = new Sim({ p0: { battle: ['t-only-opp'], hand: ['t-base'], mana: mana(1) }, p1: { hand: ['t-base'], mana: mana(1) } }, R);
    sim.play('t-base');
    expect(has(sim, 'T:相手のターン中のみ')).toBe(false);
    sim.endTurn();
    sim.skipMana();
    sim.play('t-base');
    expect(has(sim, 'T:相手のターン中のみ')).toBe(true);
  });
});

describe('継続効果の期限(spec 3.13-6)', () => {
  it('発生源がいる間: 発生源が離れたら失効する', () => {
    const src = card('t-src', 'T発生源', [
      {
        kind: 'trigger',
        label: 'T:付与',
        spec: { on: { type: 'entered' }, subject: 'self' },
        steps: [{ op: 'act', act: { addEffect: { sel: '$self', mods: [{ kind: 'grant', keyword: 'blocker' }], until: 'source' } } }],
      },
    ]);
    const db2: CardDB = { ...DB, [src.id]: src };
    const r2 = loadRegistry(db2);
    const sim = new Sim({ p0: { hand: ['t-src'], mana: mana(1) }, p1: { hand: ['修羅の死神フミシュナ'], mana: mana(5, 'アクアン') } }, r2);
    sim.play('t-src');
    expect(sim.s.effects.length).toBe(1);
    sim.endTurn();
    sim.skipMana();
    sim.play('修羅の死神フミシュナ', { face: 1 });
    sim.option(1, 1);
    expect(sim.has(0, 'hand', 't-src')).toBe(true);
    expect(sim.s.effects.length).toBe(0);
  });
});
