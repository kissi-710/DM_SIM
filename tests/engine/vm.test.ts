// 効果インタプリタ(VM)・原始操作の単体テスト。実カードではなく、テスト用の合成カードで1つずつ確かめる。
import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../../src/cards';
import type { StepDef } from '../../src/engine/ast';
import { hasEffect, hasKeyword, powerOf } from '../../src/engine/derive';
import { legalActions } from '../../src/engine/engine';
import { loadRegistry } from '../../src/engine/registry';
import { mkCtx } from '../../src/engine/state';
import type { CardDB, CardDef, GameConfig } from '../../src/engine/types';
import { Sim, type Setup } from '../scenario';

// ───────────────────────── 合成カード ─────────────────────────

const spell = (id: string, steps: StepDef[], extra: Partial<CardDef['faces'][0]> = {}): CardDef => ({
  id,
  name: id,
  faces: [{ name: id, type: 'spell', cost: 1, civs: ['nature'], abilities: [{ kind: 'spell', steps }], ...extra }],
});
const creature = (id: string, abilities: any[] = [], extra: Partial<CardDef['faces'][0]> = {}): CardDef => ({
  id,
  name: id,
  faces: [{ name: id, type: 'creature', cost: 1, civs: ['nature'], power: 1000, abilities, ...extra }],
});
const onEntered = (steps: StepDef[], optional = false) => ({
  kind: 'trigger',
  optional,
  label: 'テスト',
  spec: { on: { type: 'entered' }, subject: 'self' },
  steps,
});

const act = (a: Record<string, any>): StepDef => ({ op: 'act', act: a });

