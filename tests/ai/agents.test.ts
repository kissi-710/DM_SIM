import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../../src/cards';
import { decide } from '../../src/ai/decide';
import { evaluate, reward } from '../../src/ai/eval';
import { AGENT_LABEL, makeAgent, passAgent, type AgentKind } from '../../src/ai';
import { makeMcts, rolloutPick } from '../../src/ai/mcts';
import { randomAgent } from '../../src/ai/random';
import { chooseTurnAction, makeRuleBased } from '../../src/ai/rulebased';
import { createGame, legalActions, step } from '../../src/engine/engine';
import type { Action, GameState } from '../../src/engine/types';
import { runMatches } from '../../src/sim/batch';
import { mulberry, playGameSync } from '../../src/sim/playGame';
import { buildState, mana, reg } from '../scenario';

const fresh = (seed = 3, first: 0 | 1 = 0) =>
  createGame(CARD_DB, { decks: [deckCards('maruru'), deckCards('zardy')], seed, first }).state;

/** 数手進めた、より複雑な状態 */
const advanced = (seed: number, moves: number): GameState => {
  let s = fresh(seed);
  const rand = mulberry(seed);
  for (let i = 0; i < moves && s.winner === null; i++) {
    const legal = legalActions(s, reg);
    s = step(s, legal[Math.floor(rand() * legal.length)], reg).state;
  }
  return s;
};

const ctx = (seed = 1) => ({ rand: mulberry(seed), reg });

describe('makeAgent / AGENT_LABEL', () => {
  it('すべての種類のエージェントを作れ、ラベルがある', () => {
    for (const kind of ['random', 'rule', 'mcts', 'pass'] as AgentKind[]) {
      const a = makeAgent({ kind });
      expect(a.name.length).toBeGreaterThan(0);
      expect(typeof a.chooseAction).toBe('function');
      expect(AGENT_LABEL[kind].length).toBeGreaterThan(0);
    }
  });
  it('random と pass は隠れた情報を読まない(needsView=false)', () => {
    expect(makeAgent({ kind: 'random' }).needsView).toBe(false);
    expect(makeAgent({ kind: 'pass' }).needsView).toBe(false);
    expect(makeAgent({ kind: 'rule' }).needsView).not.toBe(false);
    expect(makeAgent({ kind: 'mcts' }).needsView).not.toBe(false);
  });
  it('情報条件(policy)がエージェントに引き継がれる', () => {
    const policy = { preset: 'full', knowOpponentDecklist: true } as const;
    expect(makeAgent({ kind: 'rule', policy }).policy).toEqual(policy);
    expect(makeAgent({ kind: 'mcts', policy }).policy).toEqual(policy);
  });
});

describe('randomAgent', () => {
  it('合法手のなかから選び、同じ乱数なら同じ手を選ぶ', () => {
    const s = fresh();
    const legal = legalActions(s, reg);
    const a = randomAgent.chooseAction(s, legal, ctx(5)) as Action;
    const b = randomAgent.chooseAction(s, legal, ctx(5)) as Action;
    expect(legal).toContainEqual(a);
    expect(a).toEqual(b);
  });
  it('乱数の端(0 と 0.999..)でも範囲内', () => {
    const legal: Action[] = [{ type: 'END_MAIN' }, { type: 'END_TURN' }, { type: 'SKIP_MANA' }];
    expect(randomAgent.chooseAction(fresh(), legal, { rand: () => 0, reg })).toEqual(legal[0]);
    expect(randomAgent.chooseAction(fresh(), legal, { rand: () => 0.9999999, reg })).toEqual(legal[2]);
  });
  it('十分な回数を選ぶと、すべての手が選ばれる', () => {
    const legal: Action[] = [{ type: 'END_MAIN' }, { type: 'END_TURN' }, { type: 'SKIP_MANA' }, { type: 'ANSWER', id: 1, value: true }];
    const rand = mulberry(9);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(JSON.stringify(randomAgent.chooseAction(fresh(), legal, { rand, reg })));
    expect(seen.size).toBe(4);
  });
});

