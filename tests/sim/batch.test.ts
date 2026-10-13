import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../../src/cards';
import { formatStats, runMatches, type MatchOpts } from '../../src/sim/batch';

const base = (o: Partial<MatchOpts> = {}): MatchOpts => ({
  deckA: deckCards('maruru'),
  deckB: deckCards('zardy'),
  agentA: { kind: 'random' },
  agentB: { kind: 'random' },
  games: 8,
  seed: 11,
  ...o,
});

describe('runMatches(バッチ対戦)', () => {
  it('勝敗・引き分けの合計が試合数に一致し、勝率と区間が整合する', () => {
    const s = runMatches(CARD_DB, base());
    expect(s.games).toBe(8);
    expect(s.winsA + s.winsB + s.draws).toBe(8);
    expect(s.winRateA).toBeCloseTo(s.winsA / 8, 12);
    expect(s.ci95A[0]).toBeLessThanOrEqual(s.winRateA);
    expect(s.ci95A[1]).toBeGreaterThanOrEqual(s.winRateA);
    expect(s.avgTurns).toBeGreaterThan(0);
    expect(Object.values(s.reasons).reduce((a, b) => a + b, 0)).toBe(8);
    expect(s.gamesAFirst + s.gamesASecond).toBe(8);
  });

  it('同じシードなら、時間以外は同じ結果(再現性)', () => {
    const a = runMatches(CARD_DB, base());
    const b = runMatches(CARD_DB, base());
    expect({ ...a, ms: 0 }).toEqual({ ...b, ms: 0 });
  });

  it('シードが違えば、(ほぼ確実に)別の結果になる', () => {
    const a = runMatches(CARD_DB, base({ games: 12, seed: 1 }));
    const b = runMatches(CARD_DB, base({ games: 12, seed: 999 }));
    expect([a.winsA, a.avgTurns]).not.toEqual([b.winsA, b.avgTurns]);
  });

  it('first=alternate: Aは先攻・後攻が交互になる', () => {
    const s = runMatches(CARD_DB, base({ games: 6, first: 'alternate' }));
    expect(s.gamesAFirst).toBe(3);
    expect(s.gamesASecond).toBe(3);
    expect(s.winRateAFirst).not.toBeNull();
    expect(s.winRateASecond).not.toBeNull();
  });

  it('first=fixed: Aは常に先攻(後攻の勝率は null)', () => {
    const s = runMatches(CARD_DB, base({ games: 5, first: 'fixed' }));
    expect(s.gamesAFirst).toBe(5);
    expect(s.gamesASecond).toBe(0);
    expect(s.winRateASecond).toBeNull();
    // 先攻はAなので、先攻の勝率はAの勝率と同じ
    expect(s.firstPlayerWinRate).toBeCloseTo(s.winRateA, 12);
  });

  it('first=random: 先攻・後攻の試合数の合計が試合数に一致する', () => {
    const s = runMatches(CARD_DB, base({ games: 10, first: 'random' }));
    expect(s.gamesAFirst + s.gamesASecond).toBe(10);
  });

  it('進捗が試合ごとに通知される', () => {
    const calls: [number, number][] = [];
    runMatches(CARD_DB, base({ games: 4, onProgress: (d, t) => calls.push([d, t]) }));
    expect(calls).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);
  });

  it('shouldCancel で途中で止められ、それまでの分だけ集計する', () => {
    let n = 0;
    const s = runMatches(CARD_DB, base({ games: 20, onProgress: () => n++, shouldCancel: () => n >= 3 }));
    expect(s.games).toBe(3);
    expect(s.winsA + s.winsB + s.draws).toBe(3);
  });

  it('0試合でも例外にならない', () => {
    const s = runMatches(CARD_DB, base({ games: 0 }));
    expect(s.games).toBe(0);
    expect(s.winRateA).toBe(0);
    expect(s.winRateAFirst).toBeNull();
  });

  it('先攻後攻を入れ替えても、デッキとエージェントの対応は保たれる(Aのデッキ=AのAI)', () => {
    // A = パス(何もしない)、B = ルールベース。Bが圧倒するので、席に関わらずAの勝率は低い
    const s = runMatches(CARD_DB, base({ agentA: { kind: 'pass' }, agentB: { kind: 'rule' }, games: 10, first: 'alternate' }));
    expect(s.winsB).toBeGreaterThan(s.winsA);
  }, 120000);

  it('cfg(ターン上限)が反映される: 上限1ターンならすべて引き分け', () => {
    const s = runMatches(CARD_DB, base({ games: 3, cfg: { turnLimit: 1 } }));
    expect(s.draws).toBe(3);
    expect(s.winsA + s.winsB).toBe(0);
  });
});

describe('formatStats', () => {
  it('試合数・勝率・平均ターンを整形する。先攻/後攻の行は試合があるときだけ', () => {
    const s = runMatches(CARD_DB, base({ games: 4, first: 'fixed' }));
    const t = formatStats('テスト', s);
    expect(t).toContain('■ テスト');
    expect(t).toContain('試合数 4');
    expect(t).toContain('Aが先攻の時');
    expect(t).not.toContain('Aが後攻の時');
  });
});
