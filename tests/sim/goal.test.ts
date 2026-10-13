import { describe, expect, it } from 'vitest';
import {
  collectLeaves,
  describeGoal,
  describeMatcher,
  describePredicate,
  describeTiming,
  GOAL_PRESETS,
  GoalTracker,
  goalHasNot,
  goalMaxTurn,
  matchCard,
  myTurnNo,
  nameMatches,
  presetCost7At4,
  type Goal,
} from '../../src/sim/goal';
import { buildState, defIdOf, mana, reg } from '../scenario';

const pred = (turn: number, at: 'anyMain' | 'turnEnd' | 'byTurn' | 'opening', p: any): Goal => ({ op: 'pred', timing: { turn, at }, pred: p });
const manaGoal = (min: number, turn = 3, at: 'anyMain' | 'turnEnd' | 'byTurn' = 'byTurn', civ?: any) => pred(turn, at, { kind: 'manaCount', min, civ });

describe('describe*(条件の日本語表示)', () => {
  it('describeMatcher: 空は「任意のカード」、条件は並べて表示する', () => {
    expect(describeMatcher({})).toBe('任意のカード');
    expect(describeMatcher({ names: ['A', 'B'] })).toBe('A / B');
    expect(describeMatcher({ cost: { eq: 7 } })).toContain('コスト7');
    expect(describeMatcher({ cost: { gte: 5 } })).toContain('コスト5以上');
    expect(describeMatcher({ cost: { lte: 3 } })).toContain('コスト3以下');
    expect(describeMatcher({ civs: ['water', 'darkness'] })).toContain('水/闇の');
    expect(describeMatcher({ type: 'creature' })).toContain('クリーチャー');
    expect(describeMatcher({ type: 'spell' })).toContain('呪文');
    expect(describeMatcher({ face: 'spell' })).toContain('呪文面');
    expect(describeMatcher({ face: 'creature' })).toContain('クリーチャー面');
    expect(describeMatcher({ cost: { eq: 7 }, costBasis: 'effective' })).toContain('[実コスト]');
  });
  it('describePredicate: 4種類の述語', () => {
    expect(describePredicate({ kind: 'castable', card: { names: ['X'] } })).toBe('X を使える');
    expect(describePredicate({ kind: 'cast', card: { names: ['X'] } })).toBe('X を使った');
    expect(describePredicate({ kind: 'manaCount', min: 5 })).toBe('マナが5枚以上');
    expect(describePredicate({ kind: 'manaCount', min: 2, civ: 'water' })).toBe('waterのマナが2枚以上');
    expect(describePredicate({ kind: 'zoneHas', zone: 'grave', card: { names: ['X'] } })).toBe('墓地に X が1枚以上');
    expect(describePredicate({ kind: 'zoneHas', zone: 'hand', card: {}, min: 3 })).toBe('手札に 任意のカード が3枚以上');
  });
  it('describeTiming: 4種類のタイミング', () => {
    expect(describeTiming({ turn: 4, at: 'anyMain' })).toBe('4ターン目のメインで');
    expect(describeTiming({ turn: 4, at: 'turnEnd' })).toBe('4ターン目の終了時に');
    expect(describeTiming({ turn: 4, at: 'byTurn' })).toBe('4ターン目までに');
    expect(describeTiming({ turn: 1, at: 'opening' })).toBe('初手に');
  });
  it('describeGoal: and / or / not を入れ子で表示する', () => {
    const g: Goal = { op: 'and', args: [manaGoal(5), { op: 'or', args: [manaGoal(6), { op: 'not', arg: manaGoal(7) }] }] };
    const t = describeGoal(g);
    expect(t).toContain(' かつ ');
    expect(t).toContain(' または ');
    expect(t).toContain('ではない');
  });
  it('プリセットはすべて表示できる', () => {
    for (const p of GOAL_PRESETS) expect(describeGoal(p.goal).length).toBeGreaterThan(0);
  });
});

