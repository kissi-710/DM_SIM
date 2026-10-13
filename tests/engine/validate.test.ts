import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../../src/cards';
import { checkDeck, createGame, legalActions, step, validateAction } from '../../src/engine/engine';
import { ENUM_LIMIT, actor, enumerateAnswers, validateAnswer } from '../../src/engine/legal';
import { IllegalAction, type Action, type GameState, type Pending } from '../../src/engine/types';
import { Sim, buildState, mana, reg } from '../scenario';

const W = 'アクアン';
const N = 'フェアリー・ライフ';

const pend = (input: Pending['input'], why: Pending['why'] = 'select'): Pending => ({ id: 7, player: 0, why, input });
const err = (s: GameState, a: Action) => validateAction(s, reg, a);

describe('validateAction: ターン中の行動', () => {
  it('マナのステップ: マナチャージ・スキップだけができる', () => {
    const s = buildState({ step: 'mana', p0: { hand: [N, W] } });
    const u = s.players[0].hand[0];
    expect(err(s, { type: 'CHARGE_MANA', uid: u })).toBeNull();
    expect(err(s, { type: 'SKIP_MANA' })).toBeNull();
    expect(err(s, { type: 'END_MAIN' })).not.toBeNull();
    expect(err(s, { type: 'END_TURN' })).not.toBeNull();
    expect(err(s, { type: 'PLAY_CARD', uid: u })).not.toBeNull();
  });
  it('マナチャージは1ターン1枚まで', () => {
    const s = buildState({ step: 'mana', p0: { hand: [N, W] } });
    s.manaCharged = true;
    expect(err(s, { type: 'CHARGE_MANA', uid: s.players[0].hand[0] })).not.toBeNull();
  });
  it('マナチャージできるのは自分の手札だけ', () => {
    const s = buildState({ step: 'mana', p0: { hand: [N], mana: [W] }, p1: { hand: [N] } });
    expect(err(s, { type: 'CHARGE_MANA', uid: s.players[1].hand[0] })).not.toBeNull(); // 相手の手札
    expect(err(s, { type: 'CHARGE_MANA', uid: s.players[0].mana[0] })).not.toBeNull(); // マナゾーン
    expect(err(s, { type: 'CHARGE_MANA', uid: 99999 })).not.toBeNull(); // 存在しない
  });
  it('メイン: 使用・攻撃・終了ができ、マナチャージはできない', () => {
    const s = buildState({ step: 'main', p0: { hand: [W], mana: mana(4, W), battle: ['ヨビニオン・マルル'] } });
    expect(err(s, { type: 'PLAY_CARD', uid: s.players[0].hand[0] })).toBeNull();
    expect(err(s, { type: 'ATTACK', attacker: s.players[0].battle[0].pid, target: { kind: 'player' } })).toBeNull();
    expect(err(s, { type: 'END_MAIN' })).toBeNull();
    expect(err(s, { type: 'END_TURN' })).toBeNull();
    expect(err(s, { type: 'SKIP_MANA' })).not.toBeNull();
    expect(err(s, { type: 'CHARGE_MANA', uid: s.players[0].hand[0] })).not.toBeNull();
  });
  it('攻撃ステップ: 使用と END_MAIN はできないが、攻撃・ターン終了はできる', () => {
    const s = buildState({ step: 'attack', p0: { hand: [W], mana: mana(4, W), battle: ['ヨビニオン・マルル'] } });
    expect(err(s, { type: 'PLAY_CARD', uid: s.players[0].hand[0] })).not.toBeNull();
    expect(err(s, { type: 'END_MAIN' })).not.toBeNull();
    expect(err(s, { type: 'ATTACK', attacker: s.players[0].battle[0].pid, target: { kind: 'player' } })).toBeNull();
    expect(err(s, { type: 'END_TURN' })).toBeNull();
  });
  it('マナが足りない使用・手札にないカードの使用は不可', () => {
    const s = buildState({ p0: { hand: [W], mana: mana(1) }, p1: { hand: [W] } });
    expect(err(s, { type: 'PLAY_CARD', uid: s.players[0].hand[0] })).not.toBeNull();
    const t = buildState({ p0: { mana: mana(5) }, p1: { hand: [W] } });
    expect(err(t, { type: 'PLAY_CARD', uid: t.players[1].hand[0] })).not.toBeNull();
    expect(err(t, { type: 'PLAY_CARD', uid: 99999 })).not.toBeNull();
  });
  it('攻撃: 召喚酔い・存在しないクリーチャー・相手のクリーチャーは不可', () => {
    const s = buildState({ p0: { battle: [{ c: 'ヨビニオン・マルル', sick: true }] }, p1: { battle: [{ c: 'アクアン', tapped: true }] } });
    expect(err(s, { type: 'ATTACK', attacker: s.players[0].battle[0].pid, target: { kind: 'player' } })).not.toBeNull();
    expect(err(s, { type: 'ATTACK', attacker: 424242, target: { kind: 'player' } })).not.toBeNull();
    expect(err(s, { type: 'ATTACK', attacker: s.players[1].battle[0].pid, target: { kind: 'player' } })).not.toBeNull();
  });
  it('攻撃: アンタップ状態のクリーチャーは対象にできない(タップ状態のみ)', () => {
    const s = buildState({ p0: { battle: ['ヨビニオン・マルル'] }, p1: { battle: [{ c: 'アクアン', tapped: false }] } });
    expect(err(s, { type: 'ATTACK', attacker: s.players[0].battle[0].pid, target: { kind: 'creature', pid: s.players[1].battle[0].pid } })).not.toBeNull();
    s.players[1].battle[0].tapped = true;
    expect(err(s, { type: 'ATTACK', attacker: s.players[0].battle[0].pid, target: { kind: 'creature', pid: s.players[1].battle[0].pid } })).toBeNull();
  });
  it('終了した試合・入力待ちでない状態では、何もできない', () => {
    const s = buildState({});
    s.winner = 0;
    expect(err(s, { type: 'END_TURN' })).not.toBeNull();
    expect(legalActions(s, reg)).toEqual([]);
    const t = buildState({});
    t.pending = null;
    expect(err(t, { type: 'END_TURN' })).not.toBeNull();
    expect(legalActions(t, reg)).toEqual([]);
  });
  it('step は不正な行動で IllegalAction を投げ、状態を変えない', () => {
    const s = buildState({ step: 'mana', p0: { hand: [N] } });
    const before = JSON.stringify(s);
    expect(() => step(s, { type: 'END_TURN' }, reg)).toThrow(IllegalAction);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('validateAction: 回答', () => {
  const sim = () => {
    const s = new Sim({ p0: { hand: ['天災 デドダム'], mana: [W, 'ロスト・Re:ソウル', N], deck: [N, 'ティンパニ=シンバリー', 'ジ・ウォッチ', 'ダミー', 'ダミー'] } });
    s.play('天災 デドダム');
    return s;
  };
  it('回答の場面では、ターン中の行動はできない', () => {
    const s = sim();
    expect(err(s.s, { type: 'END_TURN' })).not.toBeNull();
    expect(err(s.s, { type: 'SKIP_MANA' })).not.toBeNull();
  });
  it('古い入力(id 違い)は不可', () => {
    const s = sim();
    expect(err(s.s, { type: 'ANSWER', id: s.pending.id + 1, value: {} })).toMatch(/古い/);
  });
  it('ターン中の行動の場面では ANSWER は不可', () => {
    const s = buildState({});
    expect(err(s, { type: 'ANSWER', id: s.pending!.id, value: true })).not.toBeNull();
  });
  it('legalActions は回答の場面では ANSWER だけを返す(id が入力待ちと一致)', () => {
    const s = sim();
    const legal = s.legal();
    expect(legal.length).toBeGreaterThan(0);
    for (const a of legal) {
      expect(a.type).toBe('ANSWER');
      expect((a as any).id).toBe(s.pending.id);
      expect(err(s.s, a)).toBeNull();
    }
  });
  it('actor: 回答する本人(終了後は null)', () => {
    const s = sim();
    expect(actor(s.s)).toBe(0);
    s.s.winner = 1;
    expect(actor(s.s)).toBeNull();
  });
});

describe('validateAnswer(形の検証)', () => {
  it('pick: 個数・重複・候補外', () => {
    const p = pend({ shape: 'pick', candidates: [1, 2, 3], min: 1, max: 2 });
    expect(validateAnswer(p, [1])).toBeNull();
    expect(validateAnswer(p, [1, 3])).toBeNull();
    expect(validateAnswer(p, [])).not.toBeNull();
    expect(validateAnswer(p, [1, 2, 3])).not.toBeNull();
    expect(validateAnswer(p, [1, 1])).not.toBeNull();
    expect(validateAnswer(p, [9])).not.toBeNull();
    expect(validateAnswer(p, true)).not.toBeNull();
  });
  it('pick: 0枚も選べる場合', () => {
    const p = pend({ shape: 'pick', candidates: [1], min: 0, max: 1 });
    expect(validateAnswer(p, [])).toBeNull();
  });
  it('yesno / ack / order', () => {
    expect(validateAnswer(pend({ shape: 'yesno' }), true)).toBeNull();
    expect(validateAnswer(pend({ shape: 'yesno' }), false)).toBeNull();
    expect(validateAnswer(pend({ shape: 'yesno' }), [1])).not.toBeNull();
    expect(validateAnswer(pend({ shape: 'ack', shown: [1] }), true)).toBeNull();
    const o = pend({ shape: 'order', candidates: [4, 5], labels: ['a', 'b'] });
    expect(validateAnswer(o, 4)).toBeNull();
    expect(validateAnswer(o, 6)).not.toBeNull();
    expect(validateAnswer(o, [4])).not.toBeNull();
  });
  it('option: 個数・範囲・重複・allIf・repeat', () => {
    const o = pend({ shape: 'option', options: ['a', 'b', 'c'], pick: 2, repeat: false, allIf: false });
    expect(validateAnswer(o, [0, 2])).toBeNull();
    expect(validateAnswer(o, [0])).not.toBeNull();
    expect(validateAnswer(o, [0, 0])).not.toBeNull();
    expect(validateAnswer(o, [0, 3])).not.toBeNull();
    expect(validateAnswer(o, [0, 1.5])).not.toBeNull();
    expect(validateAnswer(o, [0, 1, 2])).not.toBeNull();
    const all = pend({ shape: 'option', options: ['a', 'b', 'c'], pick: 2, repeat: false, allIf: true });
    expect(validateAnswer(all, [0, 1, 2])).toBeNull();
    const rep = pend({ shape: 'option', options: ['a', 'b'], pick: 2, repeat: true, allIf: false });
    expect(validateAnswer(rep, [1, 1])).toBeNull();
  });
  it('assign: 枠の上限・割り振る枚数・重複・未知の枠・対象外', () => {
    const p = pend({
      shape: 'assign',
      items: [1, 2, 3],
      slots: [
        { id: 'hand', to: 'hand', count: 1, label: '手札' },
        { id: 'grave', to: 'grave', count: 2, label: '墓地' },
      ],
    });
    expect(validateAnswer(p, { hand: [1], grave: [2, 3] })).toBeNull();
    expect(validateAnswer(p, { hand: [1, 2], grave: [3] })).not.toBeNull(); // 枠超過
    expect(validateAnswer(p, { hand: [1], grave: [2] })).not.toBeNull(); // 足りない
    expect(validateAnswer(p, { hand: [1], grave: [1, 2] })).not.toBeNull(); // 重複
    expect(validateAnswer(p, { hand: [1], grave: [2, 3], mana: [] })).not.toBeNull(); // 未知の枠
    expect(validateAnswer(p, { hand: [9], grave: [2, 3] })).not.toBeNull(); // 対象外
    expect(validateAnswer(p, [1, 2, 3])).not.toBeNull();
    expect(validateAnswer(p, null as any)).not.toBeNull();
  });
  it('入力がない場面は受け付けない', () => {
    expect(validateAnswer(pend(null), true)).not.toBeNull();
  });
});

describe('enumerateAnswers(回答の列挙)', () => {
  it('pick: min〜max個の組み合わせ(重複なし)', () => {
    const r = enumerateAnswers(pend({ shape: 'pick', candidates: [1, 2, 3, 4], min: 1, max: 2 }));
    expect(r).toHaveLength(4 + 6);
    const r0 = enumerateAnswers(pend({ shape: 'pick', candidates: [1, 2, 3], min: 0, max: 0 }));
    expect(r0).toEqual([[]]);
  });
  it('pick: 候補が少ないとき、全部選ぶ組(min=max=候補数)', () => {
    expect(enumerateAnswers(pend({ shape: 'pick', candidates: [5, 6], min: 2, max: 2 }))).toEqual([[5, 6]]);
  });
  it('列挙の上限を超えない', () => {
    const cands = Array.from({ length: 30 }, (_, i) => i);
    expect(enumerateAnswers(pend({ shape: 'pick', candidates: cands, min: 0, max: 5 })).length).toBeLessThanOrEqual(ENUM_LIMIT);
    expect(enumerateAnswers(pend({ shape: 'pick', candidates: cands, min: 0, max: 5 }), 10).length).toBeLessThanOrEqual(10);
  });
  it('yesno / ack / order / payment', () => {
    expect(enumerateAnswers(pend({ shape: 'yesno' }))).toEqual([true, false]);
    expect(enumerateAnswers(pend({ shape: 'ack', shown: [] }))).toEqual([true]);
    expect(enumerateAnswers(pend({ shape: 'order', candidates: [3, 4], labels: ['a', 'b'] }))).toEqual([3, 4]);
    expect(enumerateAnswers(pend({ shape: 'payment', need: 2, mana: [7, 8, 9] }))).toEqual([[7, 8]]);
    expect(enumerateAnswers(pend(null))).toEqual([]);
  });
  it('option: 1つ選ぶ・2つ選ぶ(順不同の組)・全部(allIf)', () => {
    const one = enumerateAnswers(pend({ shape: 'option', options: ['a', 'b', 'c'], pick: 1, repeat: false, allIf: false }));
    expect(one).toEqual([[0], [1], [2]]);
    const two = enumerateAnswers(pend({ shape: 'option', options: ['a', 'b', 'c'], pick: 2, repeat: false, allIf: false }));
    expect(two).toEqual([[0, 1], [0, 2], [1, 2]]);
    const all = enumerateAnswers(pend({ shape: 'option', options: ['a', 'b'], pick: 1, repeat: false, allIf: true }));
    expect(all).toContainEqual([0, 1]);
  });
  it('assign: 列挙した回答はすべて検証を通る', () => {
    const p = pend({
      shape: 'assign',
      items: [1, 2, 3],
      slots: [
        { id: 'a', to: 'hand', count: 1, label: 'A' },
        { id: 'b', to: 'grave', count: 2, label: 'B' },
      ],
    });
    const r = enumerateAnswers(p);
    expect(r.length).toBeGreaterThan(0);
    for (const v of r) expect(validateAnswer(p, v)).toBeNull();
  });
  it('列挙した回答は、実際の入力待ちでもすべて検証を通る(ランダム対戦)', () => {
    for (let seed = 1; seed <= 6; seed++) {
      let s = createGame(CARD_DB, { decks: [deckCards('maruru'), deckCards('zardy')], seed, first: 0 }).state;
      for (let i = 0; i < 80 && s.winner === null; i++) {
        const legal = legalActions(s, reg);
        for (const a of legal) expect(validateAction(s, reg, a)).toBeNull();
        s = step(s, legal[(i * 7) % legal.length], reg).state;
      }
    }
  });
});

describe('legalActions(ターン中)', () => {
  it('同名のカードのマナチャージは1つにまとめる', () => {
    const s = buildState({ step: 'mana', p0: { hand: [N, N, N, W] } });
    const charges = legalActions(s, reg).filter((a) => a.type === 'CHARGE_MANA');
    expect(charges).toHaveLength(2);
  });
  it('マナチャージ済みなら、マナのステップでもスキップしかない', () => {
    const s = buildState({ step: 'mana', p0: { hand: [N] } });
    s.manaCharged = true;
    expect(legalActions(s, reg)).toEqual([{ type: 'SKIP_MANA' }]);
  });
  it('メインでは END_MAIN と END_TURN の両方がある。攻撃ステップでは END_MAIN がない', () => {
    const main = legalActions(buildState({ step: 'main' }), reg).map((a) => a.type);
    expect(main).toContain('END_MAIN');
    expect(main).toContain('END_TURN');
    const atk = legalActions(buildState({ step: 'attack' }), reg).map((a) => a.type);
    expect(atk).not.toContain('END_MAIN');
    expect(atk).toContain('END_TURN');
  });
  it('攻撃は、できるクリーチャー×対象ごとに列挙される', () => {
    const s = buildState({
      p0: { battle: ['ヨビニオン・マルル', 'ヨビニオン・トライブ'] },
      p1: { battle: [{ c: 'アクアン', tapped: true }, { c: 'アクアン', tapped: false }] },
    });
    const atk = legalActions(s, reg).filter((a) => a.type === 'ATTACK');
    // 2体 × (プレイヤー + タップ状態の1体)
    expect(atk).toHaveLength(4);
  });
  it('使えないカード(マナ不足)は列挙されない', () => {
    const s = buildState({ p0: { hand: [W, '九番龍 ジゴクバンカー'], mana: mana(4, W) } });
    const plays = legalActions(s, reg).filter((a) => a.type === 'PLAY_CARD');
    expect(plays).toHaveLength(1);
    expect(s.cards[(plays[0] as any).uid].defId).toBe('dm23bd7-031');
  });
  it('マナ・墓地から使えるカード(権限のあるもの)だけが、その場所から列挙される', () => {
    const s = buildState({ p0: { hand: [], mana: mana(6), grave: [W, 'ヨビニオン・トライブ'] } });
    const plays = legalActions(s, reg).filter((a) => a.type === 'PLAY_CARD');
    // アクアンは墓地からは使えない
    expect(plays.every((a) => (a as any).from !== 'grave' || s.cards[(a as any).uid].defId !== 'dm23bd7-031')).toBe(true);
  });
  it('列挙された手は、すべて validateAction を通り、step で実行できる', () => {
    const s = buildState({
      p0: { hand: [W, N, 'ヨビニオン・マルル', '天災 デドダム'], mana: mana(6), battle: ['ヨビニオン・トライブ'] },
      p1: { battle: [{ c: 'アクアン', tapped: true }] },
    });
    for (const a of legalActions(s, reg)) {
      expect(validateAction(s, reg, a)).toBeNull();
      expect(() => step(s, a, reg)).not.toThrow();
    }
  });
});

describe('checkDeck', () => {
  it('対戦モード: 40枚・同名4枚まで・未知のカードID', () => {
    const ok = deckCards('maruru');
    expect(checkDeck(CARD_DB, ok, true).ok).toBe(true);
    expect(checkDeck(CARD_DB, ok.slice(1), true).errors.join()).toContain('40枚');
    expect(checkDeck(CARD_DB, [...ok.slice(1), 'dm23bd1-014', 'dm23bd1-014'].slice(0, 40).map((x, i) => (i < 6 ? 'dm23bd1-014' : x)), true).errors.join()).toContain('4枚まで');
    expect(checkDeck(CARD_DB, [...ok.slice(1), 'nope'], true).errors.join()).toContain('未知のカードID');
  });
  it('ダミーは同名4枚の制限に含まない(調査用)', () => {
    expect(checkDeck(CARD_DB, Array(40).fill('dummy'), true).ok).toBe(true);
  });
  it('自由モード: 11枚以上ならよい(同名の制限もなし)', () => {
    expect(checkDeck(CARD_DB, Array(11).fill('dm23bd1-014'), false).ok).toBe(true);
    expect(checkDeck(CARD_DB, Array(10).fill('dm23bd1-014'), false).ok).toBe(false);
  });
});
