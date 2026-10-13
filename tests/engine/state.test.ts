import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../../src/engine/invariants';
import {
  cardsOwnedBy,
  cloneJson,
  cloneState,
  hashSeed,
  isTopOfPile,
  mkCtx,
  nextId,
  opponentOf,
  permByPid,
  permTop,
  rngInt,
  rngNext,
  shuffleInPlace,
  snapOf,
} from '../../src/engine/state';
import { buildState, reg } from '../scenario';

describe('乱数(状態に内包)', () => {
  it('rngNext は 0以上1未満で、状態の rng を進め、同じ状態なら同じ列', () => {
    const a = buildState({ seed: 5 });
    const b = buildState({ seed: 5 });
    const xs: number[] = [];
    for (let i = 0; i < 200; i++) {
      const x = rngNext(a);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      expect(rngNext(b)).toBe(x);
      xs.push(x);
    }
    expect(a.rng).toBe(b.rng);
    expect(new Set(xs).size).toBeGreaterThan(190);
  });
  it('rngInt は 0〜n-1 のすべてを出す', () => {
    const s = buildState({ seed: 1 });
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const v = rngInt(s, 6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });
  it('平均はほぼ 0.5(偏りがない)', () => {
    const s = buildState({ seed: 99 });
    let t = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) t += rngNext(s);
    expect(t / n).toBeGreaterThan(0.47);
    expect(t / n).toBeLessThan(0.53);
  });
  it('shuffleInPlace は順列になり、同じ種なら同じ並び。空・1要素も壊れない', () => {
    const base = Array.from({ length: 30 }, (_, i) => i);
    const a = shuffleInPlace(buildState({ seed: 3 }), base.slice());
    const b = shuffleInPlace(buildState({ seed: 3 }), base.slice());
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(base);
    expect(a).not.toEqual(base);
    const s = buildState({ seed: 3 });
    expect(shuffleInPlace(s, [])).toEqual([]);
    expect(shuffleInPlace(s, [7])).toEqual([7]);
  });
  it('シャッフルは位置の偏りが小さい(各要素が各位置に来る頻度)', () => {
    const counts = Array.from({ length: 4 }, () => new Array(4).fill(0));
    const s = buildState({ seed: 11 });
    const N = 4000;
    for (let i = 0; i < N; i++) shuffleInPlace(s, [0, 1, 2, 3]).forEach((v, pos) => counts[v][pos]++);
    for (const row of counts) for (const c of row) expect(Math.abs(c / N - 0.25)).toBeLessThan(0.04);
  });
});

describe('hashSeed', () => {
  it('数値はそのまま32bit整数に、文字列は決定的なハッシュになる', () => {
    expect(hashSeed(5)).toBe(5);
    expect(hashSeed(2 ** 32 + 7)).toBe(7);
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
    expect(Number.isInteger(hashSeed('日本語のシード'))).toBe(true);
    expect(hashSeed('')).toBe(hashSeed(''));
  });
});

