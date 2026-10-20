import { describe, expect, it } from 'vitest';
import type { Cond, Selector } from '../../src/engine/ast';
import { evalCond, evalExpr, getVar, matchPattern, mkCC, raceMatches, selectCards, varUids, type CC } from '../../src/engine/cond';
import { mkCtx } from '../../src/engine/state';
import type { Ev, GameState, PlayerId } from '../../src/engine/types';
import { buildState, mana, reg } from '../scenario';

const W = 'アクアン'; // 水 コスト4 パワー2000
const N = 'フェアリー・ライフ'; // 自然 呪文 コスト2
const DEDO = '天災 デドダム'; // 水闇自然 コスト3 パワー3000
const MARURU = 'ヨビニオン・マルル'; // 自然 コスト4 パワー5000

const cc = (s: GameState, o: Partial<CC> = {}, controller: PlayerId = 0): CC => mkCC(mkCtx(s, reg), controller, o);
const ev = (o: Partial<Ev> & { type: string }): Ev => ({ id: 1, causedBy: null, turn: 5, ...o });

describe('getVar / varUids', () => {
  const s = buildState({ p0: { hand: [W, N] } });
  const [a, b] = s.players[0].hand;

  it('$self は発生源の参照(uid + ep)。無ければ null', () => {
    expect(getVar(cc(s), '$self')).toBeNull();
    expect(getVar(cc(s, { self: a }), '$self')).toEqual({ uid: a, ep: s.cards[a].ep });
  });
  it('変数と、ドット区切りの入れ子', () => {
    const c = cc(s, { vars: { $x: 3, $o: { inner: { v: 7 } } } });
    expect(getVar(c, '$x')).toBe(3);
    expect(getVar(c, '$o.inner.v')).toBe(7);
    expect(getVar(c, '$none')).toBeUndefined();
    expect(getVar(c, '$o.zzz.v')).toBeUndefined();
  });
  it('varUids: 数値・参照・配列・単体・未定義', () => {
    const c = cc(s, { vars: { $n: [a, b], $r: { uid: a, ep: s.cards[a].ep }, $rs: [{ uid: a, ep: s.cards[a].ep }, { uid: b, ep: s.cards[b].ep }] } });
    expect(varUids(c, '$n')).toEqual([a, b]);
    expect(varUids(c, '$r')).toEqual([a]);
    expect(varUids(c, '$rs')).toEqual([a, b]);
    expect(varUids(c, '$none')).toEqual([]);
  });
  it('varUids: ep が合わない参照(別のカードになった)は除外。ignoreEp なら含める', () => {
    const c = cc(s, { vars: { $r: { uid: a, ep: s.cards[a].ep + 1 } } });
    expect(varUids(c, '$r')).toEqual([]);
    expect(varUids(c, '$r', { ignoreEp: true })).toEqual([a]);
  });
  it('varUids: 存在しないカードの参照は無視する', () => {
    const c = cc(s, { vars: { $r: { uid: 99999, ep: 0 } } });
    expect(varUids(c, '$r', { ignoreEp: true })).toEqual([]);
  });
});