describe('passAgent', () => {
  const pick = (legal: Action[]) => passAgent.chooseAction(fresh(), legal, ctx()) as Action;
  it('マナチャージはスキップし、使用も攻撃もしない', () => {
    expect(pick([{ type: 'CHARGE_MANA', uid: 1 }, { type: 'SKIP_MANA' }])).toEqual({ type: 'SKIP_MANA' });
    expect(pick([{ type: 'PLAY_CARD', uid: 1 }, { type: 'END_MAIN' }, { type: 'END_TURN' }])).toEqual({ type: 'END_TURN' });
    expect(pick([{ type: 'PLAY_CARD', uid: 1 }, { type: 'END_MAIN' }])).toEqual({ type: 'END_MAIN' });
  });
  it('選択の場面では先頭の回答を返す', () => {
    const a: Action = { type: 'ANSWER', id: 3, value: [1] };
    expect(pick([a, { type: 'ANSWER', id: 3, value: [] }])).toEqual(a);
  });
  it('パスだけで1試合進めても、マナはまったく増えない', () => {
    const r = playGameSync(CARD_DB, [passAgent, passAgent], { decks: [deckCards('maruru'), deckCards('zardy')], seed: 2, maxSteps: 60 });
    expect(r.state.players[0].mana.length).toBe(0);
    expect(r.state.players[1].mana.length).toBe(0);
  });
});

describe('evaluate / reward(盤面評価)', () => {
  it('勝ちは +1000、負けは -1000、引き分けは 0', () => {
    const s = fresh();
    expect(evaluate({ ...s, winner: 0 }, reg, 0)).toBe(1000);
    expect(evaluate({ ...s, winner: 0 }, reg, 1)).toBe(-1000);
    expect(evaluate({ ...s, winner: 'draw' }, reg, 0)).toBe(0);
  });
  it('対称: 自分の評価 = -相手の評価', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const s = advanced(seed, 30);
      expect(evaluate(s, reg, 0)).toBeCloseTo(-evaluate(s, reg, 1), 10);
    }
  });
  it('シールド・手札・マナ・場のクリーチャーが多いほど評価が上がる', () => {
    const base = buildState({ p0: { shield: 3, hand: ['ダミー'] }, p1: { shield: 3, hand: ['ダミー'] } });
    const e0 = evaluate(base, reg, 0);
    expect(e0).toBeCloseTo(0, 10);
    const more = (spec: any) => evaluate(buildState({ p0: { shield: 3, hand: ['ダミー'], ...spec }, p1: { shield: 3, hand: ['ダミー'] } }), reg, 0);
    expect(more({ shield: 4 })).toBeGreaterThan(e0);
    expect(more({ hand: ['ダミー', 'ダミー'] })).toBeGreaterThan(e0);
    expect(more({ mana: mana(2) })).toBeGreaterThan(e0);
    expect(more({ battle: ['ダミー'] })).toBeGreaterThan(e0);
    // パワーが高いほど、ブロッカーを持つほど高い
    expect(more({ battle: ['終末縫合王 ザ=キラー・キーナリー'] })).toBeGreaterThan(more({ battle: ['ダミー'] }));
    expect(more({ battle: ['ティンパニ=シンバリー'] })).toBeGreaterThan(more({ battle: ['ヨビニオン・トライブ'] }));
  });
  it('山札が尽きそうなら不利になる', () => {
    const mk = (deck: number) => buildState({ p0: { deck }, p1: { deck: 20 } });
    expect(evaluate(mk(2), reg, 0)).toBeLessThan(evaluate(mk(10), reg, 0));
  });
  it('マナは10枚までしか数えない', () => {
    const mk = (n: number) => evaluate(buildState({ p0: { mana: mana(n) } }), reg, 0);
    expect(mk(12)).toBeCloseTo(mk(10), 10);
  });
  it('reward は 0〜1。勝ち=1、負け=0、引き分け=0.5。評価が高いほど大きい', () => {
    const s = fresh();
    expect(reward({ ...s, winner: 0 }, reg, 0)).toBe(1);
    expect(reward({ ...s, winner: 1 }, reg, 0)).toBe(0);
    expect(reward({ ...s, winner: 'draw' }, reg, 0)).toBe(0.5);
    const lo = reward(buildState({ p0: { shield: 1 } }), reg, 0);
    const hi = reward(buildState({ p0: { shield: 5, battle: ['ダミー'] } }), reg, 0);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
    expect(hi).toBeGreaterThan(lo);
    expect(reward(buildState({}), reg, 0)).toBeCloseTo(0.5, 10);
  });
});