describe('goalMaxTurn / goalHasNot', () => {
  it('述語は自身のターン(opening は1)', () => {
    expect(goalMaxTurn(manaGoal(5, 4))).toBe(4);
    expect(goalMaxTurn(pred(9, 'opening', { kind: 'manaCount', min: 0 }))).toBe(1);
  });
  it('and / or は最大、not は中身', () => {
    expect(goalMaxTurn({ op: 'and', args: [manaGoal(1, 2), manaGoal(1, 6), manaGoal(1, 3)] })).toBe(6);
    expect(goalMaxTurn({ op: 'not', arg: manaGoal(1, 5) })).toBe(5);
    expect(goalMaxTurn({ op: 'or', args: [] })).toBe(1);
  });
  it('goalHasNot: 入れ子の not を見つける', () => {
    expect(goalHasNot(manaGoal(1))).toBe(false);
    expect(goalHasNot({ op: 'not', arg: manaGoal(1) })).toBe(true);
    expect(goalHasNot({ op: 'and', args: [manaGoal(1), { op: 'or', args: [{ op: 'not', arg: manaGoal(2) }] }] })).toBe(true);
    expect(goalHasNot({ op: 'and', args: [manaGoal(1), manaGoal(2)] })).toBe(false);
  });
  it('プリセット(コスト7)のターン数', () => {
    expect(goalMaxTurn(presetCost7At4())).toBe(4);
  });
});

describe('nameMatches / matchCard', () => {
  const def = { id: 'x-1', name: '蒼狼の豊穣 ワクムテラス / オリジナル・ライフ' };
  it('ID・カード名・面の名前・部分一致', () => {
    expect(nameMatches(def, '蒼狼の豊穣 ワクムテラス', 'x-1')).toBe(true);
    expect(nameMatches(def, '蒼狼の豊穣 ワクムテラス', def.name)).toBe(true);
    expect(nameMatches(def, 'オリジナル・ライフ', 'オリジナル・ライフ')).toBe(true);
    expect(nameMatches(def, 'オリジナル・ライフ', 'ワクムテラス')).toBe(true);
    expect(nameMatches(def, 'オリジナル・ライフ', '無関係')).toBe(false);
  });

  const stateWith = (name: string) => {
    const s = buildState({ p0: { hand: [name] } });
    return { s, uid: s.players[0].hand[0] };
  };
  it('名前', () => {
    const { s, uid } = stateWith('天災 デドダム');
    expect(matchCard(reg, s, uid, { names: ['デドダム'] })).toBe(true);
    expect(matchCard(reg, s, uid, { names: ['マルル'] })).toBe(false);
    expect(matchCard(reg, s, uid, { names: ['マルル', 'デドダム'] })).toBe(true);
  });
  it('コスト(表記)と、実コストの切り替え', () => {
    const { s, uid } = stateWith('天災 デドダム');
    const cost = reg.defs[defIdOf('天災 デドダム')].faces[0].cost;
    expect(matchCard(reg, s, uid, { cost: { eq: cost } })).toBe(true);
    expect(matchCard(reg, s, uid, { cost: { gte: cost + 1 } })).toBe(false);
    expect(matchCard(reg, s, uid, { cost: { lte: cost - 1 } })).toBe(false);
    // 実コスト基準は、面と実コストが渡されたときだけ効く
    expect(matchCard(reg, s, uid, { cost: { eq: 1 }, costBasis: 'effective' }, 0, 1)).toBe(true);
    expect(matchCard(reg, s, uid, { cost: { eq: 1 }, costBasis: 'printed' }, 0, 1)).toBe(false);
    expect(matchCard(reg, s, uid, { cost: { eq: 1 }, costBasis: 'effective' })).toBe(false);
  });
  it('文明・種類・面', () => {
    const { s, uid } = stateWith('天災 デドダム');
    expect(matchCard(reg, s, uid, { civs: ['water'] })).toBe(true);
    expect(matchCard(reg, s, uid, { civs: ['fire', 'light'] })).toBe(false);
    expect(matchCard(reg, s, uid, { type: 'creature' })).toBe(true);
    expect(matchCard(reg, s, uid, { type: 'spell' })).toBe(false);
    expect(matchCard(reg, s, uid, { face: 'creature' })).toBe(true);
    expect(matchCard(reg, s, uid, { face: 'spell' })).toBe(false);
  });
  it('ツインパクト: 面を指定しなければどちらかの面で、指定すればその面だけで判定する', () => {
    const { s, uid } = stateWith('ワクムテラス');
    expect(matchCard(reg, s, uid, { type: 'spell' })).toBe(true);
    expect(matchCard(reg, s, uid, { type: 'creature' })).toBe(true);
    expect(matchCard(reg, s, uid, { type: 'spell' }, 0)).toBe(false);
    expect(matchCard(reg, s, uid, { type: 'spell' }, 1)).toBe(true);
    expect(matchCard(reg, s, uid, {}, 5)).toBe(false); // 存在しない面
  });
});