describe('evalExpr', () => {
  const s = buildState({ p0: { hand: [W, N, DEDO], mana: mana(3) } });
  const c = cc(s, { vars: { $n: 4, $arr: [1, 2, 3], $ref: { uid: s.players[0].hand[2], ep: 0 } } });

  it('数値・既定値', () => {
    expect(evalExpr(c, 5)).toBe(5);
    expect(evalExpr(c, undefined)).toBe(0);
    expect(evalExpr(c, undefined, 9)).toBe(9);
  });
  it('var: 数値はそのまま、配列は長さ、未定義は0', () => {
    expect(evalExpr(c, { var: '$n' })).toBe(4);
    expect(evalExpr(c, { var: '$arr' })).toBe(3);
    expect(evalExpr(c, { var: '$none' })).toBe(0);
  });
  it('count: セレクタに合う枚数', () => {
    expect(evalExpr(c, { count: { zone: 'hand' } })).toBe(3);
    expect(evalExpr(c, { count: { zone: 'mana' } })).toBe(3);
    expect(evalExpr(c, { count: { zone: 'hand', owner: 'opponent' } })).toBe(0);
  });
  it('四則・min・max', () => {
    expect(evalExpr(c, { add: [1, 2, { var: '$n' }] })).toBe(7);
    expect(evalExpr(c, { sub: [10, { var: '$n' }] })).toBe(6);
    expect(evalExpr(c, { min: [3, 1, 2] })).toBe(1);
    expect(evalExpr(c, { max: [3, 1, 2] })).toBe(3);
    expect(evalExpr(c, { add: [{ min: [4, 5] }, { max: [1, 2] }] })).toBe(6);
  });
  it('costOf: $self は発生源の記録(selfSnap)から、変数はカードの元のコスト', () => {
    expect(evalExpr(cc(s, { selfSnap: { cost: 7 } as any }), { costOf: '$self' })).toBe(7);
    expect(evalExpr(c, { costOf: '$ref' })).toBe(3); // デドダム
    expect(evalExpr(c, { costOf: '$none' })).toBe(0);
  });
  it('未知の式は例外', () => {
    expect(() => evalExpr(c, { zzz: 1 } as any)).toThrow();
  });
});

