// 探索(限定食い違い探索 + 目標までの距離による順序づけ・足切り)のテスト。
import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../../src/cards';
import { loadRegistry } from '../../src/engine/registry';
import { FAR, goalDistance, GoalTracker, predicateDistance, type Goal, type Predicate } from '../../src/sim/goal';
import { buildGame, searchTrial, type SolitaireParams } from '../../src/sim/solitaire';

const reg = loadRegistry(CARD_DB);
const maruru = deckCards('maruru');
const MARURU = 'ヨビニオン・マルル';

const battle = (name: string, turn: number, at: 'byTurn' | 'anyMain' | 'turnEnd' = 'byTurn'): Goal => ({
  op: 'pred',
  timing: { turn, at },
  pred: { kind: 'zoneHas', zone: 'battle', card: { names: [name] } },
});
const manaGoal = (min: number, turn: number): Goal => ({ op: 'pred', timing: { turn, at: 'byTurn' }, pred: { kind: 'manaCount', min } });
const params = (goal: Goal, o: Partial<SolitaireParams> = {}): SolitaireParams => ({ deck: maruru, first: 0, goal, trials: 1, seed: 1, maxNodes: 3000, ...o });

describe('GoalTracker.possible(期限切れの足切り)', () => {
  const t = (g: Goal) => new GoalTracker(g, reg);
  it('期限内なら成立しうる。期限を過ぎて成立していなければ成立しない', () => {
    const tr = t(battle(MARURU, 3));
    expect(tr.possible(1)).toBe(true);
    expect(tr.possible(3)).toBe(true);
    expect(tr.possible(4)).toBe(false);
  });
  it('anyMain / turnEnd も、そのターンを過ぎれば成立しない', () => {
    expect(t(battle(MARURU, 2, 'anyMain')).possible(2)).toBe(true);
    expect(t(battle(MARURU, 2, 'anyMain')).possible(3)).toBe(false);
    expect(t(battle(MARURU, 2, 'turnEnd')).possible(3)).toBe(false);
  });
  it('初手の目標は、成立していなければゲーム開始後は成立しない', () => {
    const g: Goal = { op: 'pred', timing: { turn: 1, at: 'opening' }, pred: { kind: 'zoneHas', zone: 'hand', card: { names: [MARURU] } } };
    expect(t(g).possible(1)).toBe(false);
  });
  it('and は全て、or はどれか。not は判断しない(成立しうる)', () => {
    const early = battle(MARURU, 2);
    const late = battle(MARURU, 6);
    expect(t({ op: 'and', args: [early, late] }).possible(4)).toBe(false);
    expect(t({ op: 'or', args: [early, late] }).possible(4)).toBe(true);
    expect(t({ op: 'not', arg: early }).possible(9)).toBe(true);
  });
});