describe('myTurnNo', () => {
  it('席0の自分のターンだけ、1,3,5.. → 1,2,3.. に写す', () => {
    const s = buildState({ turn: 5, active: 0 });
    expect(myTurnNo(s)).toBe(3);
    s.turn = 1;
    expect(myTurnNo(s)).toBe(1);
    s.turn = 2;
    s.active = 1;
    expect(myTurnNo(s)).toBeNull();
  });
});

describe('collectLeaves', () => {
  it('同じ述語は1つにまとめる', () => {
    const g: Goal = { op: 'and', args: [manaGoal(5, 3), manaGoal(5, 4), { op: 'not', arg: manaGoal(6, 3) }] };
    expect(collectLeaves(g).size).toBe(2);
  });
});

describe('GoalTracker', () => {
  it('manaCount: メインでの観測', () => {
    const s = buildState({ p0: { mana: mana(5) }, turn: 5 });
    const t = new GoalTracker(manaGoal(5, 3, 'anyMain'), reg);
    expect(t.holds()).toBe(false);
    t.observeState(s, []);
    expect(t.holds()).toBe(true);
    expect(t.achievedTurn(3)).toBe(3);
  });
  it('anyMain は、その番号のターンでしか成立しない', () => {
    const s = buildState({ p0: { mana: mana(5) }, turn: 3 }); // 自分の2ターン目
    const t = new GoalTracker(manaGoal(5, 3, 'anyMain'), reg);
    t.observeState(s, []);
    expect(t.holds()).toBe(false);
    const t2 = new GoalTracker(manaGoal(5, 2, 'anyMain'), reg);
    t2.observeState(s, []);
    expect(t2.holds()).toBe(true);
  });
  it('byTurn: それ以前のどこかで成立していればよい。cap で打ち切れる', () => {
    const s = buildState({ p0: { mana: mana(5) }, turn: 3 }); // 自分の2ターン目で成立
    const t = new GoalTracker(manaGoal(5, 4, 'byTurn'), reg);
    t.observeState(s, []);
    expect(t.holds()).toBe(true);
    expect(t.holds(1)).toBe(false);
    expect(t.achievedTurn(4)).toBe(2);
  });
  it('メインでない・相手のターンでは観測しない', () => {
    const t = new GoalTracker(manaGoal(1, 3, 'byTurn'), reg);
    t.observeState(buildState({ p0: { mana: mana(5) }, step: 'attack' }), []);
    expect(t.holds()).toBe(false);
    t.observeState(buildState({ p0: { mana: mana(5) }, active: 1, turn: 4 }), []);
    expect(t.holds()).toBe(false);
  });
  it('opening(初手)の手札の条件', () => {
    const g = pred(1, 'opening', { kind: 'zoneHas', zone: 'hand', card: { names: ['デドダム'] }, min: 2 });
    const t1 = new GoalTracker(g, reg);
    t1.observeInitial(buildState({ p0: { hand: ['天災 デドダム', '天災 デドダム', 'ダミー'] } }));
    expect(t1.holds()).toBe(true);
    const t2 = new GoalTracker(g, reg);
    t2.observeInitial(buildState({ p0: { hand: ['天災 デドダム', 'ダミー'] } }));
    expect(t2.holds()).toBe(false);
    expect(t2.achievedTurn(1)).toBeNull();
  });
  it('zoneHas: マナ・墓地・バトルゾーン', () => {
    const s = buildState({ p0: { mana: ['フェアリー・ライフ'], grave: ['天災 デドダム'], battle: ['ヨビニオン・マルル'] } });
    for (const [zone, name, ok] of [
      ['mana', 'フェアリー・ライフ', true],
      ['grave', 'デドダム', true],
      ['battle', 'マルル', true],
      ['hand', 'マルル', false],
      ['grave', 'マルル', false],
    ] as const) {
      const t = new GoalTracker(pred(1, 'opening', { kind: 'zoneHas', zone, card: { names: [name] } }), reg);
      t.observeInitial(s);
      expect(t.holds(), `${zone} ${name}`).toBe(ok);
    }
  });
  it('castable: 合法手のなかに条件に合う使用があれば成立する', () => {
    const g = pred(3, 'anyMain', { kind: 'castable', card: { names: ['ヨビニオン・マルル'] } });
    const poor = buildState({ p0: { hand: ['ヨビニオン・マルル'], mana: mana(2) } });
    const rich = buildState({ p0: { hand: ['ヨビニオン・マルル'], mana: mana(6) } });
    const t1 = new GoalTracker(g, reg);
    t1.observeState(poor);
    expect(t1.holds()).toBe(false);
    const t2 = new GoalTracker(g, reg);
    t2.observeState(rich);
    expect(t2.holds()).toBe(true);
  });
  it('cast: 使ったイベントで成立し、コストを支払わない使用・相手の使用・召喚でない登場は数えない', () => {
    const g = pred(3, 'anyMain', { kind: 'cast', card: { names: ['デドダム'] } });
    const s = buildState({ p0: { battle: ['天災 デドダム'] } });
    const uid = s.players[0].battle[0].cards[0];
    const t = new GoalTracker(g, reg);
    const ev = (o: any) => [{ id: 1, causedBy: null, type: 'entered', turn: 5, owner: 0, card: uid, via: 'summon', ...o }] as any;
    t.observeEvents(s, ev({ free: true }), 3);
    expect(t.holds()).toBe(false);
    t.observeEvents(s, ev({ owner: 1 }), 3);
    expect(t.holds()).toBe(false);
    t.observeEvents(s, ev({ via: 'effect' }), 3);
    expect(t.holds()).toBe(false);
    t.observeEvents(s, ev({}), null); // 自分のターンではない
    expect(t.holds()).toBe(false);
    t.observeEvents(s, ev({}), 3);
    expect(t.holds()).toBe(true);
  });
  it('turnEnd: END_TURN の直前の状態を観測する', () => {
    const g = manaGoal(5, 3, 'turnEnd');
    const s = buildState({ p0: { mana: mana(5) } });
    const t = new GoalTracker(g, reg);
    t.observeStep(s, { type: 'END_MAIN' }, []);
    expect(t.holds()).toBe(false);
    t.observeStep(s, { type: 'END_TURN' }, []);
    expect(t.holds()).toBe(true);
  });
  it('and / or / not の評価', () => {
    const s = buildState({ p0: { mana: mana(5) }, turn: 5 });
    const mk = (g: Goal) => {
      const t = new GoalTracker(g, reg);
      t.observeState(s, []);
      return t.holds();
    };
    expect(mk({ op: 'and', args: [manaGoal(5), manaGoal(6)] })).toBe(false);
    expect(mk({ op: 'or', args: [manaGoal(5), manaGoal(6)] })).toBe(true);
    expect(mk({ op: 'not', arg: manaGoal(6) })).toBe(true);
    expect(mk({ op: 'not', arg: manaGoal(5) })).toBe(false);
  });
  it('文明を指定したマナ枚数(多色は各文明に数える)', () => {
    const s = buildState({ p0: { mana: [...mana(3), '天災 デドダム'] } });
    const t = new GoalTracker(manaGoal(2, 3, 'anyMain', 'water'), reg);
    t.observeState(s, []);
    expect(t.holds()).toBe(false); // 水は多色のデドダム1枚だけ
    const t2 = new GoalTracker(manaGoal(4, 3, 'anyMain', 'nature'), reg);
    t2.observeState(s, []);
    expect(t2.holds()).toBe(true); // 自然3枚+デドダム
  });
  it('clone は独立した記録を持ち、signature は記録で変わる', () => {
    const t = new GoalTracker(manaGoal(5, 3, 'anyMain'), reg);
    const sig0 = t.signature();
    const c = t.clone();
    t.observeState(buildState({ p0: { mana: mana(5) } }), []);
    expect(t.holds()).toBe(true);
    expect(c.holds()).toBe(false);
    expect(t.signature()).not.toBe(sig0);
    expect(c.signature()).toBe(sig0);
  });
});