describe('evalCond: 場の条件($it 不要)', () => {
  const s = buildState({ p0: { hand: [W], mana: mana(2) }, p1: { shield: 3 } });
  const c = cc(s);

  it('条件なしは真、true は真', () => {
    expect(evalCond(c, undefined)).toBe(true);
    expect(evalCond(c, { true: true })).toBe(true);
  });
  it('all / any / not', () => {
    const T: Cond = { true: true };
    const F: Cond = { not: T };
    expect(evalCond(c, { all: [T, T] })).toBe(true);
    expect(evalCond(c, { all: [T, F] })).toBe(false);
    expect(evalCond(c, { all: [] })).toBe(true);
    expect(evalCond(c, { any: [F, T] })).toBe(true);
    expect(evalCond(c, { any: [F, F] })).toBe(false);
    expect(evalCond(c, { any: [] })).toBe(false);
    expect(evalCond(c, { not: F })).toBe(true);
  });
  it('turnOf: 手番', () => {
    expect(evalCond(c, { turnOf: 'self' })).toBe(true);
    expect(evalCond(c, { turnOf: 'opponent' })).toBe(false);
    expect(evalCond(cc(s, {}, 1), { turnOf: 'self' })).toBe(false);
  });
  it('shields: 自分のシールド枚数(ブレイク中のものは除く)', () => {
    const t = buildState({ p0: { shield: 3 } });
    expect(evalCond(cc(t), { shields: { eq: 3 } })).toBe(true);
    expect(evalCond(cc(t), { shields: { lte: 2 } })).toBe(false);
    expect(evalCond(cc(t), { shields: { gte: 3 } })).toBe(true);
    t.breaking = [t.players[0].shield[0]];
    expect(evalCond(cc(t), { shields: { eq: 2 } })).toBe(true);
    expect(evalCond(cc(t), { shields: { lte: 2, gte: 2 } })).toBe(true);
  });
  it('cmp: 6種類の比較', () => {
    const k = (op: any, l: number, r: number) => evalCond(c, { cmp: { l, op, r } });
    expect([k('<', 1, 2), k('<', 2, 2)]).toEqual([true, false]);
    expect([k('<=', 2, 2), k('<=', 3, 2)]).toEqual([true, false]);
    expect([k('>', 3, 2), k('>', 2, 2)]).toEqual([true, false]);
    expect([k('>=', 2, 2), k('>=', 1, 2)]).toEqual([true, false]);
    expect([k('==', 2, 2), k('==', 1, 2)]).toEqual([true, false]);
    expect([k('!=', 1, 2), k('!=', 2, 2)]).toEqual([true, false]);
  });
  it('count: 枚数の gte / lte / eq', () => {
    const sel: Selector = { zone: 'mana' };
    expect(evalCond(c, { count: sel, gte: 2 })).toBe(true);
    expect(evalCond(c, { count: sel, gte: 3 })).toBe(false);
    expect(evalCond(c, { count: sel, lte: 2 })).toBe(true);
    expect(evalCond(c, { count: sel, lte: 1 })).toBe(false);
    expect(evalCond(c, { count: sel, eq: 2 })).toBe(true);
    expect(evalCond(c, { count: sel, eq: 1 })).toBe(false);
  });
  it('fiveCivs / civsPresent: 集合の文明', () => {
    const t = buildState({ p0: { mana: ['王道の革命 ドギラゴン', DEDO, '龍風混成 ザーディクリカ'] } });
    const sel: Selector = { zone: 'mana' };
    // 光火自然 + 水闇自然 + 光水火 → 五文明そろう
    expect(evalCond(cc(t), { fiveCivs: sel })).toBe(true);
    expect(evalCond(cc(t), { civsPresent: { sel, civs: ['light', 'darkness'] } })).toBe(true);
    const u = buildState({ p0: { mana: [W, N] } });
    expect(evalCond(cc(u), { fiveCivs: { zone: 'mana' } })).toBe(false);
    expect(evalCond(cc(u), { civsPresent: { sel: { zone: 'mana' }, civs: ['water', 'nature'] } })).toBe(true);
    expect(evalCond(cc(u), { civsPresent: { sel: { zone: 'mana' }, civs: ['water', 'fire'] } })).toBe(false);
  });
  it('nonEmpty: 変数が1枚以上を指す', () => {
    const a = s.players[0].hand[0];
    expect(evalCond(cc(s, { vars: { $x: [a] } }), { nonEmpty: '$x' })).toBe(true);
    expect(evalCond(cc(s, { vars: { $x: [] } }), { nonEmpty: '$x' })).toBe(false);
    expect(evalCond(cc(s), { nonEmpty: '$x' })).toBe(false);
  });
  it('notInBattle: 同名のカードが自分のバトルゾーンにいない', () => {
    const t = buildState({ p0: { hand: [MARURU], battle: [MARURU] } });
    expect(evalCond(cc(t, { self: t.players[0].hand[0] }), { notInBattle: true })).toBe(false);
    const u = buildState({ p0: { hand: [MARURU], battle: [W] } });
    expect(evalCond(cc(u, { self: u.players[0].hand[0] }), { notInBattle: true })).toBe(true);
    expect(evalCond(cc(u), { notInBattle: true })).toBe(true); // 発生源なし
  });
  it('logged: このターンのログに、パターンに合うイベントが min 回以上ある', () => {
    const t = buildState({});
    t.turnLog.push(ev({ type: 'cast', owner: 0 }), ev({ type: 'cast', owner: 0 }), ev({ type: 'cast', owner: 1 }));
    expect(evalCond(cc(t), { logged: { pattern: { type: 'cast', owner: 'self' } } })).toBe(true);
    expect(evalCond(cc(t), { logged: { pattern: { type: 'cast', owner: 'self' }, min: 2 } })).toBe(true);
    expect(evalCond(cc(t), { logged: { pattern: { type: 'cast', owner: 'self' }, min: 3 } })).toBe(false);
    expect(evalCond(cc(t), { logged: { pattern: { type: 'cast', owner: 'opponent' }, min: 2 } })).toBe(false);
    expect(evalCond(cc(t), { logged: { pattern: { type: 'attackDeclared' } } })).toBe(false);
  });
  it('zoneIs: 判定対象のいるゾーン', () => {
    const a = s.players[0].hand[0];
    expect(evalCond(cc(s, { it: a }), { zoneIs: 'hand' })).toBe(true);
    expect(evalCond(cc(s, { it: a }), { zoneIs: 'grave' })).toBe(false);
    expect(evalCond(cc(s), { zoneIs: 'hand' })).toBe(false);
  });
});