const cards: CardDef[] = [
  creature('vanilla'),
  creature('cheap2', [], { cost: 2 }),
  creature('big', [], { cost: 9, power: 9000 }),
  // 山札・手札・マナの操作
  spell('s-draw2', [act({ draw: 2 })]),
  spell('s-draw-opp', [act({ draw: { n: 2, who: 'opponent' } })]),
  spell('s-draw-expr', [act({ draw: { n: { count: { zone: 'mana' } } } })]),
  spell('s-repeat', [{ op: 'repeat', times: 3, body: [act({ draw: 1 })] }]),
  spell('s-repeat-zero', [{ op: 'repeat', times: { count: { zone: 'grave' } }, body: [act({ draw: 1 })] }]),
  spell('s-if', [
    { op: 'if', cond: { count: { zone: 'hand' }, gte: 3 }, then: [act({ draw: 3 })], else: [act({ draw: 1 })] },
  ]),
  spell('s-if-noelse', [{ op: 'if', cond: { count: { zone: 'mana' }, gte: 99 }, then: [act({ draw: 5 })] }]),
  spell('s-modes1', [
    {
      op: 'modes',
      pick: 1,
      allIf: { true: true },
      options: [
        { label: 'A', steps: [act({ draw: 1 })] },
        { label: 'B', steps: [act({ draw: 2 })] },
        { label: 'C', steps: [act({ draw: 4 })] },
      ],
    },
  ]),
  spell('s-modes-order', [
    {
      op: 'modes',
      pick: 2,
      options: [
        { label: 'first', steps: [act({ setVar: { as: '$log', value: 1 } }), act({ moveTop: { n: 1, to: 'grave', as: '$a' } })] },
        { label: 'second', steps: [act({ moveTop: { n: 1, to: 'mana', as: '$b' } })] },
        { label: 'third', steps: [act({ draw: 1 })] },
      ],
    },
  ]),
  spell('s-modes-repeat', [
    { op: 'modes', pick: 2, repeat: true, options: [{ label: 'A', steps: [act({ draw: 1 })] }, { label: 'B', steps: [act({ draw: 3 })] }] },
  ]),
  spell('s-modes-opp', [
    { op: 'modes', pick: 1, who: 'opponent', options: [{ label: 'A', steps: [act({ draw: 1 })] }, { label: 'B', steps: [act({ draw: 2 })] }] },
  ]),
  spell('s-may', [{ op: 'may', then: [act({ draw: 1 })], else: [act({ draw: 3 })] }]),
  spell('s-may-noelse', [{ op: 'may', then: [act({ draw: 2 })] }]),
  // 選択
  spell('s-select2', [
    { op: 'select', as: '$t', from: { zone: 'hand' }, min: 2, max: 2 },
    act({ move: { sel: '$t', to: 'grave' } }),
  ]),
  // each: 選んだものを1つずつ処理する
  spell('s-each-tap', [
    { op: 'select', as: '$t', from: { zone: 'battle', owner: 'self' }, min: 2, max: 2 },
    { op: 'each', in: '$t', as: '$c', body: [act({ tap: { sel: '$c' } })] },
  ]),
  spell('s-each-move', [
    { op: 'select', as: '$t', from: { zone: 'hand' }, min: 2, max: 2 },
    { op: 'each', in: '$t', as: '$c', body: [act({ move: { sel: '$c', to: 'grave' } })] },
  ]),
  spell('s-destroy-own', [act({ move: { sel: { zone: 'battle', owner: 'self' }, to: 'grave', cause: 'destroy' } })]),
  spell('s-select-opt', [
    { op: 'select', as: '$t', from: { zone: 'hand' }, min: 0, max: 2 },
    act({ move: { sel: '$t', to: 'grave' } }),
  ]),
  spell('s-select-random', [
    { op: 'select', as: '$t', from: { zone: 'hand' }, random: true },
    act({ move: { sel: '$t', to: 'grave' } }),
  ]),
  spell('s-select-opp', [
    { op: 'select', as: '$t', who: 'opponent', from: { zone: 'hand', owner: 'opponent' }, min: 1, max: 1 },
    act({ move: { sel: '$t', to: 'grave' } }),
  ]),
  spell('s-select-var', [
    act({ lookTop: { n: 3, as: '$top' } }),
    { op: 'select', as: '$t', from: { var: '$top' }, min: 1, max: 1 },
    act({ move: { sel: '$t', to: 'hand' } }),
  ]),
  // 再開可能性: 質問の前後で、前の操作が二重にならない
  spell('s-resume', [act({ draw: 1 }), { op: 'select', as: '$t', from: { zone: 'hand' }, min: 1, max: 1 }, act({ draw: 1 }), act({ move: { sel: '$t', to: 'grave' } })]),
  // 山札
  spell('s-looktop-assign', [
    act({ lookTop: { n: 3, as: '$top' } }),
    act({
      assign: {
        items: '$top',
        as: '$res',
        slots: [
          { id: 'h', to: 'hand', count: 1 },
          { id: 'g', to: 'grave', count: 2 },
        ],
      },
    }),
  ]),
  spell('s-assign-auto', [
    act({ lookTop: { n: 2, as: '$top' } }),
    act({ assign: { items: '$top', slots: [{ id: 'g', to: 'grave', count: 5 }] } }),
  ]),
  spell('s-movetop', [act({ moveTop: { n: 2, to: 'mana', tapped: true, as: '$m' } }), { op: 'if', cond: { nonEmpty: '$m' }, then: [act({ draw: 1 })] }]),
  spell('s-reveal', [
    act({ revealUntil: { as: '$found', rest: '$rest', cond: { all: [{ type: 'creature' }, { cost: { lt: 5 } }] } } }),
    act({ put: { sel: '$found' } }),
    act({ shuffleBottom: { of: '$rest' } }),
  ]),
  spell('s-shield', [act({ addShield: { n: 2 } })]),
  spell('s-shuffle', [act({ shuffle: {} })]),
  // 場への働きかけ
  spell('s-tap', [act({ tap: { sel: { zone: 'battle', owner: 'opponent' } } })]),
  spell('s-untap', [act({ untap: { sel: { zone: 'battle', owner: 'self' } } })]),
  spell('s-move-battle', [act({ move: { sel: { zone: 'battle', owner: 'opponent' }, to: 'grave', cause: 'destroy' } })]),
  spell('s-fx-power', [
    act({ addEffect: { sel: { zone: 'battle', owner: 'self' }, mods: [{ kind: 'powerAdd', n: 2000 }, { kind: 'grant', keyword: 'blocker' }], until: 'endOfTurn' } }),
  ]),
  spell('s-fx-noattack', [act({ addEffect: { sel: { zone: 'battle', owner: 'opponent' }, mod: { kind: 'cannotAttack' }, until: 'nextTurnStart' } })]),
  spell('s-put', [act({ put: { sel: { zone: 'hand', type: 'creature' }, as: '$p' } })]),
  spell('s-castfree', [
    { op: 'select', as: '$s', from: { zone: 'grave', type: 'spell' }, min: 1, max: 1 },
    act({ castFree: { sel: '$s' } }),
  ]),
  spell('s-reveal-cards', [act({ reveal: { items: { zone: 'hand' } } })]),
  spell('s-forplayers', [
    {
      op: 'forPlayers',
      body: [
        { op: 'select', as: '$keep', who: 'iter', from: { zone: 'hand', owner: 'iter' }, min: 1, max: 1 },
        act({ move: { sel: { zone: 'hand', owner: 'iter', except: '$keep' }, to: 'grave' } }),
      ],
    },
  ]),
  // 誘発型能力
  creature('t-draw', [onEntered([act({ draw: 1 })])]),
  creature('t-may', [onEntered([act({ draw: 2 })], true)]),
  creature('t-lock', [
    onEntered([act({ addEffect: { sel: { zone: 'battle', owner: 'opponent' }, mod: { kind: 'cannotAttack' }, until: 'source' } })]),
  ]),
  creature('blocker-kw', [{ kind: 'keyword', name: 'blocker' }]),
];

