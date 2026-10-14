import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../../src/cards';
import { loadRegistry } from '../../src/engine/registry';
import { checkInvariants } from '../../src/engine/invariants';
import type { Goal } from '../../src/sim/goal';
import {
  arrangeDeck,
  buildGame,
  exactDrawProbability,
  replayPattern,
  runPatterns,
  runPolicyTrial,
  runProbability,
  searchTrial,
  type SolitaireParams,
} from '../../src/sim/solitaire';
import { hypergeomAtLeast } from '../../src/sim/stats';

const reg = loadRegistry(CARD_DB);
const maruru = deckCards('maruru');

const hand = (name: string, min = 1, turn = 1, at: 'opening' | 'byTurn' | 'anyMain' = 'opening'): Goal => ({
  op: 'pred',
  timing: { turn, at },
  pred: { kind: 'zoneHas', zone: 'hand', card: { names: [name] }, min },
});
const mana5: Goal = { op: 'pred', timing: { turn: 3, at: 'byTurn' }, pred: { kind: 'manaCount', min: 5 } };
const params = (o: Partial<SolitaireParams> = {}): SolitaireParams => ({ deck: maruru, first: 0, goal: mana5, trials: 6, seed: 5, ...o });

describe('arrangeDeck(初期条件)', () => {
  it('並びは元のデッキの並べ替え(枚数・内訳が保存される)', () => {
    const o = arrangeDeck(reg, maruru, 1);
    expect(o).toHaveLength(40);
    expect([...o].sort()).toEqual([...maruru].sort());
  });
  it('同じシードなら同じ並び、違うシードなら別の並び', () => {
    expect(arrangeDeck(reg, maruru, 5)).toEqual(arrangeDeck(reg, maruru, 5));
    expect(arrangeDeck(reg, maruru, 5)).not.toEqual(arrangeDeck(reg, maruru, 6));
  });
  it('存在しない名前の指定は無視される', () => {
    const o = arrangeDeck(reg, maruru, 1, { mustHand: ['そんなカードはない'], mustNotHand: ['これもない'], topFixed: ['あれもない'] });
    expect(o).toHaveLength(40);
  });
  it('デッキに含まれないカードを必ず含めると指定しても、並びは崩れない', () => {
    const o = arrangeDeck(reg, maruru, 1, { mustHand: ['ドンドン火噴くナウ'] });
    expect(o).toHaveLength(40);
    expect([...o].sort()).toEqual([...maruru].sort());
  });
  it('初手に複数枚を指定できる(同じカードの2枚も可)', () => {
    for (let i = 0; i < 20; i++) {
      const o = arrangeDeck(reg, maruru, i, { mustHand: ['天災 デドダム', '天災 デドダム', 'ジ・ウォッチ'] });
      const h = o.slice(5, 10);
      expect(h.filter((x) => x === 'dm23bd1-014').length).toBeGreaterThanOrEqual(2);
      expect(h).toContain('dm24rp2-TR03');
    }
  });
  it('シールドは「初手から除外した」カードも含めて、先頭5枚', () => {
    const o = arrangeDeck(reg, maruru, 2, { mustNotHand: ['天災 デドダム'] });
    expect(o.slice(5, 10)).not.toContain('dm23bd1-014');
    expect(o.slice(0, 5)).toHaveLength(5);
  });
  it('山札の上の固定は複数枚でき、並び順が保たれる(山札に残っているカードのみ)', () => {
    const fixed = ['dm24rp3-008', 'dm24rp2-TR03'];
    let checked = 0;
    for (let seed = 0; seed < 40; seed++) {
      const o = arrangeDeck(reg, maruru, seed, { topFixed: ['九番龍 ジゴクバンカー', 'ジ・ウォッチ'] });
      // 先に初手・シールドに入った札は、山札の上には置けない(現状の仕様)
      const stillInDeck = fixed.filter((id) => !o.slice(0, 10).includes(id));
      expect(o.slice(10, 10 + stillInDeck.length)).toEqual(stillInDeck);
      checked += stillInDeck.length;
    }
    expect(checked).toBeGreaterThan(40);
  });
  it('山札の上に固定したカードを、初手には引かない(mustNotHand との併用でも壊れない)', () => {
    const o = arrangeDeck(reg, maruru, 4, { topFixed: ['九番龍 ジゴクバンカー'], mustNotHand: ['九番龍 ジゴクバンカー'] });
    expect(o.slice(5, 10)).not.toContain('dm24rp3-008');
    expect(o).toHaveLength(40);
  });
});