describe('evalCond: カードの条件($it を使う)', () => {
  const s = buildState({
    p0: {
      hand: [W, N, DEDO, 'ワクムテラス'],
      battle: [{ c: MARURU, tapped: true }, { c: W, tapped: false }],
      mana: [{ c: W, tapped: true }, { c: N, tapped: false }],
    },
  });
  const hand = s.players[0].hand;
  const top = (i: number) => s.players[0].battle[i].cards[0];
  const test = (uid: number, cond: Cond, itFace?: number) => evalCond(cc(s, { it: uid, itFace }), cond);

  it('$it が無いカード条件は例外', () => {
    expect(() => evalCond(cc(s), { civ: 'water' })).toThrow();
  });
  it('civ / civsAll / multicolor', () => {
    expect(test(hand[0], { civ: 'water' })).toBe(true);
    expect(test(hand[0], { civ: 'fire' })).toBe(false);
    expect(test(hand[2], { civsAll: ['water', 'darkness'] })).toBe(true);
    expect(test(hand[0], { civsAll: ['water', 'darkness'] })).toBe(false);
    expect(test(hand[2], { multicolor: true })).toBe(true);
    expect(test(hand[0], { multicolor: true })).toBe(false);
    expect(test(hand[0], { multicolor: false })).toBe(true);
  });
  it('cost: eq / lt / lte / gt / gte(式でも指定できる)', () => {
    expect(test(hand[0], { cost: { eq: 4 } })).toBe(true);
    expect(test(hand[0], { cost: { lt: 4 } })).toBe(false);
    expect(test(hand[0], { cost: { lte: 4 } })).toBe(true);
    expect(test(hand[0], { cost: { gt: 3 } })).toBe(true);
    expect(test(hand[0], { cost: { gte: 5 } })).toBe(false);
    expect(test(hand[0], { cost: { gte: 2, lte: 4 } })).toBe(true);
    const c = cc(s, { it: hand[0], vars: { $n: 4 } });
    expect(evalCond(c, { cost: { eq: { var: '$n' } } })).toBe(true);
    expect(evalCond(c, { cost: { lt: { add: [{ var: '$n' }, 1] } } })).toBe(true);
  });
  it('power', () => {
    expect(test(top(0), { power: { gte: 5000 } })).toBe(true);
    expect(test(top(0), { power: { lte: 4000 } })).toBe(false);
    expect(test(top(1), { power: { lte: 2000 } })).toBe(true);
  });
  it('type: creature / spell(進化もクリーチャー)', () => {
    expect(test(hand[0], { type: 'creature' })).toBe(true);
    expect(test(hand[0], { type: 'spell' })).toBe(false);
    expect(test(hand[1], { type: 'spell' })).toBe(true);
    expect(test(hand[1], { type: 'creature' })).toBe(false);
  });
  it('evolution', () => {
    const t = buildState({ p0: { hand: ['SSS級天災 デッドダムド', W] } });
    expect(evalCond(cc(t, { it: t.players[0].hand[0] }), { evolution: true })).toBe(true);
    expect(evalCond(cc(t, { it: t.players[0].hand[1] }), { evolution: true })).toBe(false);
    expect(evalCond(cc(t, { it: t.players[0].hand[1] }), { evolution: false })).toBe(true);
  });
  it('race: 種族名の一部', () => {
    expect(test(top(0), { race: 'フェアリー' })).toBe(true); // スノーフェアリー
    expect(test(top(1), { race: 'フェアリー' })).toBe(false); // サイバーロード
  });
  it('tapped: バトルゾーンは山の状態、それ以外はカードの状態', () => {
    expect(test(top(0), { tapped: true })).toBe(true);
    expect(test(top(1), { tapped: true })).toBe(false);
    expect(test(s.players[0].mana[0], { tapped: true })).toBe(true);
    expect(test(s.players[0].mana[1], { tapped: true })).toBe(false);
    expect(test(s.players[0].mana[1], { tapped: false })).toBe(true);
  });
  it('sameCivAs: 参照したカードと文明を共有する', () => {
    const ref = { uid: top(1), ep: 0 }; // 水
    const c = (it: number) => cc(s, { it, vars: { $ref: ref } });
    expect(evalCond(c(hand[0]), { sameCivAs: '$ref' })).toBe(true); // 水
    expect(evalCond(c(hand[2]), { sameCivAs: '$ref' })).toBe(true); // 水闇自然
    expect(evalCond(c(hand[1]), { sameCivAs: '$ref' })).toBe(false); // 自然
    expect(evalCond(cc(s, { it: hand[0] }), { sameCivAs: '$none' })).toBe(false);
  });
  it('ツインパクトの面: itFace で面を選ぶ(-1 は文明の和集合)', () => {
    const wk = hand[3];
    expect(test(wk, { type: 'creature' }, 0)).toBe(true);
    expect(test(wk, { type: 'spell' }, 1)).toBe(true);
    expect(test(wk, { civ: 'water' }, 0)).toBe(true);
    expect(test(wk, { civ: 'nature' }, 1)).toBe(true);
    expect(test(wk, { civ: 'nature' }, 0)).toBe(false);
    expect(test(wk, { civ: 'nature' }, -1)).toBe(true);
  });
  it('未知の条件は例外', () => {
    expect(() => evalCond(cc(s, { it: hand[0] }), { zzz: 1 } as any)).toThrow();
  });
});