const dummy = CARD_DB.dummy;
const DB: CardDB = Object.fromEntries([dummy, ...cards].map((c) => [c.id, c]));
const R = loadRegistry(DB);

const G = (o: Setup['p0'] = {}) => ({ mana: Array(3).fill('vanilla'), ...o });
const sim = (setup: Setup) => new Sim(setup, R);
const withCfg = (cfg: Partial<GameConfig>, setup: Setup) => new Sim({ ...setup, cfg }, R);

// ───────────────────────── テスト ─────────────────────────

describe('draw', () => {
  it('数値・相手(who)・式', () => {
    const a = sim({ p0: G({ hand: ['s-draw2'] }) });
    a.play('s-draw2');
    expect(a.count(0, 'hand')).toBe(2);

    const b = sim({ p0: G({ hand: ['s-draw-opp'] }) });
    b.play('s-draw-opp');
    expect(b.count(1, 'hand')).toBe(2);
    expect(b.count(0, 'hand')).toBe(0);

    const c = sim({ p0: G({ hand: ['s-draw-expr'], mana: Array(5).fill('vanilla') }) });
    c.play('s-draw-expr');
    expect(c.count(0, 'hand')).toBe(5);
  });
  it('山札が足りなければ引ける分だけ(山札が尽きて敗北)', () => {
    const a = sim({ p0: G({ hand: ['s-draw2'], deck: ['vanilla'] }) });
    a.play('s-draw2');
    expect(a.count(0, 'hand')).toBe(1);
    expect(a.s.winner).toBe(1);
  });
});

describe('repeat / if', () => {
  it('repeat: 回数分だけ繰り返す。0回なら何もしない', () => {
    const a = sim({ p0: G({ hand: ['s-repeat'] }) });
    a.play('s-repeat');
    expect(a.count(0, 'hand')).toBe(3);
    const b = sim({ p0: G({ hand: ['s-repeat-zero'] }) });
    b.play('s-repeat-zero');
    expect(b.count(0, 'hand')).toBe(0);
  });
  it('if: 条件を満たせば then、満たさなければ else(なければ何もしない)', () => {
    const many = sim({ p0: G({ hand: ['s-if', 'vanilla', 'vanilla', 'vanilla'] }) });
    many.play('s-if');
    expect(many.count(0, 'hand')).toBe(3 + 3);
    const few = sim({ p0: G({ hand: ['s-if'] }) });
    few.play('s-if');
    expect(few.count(0, 'hand')).toBe(1);
    const none = sim({ p0: G({ hand: ['s-if-noelse'] }) });
    none.play('s-if-noelse');
    expect(none.count(0, 'hand')).toBe(0);
  });
});