describe('buildGame', () => {
  it('相手はダミーのデッキで、一人回しの設定になる', () => {
    const s = buildGame(reg, params(), 1);
    expect(s.cfg.solitaire).toBe(true);
    expect(s.players[1].deck.length + s.players[1].hand.length + s.players[1].shield.length).toBe(40);
    expect(s.cards.filter((c) => c.owner === 1).every((c) => c.defId === 'dummy')).toBe(true);
    expect(checkInvariants(s)).toEqual([]);
  });
  it('先攻・後攻の指定が反映される', () => {
    expect(buildGame(reg, params({ first: 0 }), 1).first).toBe(0);
    expect(buildGame(reg, params({ first: 1 }), 1).first).toBe(1);
  });
  it('同じ試行シードなら、同じ初期状態', () => {
    const a = buildGame(reg, params(), 9);
    const b = buildGame(reg, params(), 9);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('初期条件(初手に含む)が反映される', () => {
    for (let i = 0; i < 10; i++) {
      const s = buildGame(reg, params({ initial: { mustHand: ['九番龍 ジゴクバンカー'] } }), i);
      expect(s.players[0].hand.map((u) => s.cards[u].defId)).toContain('dm24rp3-008');
    }
  });
});

describe('exactDrawProbability(超幾何分布の厳密値)', () => {
  it('手札の枚数の目標だけが対象。マナ枚数などは undefined', () => {
    expect(exactDrawProbability(reg, { deck: maruru, goal: mana5, first: 0 })).toBeUndefined();
    expect(exactDrawProbability(reg, { deck: maruru, goal: { op: 'not', arg: hand('天災 デドダム') }, first: 0 })).toBeUndefined();
    const grave: Goal = { op: 'pred', timing: { turn: 1, at: 'opening' }, pred: { kind: 'zoneHas', zone: 'grave', card: { names: ['天災 デドダム'] } } };
    expect(exactDrawProbability(reg, { deck: maruru, goal: grave, first: 0 })).toBeUndefined();
  });
  it('初手: 5枚(シールドの次の5枚)から引く', () => {
    const r = exactDrawProbability(reg, { deck: maruru, goal: hand('天災 デドダム'), first: 0 })!;
    expect(r.value).toBeCloseTo(hypergeomAtLeast(40, 4, 5, 1), 12);
  });
  it('「2枚以上」の確率', () => {
    const r = exactDrawProbability(reg, { deck: maruru, goal: hand('天災 デドダム', 2), first: 0 })!;
    expect(r.value).toBeCloseTo(hypergeomAtLeast(40, 4, 5, 2), 12);
    expect(r.value).toBeLessThan(hypergeomAtLeast(40, 4, 5, 1));
  });
  it('Nターン目まで: 先攻は N-1 枚、後攻は N 枚を追加で引く', () => {
    const g = hand('天災 デドダム', 1, 4, 'byTurn');
    expect(exactDrawProbability(reg, { deck: maruru, goal: g, first: 0 })!.value).toBeCloseTo(hypergeomAtLeast(40, 4, 8, 1), 12);
    expect(exactDrawProbability(reg, { deck: maruru, goal: g, first: 1 })!.value).toBeCloseTo(hypergeomAtLeast(40, 4, 9, 1), 12);
  });
  it('名前以外の条件(コスト・文明)でも枚数を数える', () => {
    const g: Goal = { op: 'pred', timing: { turn: 1, at: 'opening' }, pred: { kind: 'zoneHas', zone: 'hand', card: { cost: { eq: 7 } } } };
    const K = maruru.filter((id) => CARD_DB[id].faces[0].cost === 7).length;
    const r = exactDrawProbability(reg, { deck: maruru, goal: g, first: 0 })!;
    expect(r.value).toBeCloseTo(hypergeomAtLeast(40, K, 5, 1), 12);
    const g2: Goal = { op: 'pred', timing: { turn: 1, at: 'opening' }, pred: { kind: 'zoneHas', zone: 'hand', card: { civs: ['darkness'] } } };
    const K2 = maruru.filter((id) => CARD_DB[id].faces[0].civs.includes('darkness')).length;
    expect(exactDrawProbability(reg, { deck: maruru, goal: g2, first: 0 })!.value).toBeCloseTo(hypergeomAtLeast(40, K2, 5, 1), 12);
  });
  it('当たりが0枚なら確率0', () => {
    const r = exactDrawProbability(reg, { deck: maruru, goal: hand('ドンドン火噴くナウ'), first: 0 })!;
    expect(r.value).toBe(0);
  });
});

describe('runProbability の挙動', () => {
  it('maxNodes=0(既定)なら探索しない', () => {
    expect(runProbability(CARD_DB, params()).search).toBeUndefined();
  });
  it('maxNodes>0 なら探索結果が付き、数が整合する', () => {
    const r = runProbability(CARD_DB, params({ maxNodes: 3000, trials: 8 }));
    const s = r.search!;
    expect(s.judged + s.unknown).toBe(8);
    expect(s.achieved).toBeLessThanOrEqual(s.judged);
    expect(s.maxRate).toBeGreaterThanOrEqual(s.achieved / 8);
  });
  it('進捗とキャンセル', () => {
    const calls: number[] = [];
    let n = 0;
    const r = runProbability(CARD_DB, params({ trials: 10 }), { onProgress: (d) => { calls.push(d); n = d; }, shouldCancel: () => n >= 4 });
    expect(r.trials).toBe(4);
    expect(calls).toEqual([1, 2, 3, 4]);
  });
  it('maxTurns を指定すると、その長さの表になる', () => {
    const r = runProbability(CARD_DB, params({ maxTurns: 5 }));
    expect(r.maxTurns).toBe(5);
    expect(r.policy.byTurn).toHaveLength(6);
    expect(r.policy.turnDist).toHaveLength(6);
  });
  it('累積は初達成の分布の和に一致する', () => {
    const r = runProbability(CARD_DB, params({ trials: 20 }));
    let acc = 0;
    r.policy.turnDist.forEach((d, t) => {
      acc += d;
      expect(r.policy.byTurn[t]).toBeCloseTo(acc, 10);
    });
  });
  it('初手の目標は 0 ターン目で達成として数えられる', () => {
    const r = runProbability(CARD_DB, params({ goal: hand('天災 デドダム'), trials: 30 }));
    expect(r.policy.byTurn[0]).toBeCloseTo(r.policy.rate, 12);
  });
  it('達成できない目標(デッキにないカード)は 0%', () => {
    const r = runProbability(CARD_DB, params({ goal: hand('ドンドン火噴くナウ'), trials: 10 }));
    expect(r.policy.rate).toBe(0);
    expect(r.exact?.value).toBe(0);
  });
  it('自由モード(40枚でないデッキ)も調べられる', () => {
    const r = runProbability(CARD_DB, params({ deck: maruru.slice(0, 20), goal: hand('天災 デドダム'), trials: 5, free: true }));
    expect(r.trials).toBe(5);
  });
});

describe('runPolicyTrial', () => {
  it('方針プレイは攻撃しない(一人回し)ので、勝敗は付かない', () => {
    const run = runPolicyTrial(reg, params({ trials: 1 }), 1);
    expect(run.actions.every((a) => a.type !== 'ATTACK')).toBe(true);
  });
  it('ランダムAIでも完走し、行動の数はターン数に比例する範囲に収まる', () => {
    const run = runPolicyTrial(reg, params({ agent: { kind: 'random' } }), 3);
    expect(run.actions.length).toBeGreaterThan(0);
    expect(run.actions.length).toBeLessThan(3000);
  });
  it('パスなら、マナも増えないので「マナ5枚」は達成されない', () => {
    const run = runPolicyTrial(reg, params({ agent: { kind: 'pass' } }), 3);
    expect(run.achievedTurn).toBeNull();
  });
});

describe('searchTrial', () => {
  it('見つかった履歴の行動列は、再生すると目標を満たす', () => {
    const p = params({ maxNodes: 6000 });
    for (let seed = 1; seed <= 6; seed++) {
      const sr = searchTrial(reg, p, seed, 2);
      if (!sr.found) continue;
      expect(sr.histories.length).toBeGreaterThan(0);
      const { states } = replayPattern(CARD_DB, p, seed, sr.histories[0].actions);
      expect(states.some((s) => s.players[0].mana.length >= 5)).toBe(true);
    }
  });
  it('ノード上限が小さければ未判定(unknown)になりうる。found と unknown は同時に立たない', () => {
    const sr = searchTrial(reg, params({ maxNodes: 3, goal: { ...mana5, timing: { turn: 6, at: 'byTurn' } } as Goal }), 1, 1);
    expect(sr.found && sr.unknown).toBe(false);
    expect(sr.nodes).toBeLessThanOrEqual(10);
  });
  it('開始時点で達成している目標は、行動なしで見つかる', () => {
    const sr = searchTrial(reg, params({ goal: hand('天災 デドダム'), maxNodes: 100 }), 4, 1);
    const h = buildGame(reg, params(), 4).players[0].hand.map((u) => buildGame(reg, params(), 4).cards[u].defId);
    expect(sr.found).toBe(h.includes('dm23bd1-014'));
  });
});

describe('runPatterns の挙動', () => {
  const base = () => params({ trials: 8, seed: 3, maxNodes: 4000 });
  it('粒度: ordered ≥ set ≥ cards の順にパターン数が減る(同じ探索結果なら)', () => {
    const o = runPatterns(CARD_DB, base(), { granularity: 'ordered', maxHistoriesPerTrial: 8 });
    const s = runPatterns(CARD_DB, base(), { granularity: 'set', maxHistoriesPerTrial: 8 });
    const c = runPatterns(CARD_DB, base(), { granularity: 'cards', maxHistoriesPerTrial: 8 });
    expect(s.patterns.length).toBeLessThanOrEqual(o.patterns.length);
    expect(c.patterns.length).toBeLessThanOrEqual(s.patterns.length);
  });
  it('choices 粒度でも動き、割合は 0〜1', () => {
    const r = runPatterns(CARD_DB, base(), { granularity: 'choices', maxHistoriesPerTrial: 5 });
    for (const p of r.patterns) {
      expect(p.ratioAll).toBeGreaterThan(0);
      expect(p.ratioAll).toBeLessThanOrEqual(1);
      expect(p.ratioAchieved).toBeLessThanOrEqual(1);
    }
  });
  it('件数順に並び、達成試行数・未判定の合計が試行数を超えない', () => {
    const r = runPatterns(CARD_DB, base());
    for (let i = 1; i < r.patterns.length; i++) expect(r.patterns[i - 1].count).toBeGreaterThanOrEqual(r.patterns[i].count);
    expect(r.achievedTrials + r.unknownTrials).toBeLessThanOrEqual(r.trials);
    for (const p of r.patterns) expect(p.count).toBeLessThanOrEqual(r.achievedTrials);
  });
  it('進捗とキャンセル', () => {
    let n = 0;
    const r = runPatterns(CARD_DB, base(), {}, { onProgress: (d) => (n = d), shouldCancel: () => n >= 2 });
    expect(r.trials).toBe(2);
  });
  it('同じ入力なら同じ結果', () => {
    const a = runPatterns(CARD_DB, base(), { maxHistoriesPerTrial: 4 });
    const b = runPatterns(CARD_DB, base(), { maxHistoriesPerTrial: 4 });
    expect({ ...a, ms: 0 }).toEqual({ ...b, ms: 0 });
  });
});

describe('replayPattern', () => {
  it('行動なしなら初期状態だけ', () => {
    const r = replayPattern(CARD_DB, params(), 1, []);
    expect(r.states).toHaveLength(1);
    expect(r.events).toEqual([[]]);
  });
  it('不正な行動は例外', () => {
    expect(() => replayPattern(CARD_DB, params(), 1, [{ type: 'END_TURN' }])).toThrow();
  });
  it('各手のあとの状態とイベントが、行動と同じ数だけ返る', () => {
    const p = params({ maxNodes: 4000 });
    const run = runPolicyTrial(reg, p, 2);
    const r = replayPattern(CARD_DB, p, 2, run.actions.slice(0, 5));
    expect(r.states).toHaveLength(6);
    expect(r.events).toHaveLength(6);
    for (const s of r.states) expect(checkInvariants(s)).toEqual([]);
  });
});

describe('exactDrawProbability: 初期条件があれば出さない(ISSUE-02)', () => {
  it('初手の固定・除外・山札の上の固定のどれかがあると undefined', () => {
    const g = hand('天災 デドダム');
    expect(exactDrawProbability(reg, { deck: maruru, goal: g, first: 0 })).toBeDefined();
    expect(exactDrawProbability(reg, { deck: maruru, goal: g, first: 0, initial: {} })).toBeDefined();
    expect(exactDrawProbability(reg, { deck: maruru, goal: g, first: 0, initial: { mustHand: ['天災 デドダム'] } })).toBeUndefined();
    expect(exactDrawProbability(reg, { deck: maruru, goal: g, first: 0, initial: { mustNotHand: ['天災 デドダム'] } })).toBeUndefined();
    expect(exactDrawProbability(reg, { deck: maruru, goal: g, first: 0, initial: { topFixed: ['天災 デドダム'] } })).toBeUndefined();
  });
  it('runProbability の結果にも、初期条件がある時は exact が付かない', () => {
    const r = runProbability(CARD_DB, params({ goal: hand('天災 デドダム'), trials: 5, initial: { mustHand: ['天災 デドダム'] } }));
    expect(r.exact).toBeUndefined();
    expect(r.policy.rate).toBe(1);
  });
});