describe('chooseTurnAction(ルールベースの手順)', () => {
  const choose = (s: GameState): Action => chooseTurnAction(s, legalActions(s, reg), ctx());

  it('マナチャージのステップでは、必ずマナチャージする', () => {
    const s = buildState({ step: 'mana', p0: { hand: ['アクアン', '九番龍 ジゴクバンカー'] } });
    const a = choose(s);
    expect(a.type).toBe('CHARGE_MANA');
    expect(s.players[0].hand).toContain((a as any).uid);
  });
  it('手札が高コストばかりなら、一番重いカードをマナに置く', () => {
    const s = buildState({ step: 'mana', p0: { hand: ['アクアン', '九番龍 ジゴクバンカー'] } });
    const a = choose(s) as Extract<Action, { type: 'CHARGE_MANA' }>;
    expect(s.cards[a.uid].defId).toBe('dm24rp3-008');
  });
  it('メインでは、使えるカードがあれば使う(終了より優先)', () => {
    const s = buildState({ p0: { hand: ['アクアン'], mana: mana(4, '天災 デドダム') } });
    expect(choose(s).type).toBe('PLAY_CARD');
  });
  it('何も使えず攻撃もできなければ、ターンを終える', () => {
    const s = buildState({ p0: { hand: ['九番龍 ジゴクバンカー'], mana: mana(1) } });
    expect(choose(s)).toEqual({ type: 'END_TURN' });
  });
  it('相手のシールドもブロッカーもなければ、ダイレクトアタックを選ぶ', () => {
    const s = buildState({ p0: { battle: ['ヨビニオン・マルル'] }, p1: { shield: 0 } });
    const a = choose(s) as Extract<Action, { type: 'ATTACK' }>;
    expect(a.type).toBe('ATTACK');
    expect(a.target).toEqual({ kind: 'player' });
  });
  it('倒せる相手のタップ状態のクリーチャーがいれば、プレイヤーより先にそれを攻撃する', () => {
    const s = buildState({ p0: { battle: ['ヨビニオン・マルル'] }, p1: { battle: [{ c: 'ダミー', tapped: true }] } });
    const a = choose(s) as Extract<Action, { type: 'ATTACK' }>;
    expect(a.type).toBe('ATTACK');
    expect(a.target.kind).toBe('creature');
  });
  it('パワーで負けるブロッカーしかいなければ、プレイヤーを攻撃する', () => {
    const s = buildState({ p0: { battle: ['ヨビニオン・マルル'] }, p1: { battle: ['ティンパニ=シンバリー'] } });
    const a = choose(s) as Extract<Action, { type: 'ATTACK' }>;
    expect(a).toMatchObject({ type: 'ATTACK', target: { kind: 'player' } });
  });
  it('ブロッカーに受けられて負けるなら、(相手のシールドが残るうちは)攻撃しない', () => {
    const s = buildState({ p0: { battle: ['アクアン'] }, p1: { battle: ['ティンパニ=シンバリー'] } });
    expect(choose(s)).toEqual({ type: 'END_TURN' });
  });
  it('相手のシールドが0なら、ブロッカーを引きつけるために攻撃する', () => {
    const s = buildState({ p0: { battle: ['アクアン'] }, p1: { shield: 0, battle: ['ティンパニ=シンバリー'] } });
    expect(choose(s).type).toBe('ATTACK');
  });
  it('自分のシールドが少ない時は、ブロッカーを攻撃に使わず残す', () => {
    const s = buildState({ p0: { shield: 2, battle: ['ティンパニ=シンバリー'] } });
    expect(choose(s)).toEqual({ type: 'END_TURN' });
  });
  it('どんな状態でも、返す手は合法手の1つ', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const s = advanced(seed, 25);
      if (s.winner !== null || s.pending?.why !== 'turnAction') continue;
      const legal = legalActions(s, reg);
      expect(legal).toContainEqual(choose(s));
    }
  });
});