describe('selectCards', () => {
  const s = buildState({
    p0: { hand: [W, N, 'ワクムテラス'], battle: [MARURU, { c: W, tapped: true }], mana: [N], grave: [DEDO] },
    p1: { hand: [DEDO], battle: [{ c: 'ティンパニ=シンバリー', tapped: true }], mana: mana(2) },
  });
  const sel = (o: Selector, extra: Partial<CC> = {}, who: PlayerId = 0) => selectCards(cc(s, extra, who), o);

  it('ゾーンと持ち主(self / opponent / any)', () => {
    expect(sel({ zone: 'hand' })).toHaveLength(3);
    expect(sel({ zone: 'hand', owner: 'opponent' })).toHaveLength(1);
    expect(sel({ zone: 'hand', owner: 'any' })).toHaveLength(4);
    expect(sel({ zone: 'mana', owner: 'opponent' })).toHaveLength(2);
    // 視点を変えると self / opponent が入れ替わる
    expect(selectCards(cc(s, {}, 1), { zone: 'hand' })).toHaveLength(1);
  });
  it('複数ゾーン', () => {
    expect(sel({ zone: ['hand', 'grave', 'mana'] })).toHaveLength(3 + 1 + 1);
  });
  it('iter: forPlayers の現在のプレイヤー', () => {
    expect(sel({ zone: 'hand', owner: 'iter' }, { iter: 1 })).toHaveLength(1);
    expect(sel({ zone: 'hand', owner: 'iter' }, { iter: 0 })).toHaveLength(3);
    expect(sel({ zone: 'hand', owner: 'iter' })).toHaveLength(3); // 未設定なら controller
  });
  it('バトルゾーンは山の一番上のカード', () => {
    const t = buildState({ p0: { battle: [{ c: MARURU, under: [W, W] }] } });
    expect(selectCards(cc(t), { zone: 'battle' })).toEqual([t.players[0].battle[0].cards[0]]);
  });
  it('type: 手札のツインパクトはどちらの面でも数える', () => {
    expect(sel({ zone: 'hand', type: 'creature' })).toHaveLength(2); // アクアン + ワクムテラス
    expect(sel({ zone: 'hand', type: 'spell' })).toHaveLength(2); // フェアリー・ライフ + ワクムテラス
    expect(sel({ zone: 'hand', type: 'card' })).toHaveLength(3);
  });
  it('where: 条件でしぼる', () => {
    expect(sel({ zone: 'hand', where: { civ: 'water' } })).toHaveLength(2);
    expect(sel({ zone: 'battle', where: { tapped: true } })).toHaveLength(1);
    expect(sel({ zone: 'hand', where: { cost: { lte: 2 } } })).toHaveLength(1); // 面を指定しない時のコストは面0(ワクムテラスはクリーチャー面の4)
  });
  it('notSelf / except / of', () => {
    const [a, b] = s.players[0].hand;
    expect(sel({ zone: 'hand', notSelf: true }, { self: a })).toHaveLength(2);
    expect(sel({ zone: 'hand', except: '$e' }, { vars: { $e: [a, b] } })).toHaveLength(1);
    expect(sel({ zone: 'hand', of: '$o' }, { vars: { $o: [b] } })).toEqual([b]);
    // of は持ち主の絞り込みを受ける
    expect(sel({ zone: 'hand', of: '$o', owner: 'opponent' }, { vars: { $o: [b] } })).toEqual([]);
  });
  it('chooseable: 相手のクリーチャーのうち、選べないものを除く', () => {
    const t = buildState({ p1: { battle: [W, MARURU] } });
    t.effects.push({ id: 1, pid: t.players[1].battle[0].pid, mod: { kind: 'cannotBeChosen' }, until: { kind: 'endOfTurn', turn: 5 }, controller: 1 });
    const all = selectCards(cc(t), { zone: 'battle', owner: 'opponent' });
    const choosable = selectCards(cc(t), { zone: 'battle', owner: 'opponent', chooseable: true });
    expect(all).toHaveLength(2);
    expect(choosable).toHaveLength(1);
    // 自分のクリーチャーには効かない(自分のカードは選べる)
    const u = buildState({ p0: { battle: [W] } });
    u.effects.push({ id: 1, pid: u.players[0].battle[0].pid, mod: { kind: 'cannotBeChosen' }, until: { kind: 'endOfTurn', turn: 5 }, controller: 1 });
    expect(selectCards(cc(u), { zone: 'battle', owner: 'self', chooseable: true })).toHaveLength(1);
  });
});