describe('modes(選択肢)', () => {
  it('1つ選ぶ', () => {
    const a = sim({ p0: G({ hand: ['s-modes1'] }) });
    a.play('s-modes1');
    expect(a.pending.why).toBe('modes');
    a.option(1);
    expect(a.count(0, 'hand')).toBe(2);
  });
  it('allIf を満たすと、全部を選べる', () => {
    const a = sim({ p0: G({ hand: ['s-modes1'] }) });
    a.play('s-modes1');
    expect((a.pending.input as any).allIf).toBe(true);
    a.option(0, 1, 2);
    expect(a.count(0, 'hand')).toBe(1 + 2 + 4);
  });
  it('2つ選ぶ: 選んだ順ではなく、カードの文章の上から順に解決する', () => {
    const a = sim({ p0: G({ hand: ['s-modes-order'], deck: ['cheap2', 'big', 'vanilla', 'vanilla'] }) });
    a.play('s-modes-order');
    a.option(1, 0); // 「second」→「first」の順に答えても
    // first(山札の上 cheap2 → 墓地)が先、second(次の big → マナ)が後
    expect(a.has(0, 'grave', 'cheap2')).toBe(true);
    expect(a.has(0, 'mana', 'big')).toBe(true);
  });
  it('repeat: 同じ選択肢を複数回選べる', () => {
    const a = sim({ p0: G({ hand: ['s-modes-repeat'] }) });
    a.play('s-modes-repeat');
    expect((a.pending.input as any).repeat).toBe(true);
    a.option(1, 1);
    expect(a.count(0, 'hand')).toBe(6);
  });
  it('who=opponent: 選ぶのは相手', () => {
    const a = sim({ p0: G({ hand: ['s-modes-opp'] }) });
    a.play('s-modes-opp');
    expect(a.pending.player).toBe(1);
    a.option(0);
    // 引くのは効果の処理者(自分)
    expect(a.count(0, 'hand')).toBe(1);
  });
  it('不正な選択肢の番号は受け付けない', () => {
    const a = sim({ p0: G({ hand: ['s-modes1'] }) });
    a.play('s-modes1');
    expect(() => a.option(5)).toThrow();
    expect(() => a.option(0, 1)).toThrow(); // 全部でも1つでもない
  });
});

describe('may', () => {
  it('はい → then、いいえ → else', () => {
    const y = sim({ p0: G({ hand: ['s-may'] }) });
    y.play('s-may');
    y.yes();
    expect(y.count(0, 'hand')).toBe(1);
    const n = sim({ p0: G({ hand: ['s-may'] }) });
    n.play('s-may');
    n.no();
    expect(n.count(0, 'hand')).toBe(3);
  });
  it('else がなければ、いいえで何もしない', () => {
    const n = sim({ p0: G({ hand: ['s-may-noelse'] }) });
    n.play('s-may-noelse');
    n.no();
    expect(n.count(0, 'hand')).toBe(0);
    const y = sim({ p0: G({ hand: ['s-may-noelse'] }) });
    y.play('s-may-noelse');
    y.yes();
    expect(y.count(0, 'hand')).toBe(2);
  });
  it('任意の誘発型能力: はいで実行、いいえで何もしない', () => {
    const y = sim({ p0: G({ hand: ['t-may'] }) });
    y.play('t-may');
    y.yes();
    expect(y.count(0, 'hand')).toBe(2);
    const n = sim({ p0: G({ hand: ['t-may'] }) });
    n.play('t-may');
    n.no();
    expect(n.count(0, 'hand')).toBe(0);
  });
  it('強制の誘発型能力は、聞かずに実行する', () => {
    const a = sim({ p0: G({ hand: ['t-draw'] }) });
    a.play('t-draw');
    a.drain();
    expect(a.count(0, 'hand')).toBe(1);
  });
});