describe('目標までの距離(順序づけ・足切りの近似)', () => {
  it('必要なカードが、自分のどこにもなければ FAR(届かない)', () => {
    const s = buildGame(reg, params(battle('ドンドン火噴くナウ', 4)), 1);
    expect(predicateDistance(reg, s, { kind: 'zoneHas', zone: 'battle', card: { names: ['ドンドン火噴くナウ'] } })).toBeGreaterThanOrEqual(FAR);
  });
  it('手札にあれば、バトルゾーンまで1。山札にあれば、それより遠い', () => {
    const inHand = buildGame(reg, params(battle(MARURU, 4), { initial: { mustHand: [MARURU] } }), 1);
    const pred: Predicate = { kind: 'zoneHas', zone: 'battle', card: { names: [MARURU] } };
    expect(predicateDistance(reg, inHand, pred)).toBe(1);
    const inDeck = buildGame(reg, params(battle(MARURU, 4), { initial: { mustNotHand: [MARURU] } }), 1);
    expect(predicateDistance(reg, inDeck, pred)).toBeGreaterThan(1);
    expect(predicateDistance(reg, inDeck, pred)).toBeLessThan(FAR);
  });
  it('マナの枚数は、足りない枚数', () => {
    const s = buildGame(reg, params(manaGoal(5, 3)), 1);
    expect(predicateDistance(reg, s, { kind: 'manaCount', min: 5 })).toBe(5);
    expect(predicateDistance(reg, s, { kind: 'manaCount', min: 0 })).toBe(0);
  });
  it('and は合計、or は最小。成立済みの述語は 0', () => {
    const s = buildGame(reg, params(manaGoal(5, 3)), 1);
    const x = manaGoal(3, 3);
    const y = manaGoal(5, 3);
    const and: Goal = { op: 'and', args: [x, y] };
    const or: Goal = { op: 'or', args: [x, y] };
    const not: Goal = { op: 'not', arg: x };
    expect(goalDistance(reg, s, and, new GoalTracker(and, reg))).toBe(8);
    expect(goalDistance(reg, s, or, new GoalTracker(or, reg))).toBe(3);
    expect(goalDistance(reg, s, not, new GoalTracker(not, reg))).toBe(0);
    // 成立済みの述語は 0(記録に成立が入っている)
    const done = new GoalTracker(x, reg);
    done.observeInitial({ ...s, players: [{ ...s.players[0], mana: [1, 2, 3] }, s.players[1]] } as typeof s);
    expect(goalDistance(reg, s, x, done)).toBe(0);
  });
});

describe('searchTrial(限定食い違い探索)', () => {
  it('到達できる目標は、少ないノード数で見つかる', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const r = searchTrial(reg, params(battle(MARURU, 6), { seed }), seed, 1);
      expect(r.found).toBe(true);
      expect(r.nodes).toBeLessThan(3000);
    }
  });
  it('見つかった履歴を再生すると、目標が成立する(履歴の行動が合法で、最後まで進む)', () => {
    const r = searchTrial(reg, params(battle(MARURU, 6)), 1, 1);
    expect(r.found).toBe(true);
    expect(r.histories[0].actions.length).toBeGreaterThan(0);
  });
  it('必要なカードがデッキにない目標は、すぐに「届かない」と確定する(不明にならない)', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const r = searchTrial(reg, params(battle('ドンドン火噴くナウ', 4), { seed }), seed, 1);
      expect(r.found).toBe(false);
      expect(r.unknown).toBe(false);
      expect(r.nodes).toBeLessThan(10);
    }
  });
  it('枚数が足りず届かない目標は、全探索して「届かない」と確定する', () => {
    // 3ターンまでにマナ12枚は不可能
    const r = searchTrial(reg, params(manaGoal(12, 3), { seed: 2 }), 2, 1);
    expect(r.found).toBe(false);
    expect(r.unknown).toBe(false);
  });
  it('ノード数の上限に達したら「不明」(届かないとは言わない)', () => {
    const r = searchTrial(reg, params(manaGoal(12, 3), { seed: 2, maxNodes: 50 }), 2, 1);
    expect(r.found).toBe(false);
    expect(r.unknown).toBe(true);
  });
  it('同じシードなら同じ結果(再現できる)', () => {
    const a = searchTrial(reg, params(battle(MARURU, 6), { seed: 3 }), 3, 3);
    const b = searchTrial(reg, params(battle(MARURU, 6), { seed: 3 }), 3, 3);
    expect(a.nodes).toBe(b.nodes);
    expect(a.histories.map((h) => h.steps)).toEqual(b.histories.map((h) => h.steps));
  });
  it('複数の履歴を集められる(重複しない)', () => {
    const r = searchTrial(reg, params(battle(MARURU, 6), { maxNodes: 6000 }), 1, 4);
    const keys = r.histories.map((h) => h.steps.map((x) => `${x.turn}:${x.kind}:${x.name}`).join('>'));
    expect(new Set(keys).size).toBe(keys.length);
    expect(r.histories.length).toBeGreaterThanOrEqual(2);
  });
});