describe('matchPattern', () => {
  const s = buildState({ p0: { battle: [MARURU] } });
  const self = s.players[0].battle[0].cards[0];
  const c = cc(s, { self });
  const m = (pat: any, e: Partial<Ev> & { type: string }, ctl: PlayerId = 0) => matchPattern(cc(s, { self }, ctl), pat, ev(e));

  it('type が違えば不一致、type だけなら一致', () => {
    expect(m({ type: 'entered' }, { type: 'entered' })).toBe(true);
    expect(m({ type: 'entered' }, { type: 'moved' })).toBe(false);
  });
  it('self: 発生源のカードに限る', () => {
    expect(m({ type: 'entered', self: true }, { type: 'entered', card: self })).toBe(true);
    expect(m({ type: 'entered', self: true }, { type: 'entered', card: self + 1 })).toBe(false);
  });
  it('via / cause / from / to / kind / ex / step / paid / free', () => {
    expect(m({ type: 'entered', via: 'summon' }, { type: 'entered', via: 'summon' })).toBe(true);
    expect(m({ type: 'entered', via: 'summon' }, { type: 'entered', via: 'effect' })).toBe(false);
    expect(m({ type: 'moved', cause: 'draw' }, { type: 'moved', cause: 'draw' })).toBe(true);
    expect(m({ type: 'moved', cause: 'draw' }, { type: 'moved', cause: 'charge' })).toBe(false);
    expect(m({ type: 'moved', from: 'hand', to: 'mana' }, { type: 'moved', from: 'hand', to: 'mana' })).toBe(true);
    expect(m({ type: 'moved', from: 'hand', to: 'mana' }, { type: 'moved', from: 'deck', to: 'mana' })).toBe(false);
    expect(m({ type: 'x', kind: 'gStrike' }, { type: 'x', kind: 'shieldTrigger' })).toBe(false);
    expect(m({ type: 'x', ex: true }, { type: 'x' })).toBe(false);
    expect(m({ type: 'x', ex: false }, { type: 'x' })).toBe(true);
    expect(m({ type: 'stepStart', step: 'end' }, { type: 'stepStart', step: 'end' })).toBe(true);
    expect(m({ type: 'stepStart', step: 'end' }, { type: 'stepStart', step: 'start' })).toBe(false);
    expect(m({ type: 'cast', paid: true }, { type: 'cast', paid: false })).toBe(false);
    expect(m({ type: 'cast', free: true }, { type: 'cast' })).toBe(false);
    expect(m({ type: 'cast', free: true }, { type: 'cast', free: true })).toBe(true);
  });
  it('owner / player / controller は、能力の持ち主から見た相対指定', () => {
    expect(m({ type: 'cast', owner: 'self' }, { type: 'cast', owner: 0 })).toBe(true);
    expect(m({ type: 'cast', owner: 'self' }, { type: 'cast', owner: 1 })).toBe(false);
    expect(m({ type: 'cast', owner: 'opponent' }, { type: 'cast', owner: 1 })).toBe(true);
    expect(m({ type: 'cast', owner: 'any' }, { type: 'cast', owner: 1 })).toBe(true);
    expect(m({ type: 'cast', owner: 'self' }, { type: 'cast', owner: 1 }, 1)).toBe(true); // 視点が逆
    expect(m({ type: 'cast', owner: 'self' }, { type: 'cast' })).toBe(false); // イベントに持ち主がない
    expect(m({ type: 'stepStart', player: 'self' }, { type: 'stepStart', player: 0 })).toBe(true);
    expect(m({ type: 'x', controller: 'opponent' }, { type: 'x', controller: 1 })).toBe(true);
  });
  it('role: ブロックされた側/した側、バトルの勝者/敗者', () => {
    expect(m({ type: 'blocked', role: 'attacker' }, { type: 'blocked', attackerCard: self, card: 99 })).toBe(true);
    expect(m({ type: 'blocked', role: 'attacker' }, { type: 'blocked', attackerCard: 99, card: self })).toBe(false);
    expect(m({ type: 'blocked', role: 'blocker' }, { type: 'blocked', attackerCard: 99, card: self })).toBe(true);
    expect(m({ type: 'battleEnded', role: 'winner' }, { type: 'battleEnded', winnerCard: self, loserCard: 99 })).toBe(true);
    expect(m({ type: 'battleEnded', role: 'loser' }, { type: 'battleEnded', winnerCard: self, loserCard: 99 })).toBe(false);
    expect(m({ type: 'battleEnded', role: 'loser' }, { type: 'battleEnded', winnerCard: 99, loserCard: self })).toBe(true);
    expect(m({ type: 'battleEnded', role: 'winner' }, { type: 'battleEnded' })).toBe(false); // 勝者なし(相打ち)
  });
  it('winner: 勝者の持ち主(相対)', () => {
    expect(m({ type: 'battleEnded', winner: 'self' }, { type: 'battleEnded', winnerOwner: 0 })).toBe(true);
    expect(m({ type: 'battleEnded', winner: 'opponent' }, { type: 'battleEnded', winnerOwner: 0 })).toBe(false);
    expect(m({ type: 'battleEnded', winner: 'self' }, { type: 'battleEnded' })).toBe(false);
  });
  it('attackerCond: 攻撃したカードが条件を満たす', () => {
    const t = buildState({ p0: { battle: [MARURU, W] } });
    const [x, y] = t.players[0].battle.map((p) => p.cards[0]);
    const pat = { type: 'attackDeclared', attackerCond: { civ: 'nature' } };
    expect(matchPattern(cc(t), pat, ev({ type: 'attackDeclared', card: x }))).toBe(true);
    expect(matchPattern(cc(t), pat, ev({ type: 'attackDeclared', card: y }))).toBe(false);
    expect(matchPattern(cc(t), pat, ev({ type: 'attackDeclared' }))).toBe(false);
  });
  it('使用していない変数: 能力の発生源がなくても評価できる', () => {
    expect(matchPattern(cc(s), { type: 'entered' }, ev({ type: 'entered' }))).toBe(true);
    void c;
  });
});

describe('raceMatches(種族の一致)', () => {
  it('種族名に含まれれば一致する(複合名の一部にも当たる)', () => {
    expect(raceMatches('メガ・コマンド・ドラゴン', 'ドラゴン')).toBe(true);
    expect(raceMatches('アウトレイジ・コマンドMAX', 'コマンド')).toBe(true);
    expect(raceMatches('ドラゴン・ゾンビ', 'ドラゴン')).toBe(true);
    expect(raceMatches('サイバーロード', 'ドラゴン')).toBe(false);
  });
  it('ドラゴンギルドは、ドラゴンとは別の種族(「ドラゴン」には当たらない。「ドラゴンギルド」には当たる)', () => {
    expect(raceMatches('ドラゴンギルド', 'ドラゴン')).toBe(false);
    expect(raceMatches('ドラゴンギルド', 'ドラゴンギルド')).toBe(true);
  });
});