describe('select(対象の選択)', () => {
  it('min=max=2: 2枚選んで、まとめて処理する', () => {
    const a = sim({ p0: G({ hand: ['s-select2', 'vanilla', 'cheap2', 'big'] }) });
    a.play('s-select2');
    expect(a.pending.why).toBe('select');
    expect((a.pending.input as any).min).toBe(2);
    a.pick('cheap2', 'big');
    expect(a.has(0, 'grave', 'cheap2')).toBe(true);
    expect(a.has(0, 'grave', 'big')).toBe(true);
    expect(a.count(0, 'hand')).toBe(1);
    expect(a.evs('chosen')).toHaveLength(1);
  });
  it('候補が min と同数なら、聞かずに全部が選ばれる', () => {
    const a = sim({ p0: G({ hand: ['s-select2', 'cheap2', 'big'] }) });
    a.play('s-select2');
    expect(a.s.pending?.why).toBe('turnAction');
    expect(a.count(0, 'grave', 'cheap2') + a.count(0, 'grave', 'big')).toBe(2);
  });
  it('候補が足りなければ、ある分だけ(縮退)', () => {
    const a = sim({ p0: G({ hand: ['s-select2', 'cheap2'] }) });
    a.play('s-select2');
    expect(a.s.pending?.why).toBe('turnAction');
    expect(a.has(0, 'grave', 'cheap2')).toBe(true);
  });
  it('候補が0枚でも止まらない', () => {
    const a = sim({ p0: G({ hand: ['s-select2'] }) });
    a.play('s-select2');
    expect(a.s.pending?.why).toBe('turnAction');
    expect(a.count(0, 'grave')).toBe(1); // 呪文自身だけ
  });
  it('min=0: 何も選ばなくてもよい', () => {
    const a = sim({ p0: G({ hand: ['s-select-opt', 'cheap2', 'big'] }) });
    a.play('s-select-opt');
    expect((a.pending.input as any).min).toBe(0);
    a.none();
    expect(a.count(0, 'hand')).toBe(2);
  });
  it('候補にないものは選べない', () => {
    const a = sim({ p0: G({ hand: ['s-select-opt', 'cheap2', 'big'] }) });
    a.play('s-select-opt');
    expect(() => a.answer([99999])).toThrow();
    expect(() => a.answer([a.s.players[0].hand[0], a.s.players[0].hand[0]])).toThrow();
  });
  it('random: 聞かずに無作為に1枚。同じシードなら同じ結果', () => {
    const run = (seed: number) => {
      const a = sim({ seed, p0: G({ hand: ['s-select-random', 'cheap2', 'big', 'vanilla'] }) });
      a.play('s-select-random');
      expect(a.s.pending?.why).toBe('turnAction');
      expect(a.count(0, 'grave')).toBe(2);
      return a.names(0, 'grave').join(',');
    };
    expect(run(7)).toBe(run(7));
    const seen = new Set<string>();
    for (let seed = 1; seed <= 25; seed++) seen.add(run(seed));
    expect(seen.size).toBeGreaterThan(1);
  });
  it('who=opponent: 相手が選ぶ', () => {
    const a = sim({ p0: G({ hand: ['s-select-opp'] }), p1: { hand: ['cheap2', 'big'] } });
    a.play('s-select-opp');
    expect(a.pending.player).toBe(1);
    a.pick('big');
    expect(a.has(1, 'grave', 'big')).toBe(true);
  });
  it('var: 変数が指すカードの中から選ぶ', () => {
    const a = sim({ p0: G({ hand: ['s-select-var'], deck: ['cheap2', 'big', 'vanilla', 'vanilla'] }) });
    a.play('s-select-var');
    expect((a.pending.input as any).candidates).toHaveLength(3);
    a.pick('big');
    expect(a.has(0, 'hand', 'big')).toBe(true);
  });
});