describe('makeRuleBased', () => {
  it('合法手が1つなら、それを返す', () => {
    const only: Action = { type: 'END_MAIN' };
    expect(makeRuleBased().chooseAction(fresh(), [only], ctx())).toEqual(only);
  });
  it('効果の選択でも合法手を返し、同じ乱数なら同じ手になる', () => {
    let tested = 0;
    for (let seed = 1; seed <= 30 && tested < 4; seed++) {
      const s = advanced(seed, 40);
      if (s.winner !== null || !s.pending || s.pending.why === 'turnAction') continue;
      const legal = legalActions(s, reg);
      if (legal.length < 2) continue;
      const ag = makeRuleBased();
      const a = ag.chooseAction(s, legal, ctx(3)) as Action;
      const b = ag.chooseAction(s, legal, ctx(3)) as Action;
      expect(legal).toContainEqual(a);
      expect(a).toEqual(b);
      tested++;
    }
    expect(tested).toBeGreaterThan(0);
  });
});

describe('rolloutPick(プレイアウト用の方針)', () => {
  it('どの場面でも合法手を返す', () => {
    let n = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = advanced(seed, 35);
      if (s.winner !== null || !s.pending) continue;
      const legal = legalActions(s, reg);
      expect(legal).toContainEqual(rolloutPick(s, legal, reg, mulberry(seed)));
      n++;
    }
    expect(n).toBeGreaterThan(5);
  });
  it('S・トリガーの宣言では、できるだけ多く宣言する', () => {
    const s = buildState({ p0: { battle: ['終末縫合王 ザ=キラー・キーナリー'] }, p1: { shield: ['フェアリー・ライフ'] } });
    const r = step(s, { type: 'ATTACK', attacker: s.players[0].battle[0].pid, target: { kind: 'player' } }, reg);
    expect(r.state.pending?.why).toBe('triggerDeclare');
    const legal = legalActions(r.state, reg);
    const a = rolloutPick(r.state, legal, reg, mulberry(1)) as Extract<Action, { type: 'ANSWER' }>;
    expect((a.value as number[]).length).toBe(Math.max(...legal.map((x) => ((x as any).value as number[]).length)));
  });
});