describe('cloneJson / cloneState', () => {
  it('cloneJson: 深いコピーで、元と独立。プリミティブ・null はそのまま', () => {
    const o = { a: [1, { b: 2 }], c: null, d: 'x' };
    const c = cloneJson(o);
    expect(c).toEqual(o);
    (c.a[1] as any).b = 99;
    expect((o.a[1] as any).b).toBe(2);
    expect(cloneJson(5)).toBe(5);
    expect(cloneJson(null)).toBeNull();
  });
  it('cloneState: カード・ゾーン・フレーム・効果・usage は独立。変更が元に伝わらない', () => {
    const s = buildState({ p0: { hand: ['アクアン'], battle: ['ヨビニオン・マルル'], mana: ['フェアリー・ライフ'] } });
    s.effects.push({ id: 1, pid: 1, mod: { kind: 'cannotAttack' }, until: { kind: 'endOfTurn', turn: 5 }, controller: 0 });
    s.usage.x = 1;
    const c = cloneState(s);
    expect(JSON.stringify(c)).toBe(JSON.stringify(s));
    c.cards[0].tapped = true;
    c.players[0].hand.pop();
    c.players[0].battle[0].tapped = true;
    c.players[0].battle[0].cards.push(1234);
    c.cont[0].vars.k = 1;
    c.effects[0].pid = 77;
    c.usage.x = 2;
    c.pool.push({} as any);
    c.turnLog.push({} as any);
    c.rans.push(1);
    expect(s.cards[0].tapped).toBe(false);
    expect(s.players[0].hand).toHaveLength(1);
    expect(s.players[0].battle[0].tapped).toBe(false);
    expect(s.players[0].battle[0].cards).toHaveLength(1);
    expect(s.cont[0].vars.k).toBeUndefined();
    expect(s.effects[0].pid).toBe(1);
    expect(s.usage.x).toBe(1);
    expect(s.pool).toHaveLength(0);
    expect(s.turnLog).toHaveLength(0);
    expect(s.rans).toHaveLength(0);
  });
  it('状態はJSONで往復できる(関数・循環参照を持たない)', () => {
    const s = buildState({ p0: { hand: ['アクアン'], battle: ['ヨビニオン・マルル'] } });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('参照ヘルパー', () => {
  const s = buildState({
    p0: { battle: [{ c: 'ヨビニオン・マルル', under: ['アクアン'] }], hand: ['アクアン'], grave: ['アクアン'] },
    p1: { battle: ['ティンパニ=シンバリー'] },
  });
  it('opponentOf', () => {
    expect(opponentOf(0)).toBe(1);
    expect(opponentOf(1)).toBe(0);
  });
  it('permByPid: 山と持ち主を引く。無ければ null', () => {
    const p0 = s.players[0].battle[0];
    const p1 = s.players[1].battle[0];
    expect(permByPid(s, p0.pid)?.owner).toBe(0);
    expect(permByPid(s, p1.pid)?.owner).toBe(1);
    expect(permByPid(s, 99999)).toBeNull();
    expect(permTop(p0)).toBe(p0.cards[0]);
  });
  it('isTopOfPile: 山の一番上だけが真。バトルゾーン以外は偽', () => {
    const p0 = s.players[0].battle[0];
    expect(isTopOfPile(s, p0.cards[0])).toBe(true);
    expect(isTopOfPile(s, p0.cards[1])).toBe(false);
    expect(isTopOfPile(s, s.players[0].hand[0])).toBe(false);
  });
  it('cardsOwnedBy: 持ち主ごとの全カード', () => {
    const own0 = cardsOwnedBy(s, 0);
    const own1 = cardsOwnedBy(s, 1);
    expect(own0.length + own1.length).toBe(s.cards.length);
    expect(own0.every((u) => s.cards[u].owner === 0)).toBe(true);
  });
  it('nextId は単調に増える', () => {
    const t = buildState({});
    const a = nextId(t);
    const b = nextId(t);
    expect(b).toBe(a + 1);
  });
  it('snapOf: バトルゾーンでは面の文明、それ以外は全面の文明の和集合', () => {
    const t = buildState({ p0: { hand: ['ワクムテラス'], battle: ['ヨビニオン・マルル'] } });
    const c = mkCtx(t, reg);
    const inHand = snapOf(c, t.players[0].hand[0]);
    expect(inHand.civs.sort()).toEqual(['nature', 'water']);
    expect(inHand.multicolor).toBe(true);
    const top = t.players[0].battle[0].cards[0];
    const onField = snapOf(c, top);
    expect(onField.civs).toEqual(['nature']);
    expect(onField.power).toBe(5000);
    expect(onField.cost).toBe(4);
    expect(onField.zone).toBe('battle');
    expect(onField.pid).toBe(t.players[0].battle[0].pid);
  });
});

describe('checkInvariants(異常の検出)', () => {
  const base = () => buildState({ p0: { hand: ['アクアン'], battle: [{ c: 'ヨビニオン・マルル', under: ['アクアン'] }], mana: ['フェアリー・ライフ'], grave: ['アクアン'] } });

  it('正しい状態は空', () => {
    expect(checkInvariants(base())).toEqual([]);
  });
  it('同じカードが2か所にあれば検出する', () => {
    const s = base();
    s.players[0].grave.push(s.players[0].hand[0]);
    expect(checkInvariants(s).join()).toContain('重複');
  });
  it('zone と実際の置き場所が食い違えば検出する', () => {
    const s = base();
    s.cards[s.players[0].hand[0]].zone = 'grave';
    expect(checkInvariants(s).join()).toContain('zone');
  });
  it('持ち主が食い違えば検出する', () => {
    const s = base();
    s.cards[s.players[0].hand[0]].owner = 1;
    expect(checkInvariants(s).join()).toContain('持ち主');
  });
  it('山の pid が食い違えば検出する', () => {
    const s = base();
    s.cards[s.players[0].battle[0].cards[1]].pid = 999;
    expect(checkInvariants(s).join()).toContain('pid');
  });
  it('空の山を検出する', () => {
    const s = base();
    s.players[0].battle.push({ pid: 50, cards: [], tapped: false, sick: false, enteredTurn: 0 });
    expect(checkInvariants(s).join()).toContain('空の山');
  });
  it('どこにもないカード(総数不一致)を検出する', () => {
    const s = base();
    s.players[0].hand.pop();
    expect(checkInvariants(s).join()).toContain('カード総数');
  });
  it('limbo の zone 不整合を検出する', () => {
    const s = base();
    const u = s.players[0].hand.pop()!;
    s.limbo.push(u);
    expect(checkInvariants(s).join()).toContain('limbo');
  });
  it('存在しないカードへの参照を検出する', () => {
    const s = base();
    s.players[0].hand.push(99999);
    expect(checkInvariants(s).join()).toContain('存在しない');
  });
  it('入力待ちがあるのに実行スタックが空なら検出する', () => {
    const s = base();
    s.cont = [];
    s.pending = { id: 1, player: 0, why: 'turnAction', input: null };
    expect(checkInvariants(s).join()).toContain('実行スタック');
    s.winner = 0;
    expect(checkInvariants(s).join()).not.toContain('実行スタック');
  });
});