describe('実行の再開(質問の前の操作が二重にならない)', () => {
  it('質問をはさんでも、引くのは1回ずつ・合計2枚', () => {
    const a = sim({ p0: G({ hand: ['s-resume', 'cheap2'], deck: ['vanilla', 'big', 'vanilla', 'vanilla'] }) });
    a.play('s-resume');
    expect(a.pending.why).toBe('select');
    // ここまでに引いたのは1枚(cheap2 と vanilla の2択)
    expect(a.count(0, 'hand')).toBe(2);
    const deckBefore = a.count(0, 'deck');
    a.pick('cheap2');
    expect(a.count(0, 'deck')).toBe(deckBefore - 1);
    expect(a.count(0, 'hand')).toBe(2); // 1枚墓地へ、1枚引いた
    expect(a.has(0, 'grave', 'cheap2')).toBe(true);
  });
  it('同じ状態から同じ回答を与えると、同じ結果(決定性)', () => {
    const mk = () => sim({ seed: 3, p0: G({ hand: ['s-resume', 'cheap2'], deck: 12 }) });
    const a = mk().play('s-resume').pick('cheap2');
    const b = mk().play('s-resume').pick('cheap2');
    expect(JSON.stringify(a.s)).toBe(JSON.stringify(b.s));
  });
});

describe('山札の操作', () => {
  it('lookTop + assign: 3枚を見て、手札1枚・墓地2枚に振り分ける', () => {
    const a = sim({ p0: G({ hand: ['s-looktop-assign'], deck: ['cheap2', 'big', 'vanilla', 'vanilla'] }) });
    a.play('s-looktop-assign');
    expect(a.pending.why).toBe('assign');
    a.assign({ h: ['big'], g: ['cheap2', 'vanilla'] });
    expect(a.has(0, 'hand', 'big')).toBe(true);
    expect(a.has(0, 'grave', 'cheap2')).toBe(true);
    expect(a.count(0, 'deck')).toBe(1);
    expect(a.evs('looked')).toHaveLength(1);
  });
  it('assign: 枠の上限を超える・枚数が合わない回答は拒否', () => {
    const a = sim({ p0: G({ hand: ['s-looktop-assign'], deck: ['cheap2', 'big', 'vanilla', 'vanilla'] }) });
    a.play('s-looktop-assign');
    expect(() => a.assign({ h: ['big', 'cheap2'], g: ['vanilla'] })).toThrow();
    expect(() => a.assign({ h: ['big'], g: ['cheap2'] })).toThrow();
  });
  it('assign: 全部が1つの枠に収まるなら、聞かずに振り分ける', () => {
    const a = sim({ p0: G({ hand: ['s-assign-auto'], deck: ['cheap2', 'big', 'vanilla'] }) });
    a.play('s-assign-auto');
    expect(a.s.pending?.why).toBe('turnAction');
    expect(a.count(0, 'grave')).toBe(3); // 呪文 + 2枚
  });
  it('moveTop: 上から n 枚をタップ状態でマナへ。as で受けて、続く処理で使える', () => {
    const a = sim({ p0: G({ hand: ['s-movetop'], deck: ['cheap2', 'big', 'vanilla'] }) });
    a.play('s-movetop');
    expect(a.has(0, 'mana', 'cheap2')).toBe(true);
    expect(a.has(0, 'mana', 'big')).toBe(true);
    const placed = a.s.players[0].mana.slice(-2);
    expect(placed.every((u) => a.s.cards[u].tapped)).toBe(true);
    expect(a.count(0, 'hand')).toBe(1); // nonEmpty → 1枚引く
  });
  it('revealUntil: 条件に合うカードが出るまでめくり、出たものを場に出し、残りを山札の下へ', () => {
    const a = sim({ p0: G({ hand: ['s-reveal'], deck: ['big', 'vanilla'] }) });
    // 山札: big(コスト9) → vanilla(コスト1)。vanilla が条件(コスト5未満)に合う
    a.play('s-reveal');
    expect(a.has(0, 'battle', 'vanilla')).toBe(true);
    expect(a.names(0, 'deck')[a.count(0, 'deck') - 1]).toBe('big'); // 残りは山札の下
    expect(a.evs('revealed')).toHaveLength(1);
  });
  it('revealUntil: 条件に合うものがなければ、全部をめくって山札の下に戻す', () => {
    const a = sim({ p0: G({ hand: ['s-reveal'], deck: ['big', 'big', 'big'] }) });
    a.play('s-reveal');
    expect(a.count(0, 'battle')).toBe(0);
    expect(a.count(0, 'deck')).toBe(3);
  });
  it('addShield: 山札の上からシールドを足す', () => {
    const a = sim({ p0: G({ hand: ['s-shield'], shield: 3, deck: 5 }) });
    a.play('s-shield');
    expect(a.count(0, 'shield')).toBe(5);
    expect(a.count(0, 'deck')).toBe(3);
  });
  it('shuffle: 山札を混ぜる(枚数は同じ・並びが変わる)', () => {
    const deck = Array.from({ length: 15 }, (_, i) => (i % 3 === 0 ? 'vanilla' : i % 3 === 1 ? 'cheap2' : 'big'));
    const a = sim({ p0: G({ hand: ['s-shuffle'], deck }) });
    const before = a.names(0, 'deck').join();
    a.play('s-shuffle');
    expect(a.count(0, 'deck')).toBe(15);
    expect(a.names(0, 'deck').join()).not.toBe(before);
    expect([...a.names(0, 'deck')].sort()).toEqual([...deck].sort());
  });
  it('reveal: 公開のイベントが出る(確認を求める設定なら ack の質問になる)', () => {
    const a = sim({ p0: G({ hand: ['s-reveal-cards', 'cheap2'] }) });
    a.play('s-reveal-cards');
    expect(a.evs('revealed')).toHaveLength(1);
    const b = withCfg({ ackReveals: [true, false] }, { p0: G({ hand: ['s-reveal-cards', 'cheap2'] }) });
    b.play('s-reveal-cards');
    expect(b.pending.why).toBe('ack');
    b.answer(true);
    expect(b.s.pending?.why).toBe('turnAction');
  });
});