describe('decide(1回の意思決定)', () => {
  it('入力待ちでない状態は例外', () => {
    const s = { ...fresh(), pending: null };
    expect(() => decide(CARD_DB, { state: s, spec: { kind: 'random' }, seed: 1 })).toThrow();
  });
  it('合法手が1つならそれを返す', () => {
    // 攻撃ステップで、攻撃できるクリーチャーがいなければ END_TURN だけ
    const s = buildState({ step: 'attack' });
    expect(legalActions(s, reg)).toEqual([{ type: 'END_TURN' }]);
    for (const kind of ['random', 'rule', 'mcts', 'pass'] as const) {
      expect(decide(CARD_DB, { state: s, spec: { kind }, seed: 1 })).toEqual({ type: 'END_TURN' });
    }
  });
  it('同じシード・同じ設定なら、同じ手になる', () => {
    for (const kind of ['random', 'rule'] as const) {
      const s = advanced(7, 20);
      if (s.winner !== null) continue;
      const a = decide(CARD_DB, { state: s, spec: { kind }, seed: 99 });
      const b = decide(CARD_DB, { state: s, spec: { kind }, seed: 99 });
      expect(a).toEqual(b);
      expect(legalActions(s, reg)).toContainEqual(a);
    }
  });
  it('モンテカルロも、反復回数を指定すれば再現できる', () => {
    const s = advanced(5, 12);
    const req = { state: s, spec: { kind: 'mcts' as const, iterations: 6, ms: 60000 }, seed: 4, budget: { iterations: 6, ms: 60000 } };
    const a = decide(CARD_DB, req);
    const b = decide(CARD_DB, req);
    expect(a).toEqual(b);
    expect(legalActions(s, reg)).toContainEqual(a);
  }, 60000);
  it('渡した状態を書き換えない', () => {
    const s = advanced(5, 12);
    const before = JSON.stringify(s);
    decide(CARD_DB, { state: s, spec: { kind: 'rule' }, seed: 1 });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('makeMcts(モンテカルロ探索)', () => {
  const opts = { iterations: 8, ms: 60000 };
  it('合法手が1つなら、探索せずに返す', () => {
    const only: Action = { type: 'END_MAIN' };
    expect(makeMcts(opts).chooseAction(fresh(), [only], ctx())).toEqual(only);
  });
  it('返す手は合法手で、同じ乱数・同じ反復回数なら再現できる', () => {
    const s = advanced(11, 14);
    expect(s.winner).toBeNull();
    const legal = legalActions(s, reg);
    const ag = makeMcts(opts);
    const a = ag.chooseAction(s, legal, ctx(7)) as Action;
    const b = ag.chooseAction(s, legal, ctx(7)) as Action;
    expect(legal).toContainEqual(a);
    expect(a).toEqual(b);
  }, 60000);
  it('勝ちが確定している攻撃(ダイレクトアタック)を選ぶ', () => {
    const s = buildState({ p0: { battle: ['ヨビニオン・マルル'], hand: [] }, p1: { shield: 0 } });
    s.deckIds = [Array(40).fill('dummy'), Array(40).fill('dummy')];
    const legal = legalActions(s, reg);
    const a = makeMcts({ iterations: 12, ms: 60000 }).chooseAction(s, legal, ctx(2)) as Extract<Action, { type: 'ATTACK' }>;
    expect(a.type).toBe('ATTACK');
    expect(a.target.kind).toBe('player');
  }, 60000);
  it('時間(ms)の上限も効く: ms=0 でも、各合法手を1回は試して終わる', () => {
    const s = advanced(11, 14);
    const legal = legalActions(s, reg);
    const t0 = Date.now();
    const a = makeMcts({ iterations: 100000, ms: 0 }).chooseAction(s, legal, ctx(1)) as Action;
    expect(legal).toContainEqual(a);
    expect(Date.now() - t0).toBeLessThan(30000);
  }, 60000);
  it('実行時の budget(ctx)が、生成時の設定より優先される', () => {
    const s = advanced(11, 14);
    const legal = legalActions(s, reg);
    const t0 = Date.now();
    makeMcts({ iterations: 100000, ms: 60000 }).chooseAction(s, legal, { rand: mulberry(1), reg, budget: { iterations: 2, ms: 0 } });
    expect(Date.now() - t0).toBeLessThan(30000);
  }, 60000);
  it('試合を最後まで、合法手だけで完走できる', () => {
    const r = playGameSync(CARD_DB, [makeMcts({ iterations: 4, ms: 60000, horizonTurns: 1 }), randomAgent], {
      decks: [deckCards('maruru'), deckCards('zardy')],
      seed: 14,
      first: 0,
    });
    expect(r.winner).not.toBeNull();
  }, 120000);
});

describe('AI同士の対戦(健全性)', () => {
  it('ルールベース同士は、すべての試合が決着する(ターン上限含む)', () => {
    const s = runMatches(CARD_DB, {
      deckA: deckCards('maruru'),
      deckB: deckCards('zardy'),
      agentA: { kind: 'rule' },
      agentB: { kind: 'rule' },
      games: 6,
      seed: 31,
    });
    expect(s.winsA + s.winsB + s.draws).toBe(6);
  }, 120000);
  it('パスだけのAIは、ルールベースに負ける', () => {
    const s = runMatches(CARD_DB, {
      deckA: deckCards('zardy'),
      deckB: deckCards('maruru'),
      agentA: { kind: 'pass' },
      agentB: { kind: 'rule' },
      games: 6,
      seed: 41,
    });
    expect(s.winsA).toBe(0);
  }, 120000);
});