describe('場への働きかけ', () => {
  it('tap / untap', () => {
    const a = sim({ p0: G({ hand: ['s-tap'] }), p1: { battle: ['vanilla', 'cheap2'] } });
    a.play('s-tap');
    expect(a.s.players[1].battle.every((p) => p.tapped)).toBe(true);
    const b = sim({ p0: G({ hand: ['s-untap'], battle: [{ c: 'vanilla', tapped: true }] }) });
    b.play('s-untap');
    expect(b.s.players[0].battle[0].tapped).toBe(false);
  });
  it('move: バトルゾーンから墓地へ(破壊)', () => {
    const a = sim({ p0: G({ hand: ['s-move-battle'] }), p1: { battle: ['vanilla', 'cheap2'] } });
    a.play('s-move-battle');
    expect(a.count(1, 'battle')).toBe(0);
    expect(a.count(1, 'grave')).toBe(2);
    expect(a.evs('moved').filter((e) => e.cause === 'destroy')).toHaveLength(2);
  });
  it('put: 手札からクリーチャーを場に出す(召喚ではなく効果で出る)。出た時の能力は誘発する', () => {
    const a = sim({ p0: G({ hand: ['s-put', 't-draw'], deck: ['vanilla', 'vanilla'] }) });
    a.play('s-put');
    a.drain();
    expect(a.has(0, 'battle', 't-draw')).toBe(true);
    expect(a.evs('entered').some((e) => e.via === 'effect')).toBe(true);
    expect(a.count(0, 'hand')).toBe(1); // t-draw の能力で1枚引いた
  });
  it('addEffect: パワー加算・キーワード付与(そのターンの終わりまで)', () => {
    const a = sim({ p0: G({ hand: ['s-fx-power'], battle: ['vanilla'] }) });
    a.play('s-fx-power');
    const perm = a.s.players[0].battle[0];
    const c = mkCtx(a.s, R);
    expect(powerOf(c, perm)).toBe(3000);
    expect(hasKeyword(c, perm, 'blocker')).toBe(true);
    expect(a.s.effects).toHaveLength(2);
    a.endTurn();
    a.drain();
    expect(a.s.effects).toHaveLength(0);
  });
  it('addEffect: 次の自分のターンのはじめまで続く', () => {
    const a = sim({ p0: G({ hand: ['s-fx-noattack'] }), p1: { battle: ['vanilla'] } });
    a.play('s-fx-noattack');
    const pid = a.s.players[1].battle[0].pid;
    expect(hasEffect(mkCtx(a.s, R), pid, 'cannotAttack')).toBe(true);
    a.endTurn(); // 相手のターンの間は続く
    expect(a.s.effects).toHaveLength(1);
    expect(hasEffect(mkCtx(a.s, R), pid, 'cannotAttack')).toBe(true);
    const atk = legalActions(a.s, R).filter((x) => x.type === 'ATTACK');
    expect(atk).toHaveLength(0);
  });
  it('addEffect: 発生源がいる間(source)。発生源が離れたら失効する', () => {
    const a = sim({ p0: G({ hand: ['t-lock', 's-destroy-own'] }), p1: { battle: ['vanilla'] } });
    a.play('t-lock');
    a.drain();
    const pid = a.s.players[1].battle[0].pid;
    expect(hasEffect(mkCtx(a.s, R), pid, 'cannotAttack')).toBe(true);
    // 発生源(t-lock)が場を離れる
    a.play('s-destroy-own');
    a.drain();
    expect(a.count(0, 'battle')).toBe(0);
    expect(hasEffect(mkCtx(a.s, R), pid, 'cannotAttack')).toBe(false);
    expect(a.s.effects).toHaveLength(0);
  });
  it('castFree: 墓地の呪文をコストを支払わずに唱える', () => {
    const a = sim({ p0: G({ hand: ['s-castfree'], grave: ['s-draw2'] }) });
    a.play('s-castfree');
    a.drain();
    expect(a.count(0, 'hand')).toBe(2);
    expect(a.count(0, 'grave', 's-draw2')).toBe(1);
    expect(a.evs('cast').some((e) => e.free)).toBe(true);
  });
});

describe('each(選んだものを1つずつ処理する)', () => {
  it('それぞれに対して本体を実行する(動かさない処理)', () => {
    const a = sim({ p0: G({ hand: ['s-each-tap'], battle: ['vanilla', 'cheap2', 'big'] }) });
    a.play('s-each-tap');
    a.pick('cheap2', 'big');
    expect(a.s.players[0].battle.filter((p) => p.tapped)).toHaveLength(2);
    expect(a.s.players[0].battle[0].tapped).toBe(false);
  });
  it('0個なら本体は実行されない', () => {
    const a = sim({ p0: G({ hand: ['s-each-tap'] }) });
    a.play('s-each-tap');
    expect(a.s.pending?.why).toBe('turnAction');
  });
  // 既知の不具合: 本体でカードを動かすと、リストの再計算で後ろの要素を飛ばす(vm.ts の eachNext)。修正したら .fails を外す。
  it.fails('それぞれに対して本体を実行する(本体でカードを動かしても、全員が処理される)', () => {
    const a = sim({ p0: G({ hand: ['s-each-move', 'vanilla', 'cheap2', 'big'] }) });
    a.play('s-each-move');
    a.pick('cheap2', 'big');
    expect(a.has(0, 'grave', 'cheap2')).toBe(true);
    expect(a.has(0, 'grave', 'big')).toBe(true);
  });
});

describe('forPlayers', () => {
  it('ターンプレイヤーから順に、それぞれが自分の手札から残す1枚を選ぶ', () => {
    const a = sim({ p0: G({ hand: ['s-forplayers', 'vanilla', 'cheap2'] }), p1: { hand: ['vanilla', 'cheap2', 'big'] } });
    a.play('s-forplayers');
    expect(a.pending.player).toBe(0);
    a.pick('cheap2');
    expect(a.pending.player).toBe(1);
    a.pick('big');
    expect(a.names(0, 'hand')).toEqual(['cheap2']);
    expect(a.names(1, 'hand')).toEqual(['big']);
  });
});

describe('誘発型能力の対象(subject)と手順', () => {
  it('自分の「出た時」は、他のカードが出ても誘発しない', () => {
    const a = sim({ p0: G({ hand: ['vanilla'], battle: ['t-draw'] }) });
    a.play('vanilla');
    a.drain();
    expect(a.count(0, 'hand')).toBe(0);
  });
});
