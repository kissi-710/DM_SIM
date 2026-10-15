import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../../src/cards';
import { runMatches, type MatchOpts } from '../../src/sim/batch';
import { mergeMatches } from '../../src/sim/jobs';
import { addAcc, emptyAcc, estimateRate, wilson } from '../../src/sim/stats';
import { makeAgent } from '../../src/ai';
import { playGameSync } from '../../src/sim/playGame';
import { loadRegistry } from '../../src/engine/registry';

describe('estimateRate(勝率の推定と区間)', () => {
  it('片方の席だけなら、得点の割合と Wilson 区間(引分は 0.5)', () => {
    const a = { ...emptyAcc(), nF: 10, sF: 7.5 };
    const e = estimateRate(a);
    expect(e.rate).toBeCloseTo(0.75, 12);
    expect(e.ci).toEqual(wilson(7.5, 10));
  });

  it('先攻・後攻の両方があれば、席ごとの勝率を 1/2 ずつの重みで混ぜる(試合数が偏っても歪まない)', () => {
    const a = { ...emptyAcc(), nF: 30, sF: 27, nS: 10, sS: 3 }; // 90% と 30%
    expect(estimateRate(a).rate).toBeCloseTo(0.6, 12);
  });

  it('複製対局は、ペア単位で評価する: 全ペアが引分け(0.5)でも、区間は潰れずに、試合単位の区間より狭い', () => {
    const m = 50;
    const a = { ...emptyAcc(), nF: m, sF: m / 2, nS: m, sS: m / 2, m, pSum: m * 0.5, pSq: m * 0.25 };
    const e = estimateRate(a);
    expect(e.rate).toBeCloseTo(0.5, 12);
    const w = e.ci[1] - e.ci[0];
    expect(w).toBeGreaterThan(0.001);
    expect(w).toBeLessThan((wilson(m, 2 * m)[1] - wilson(m, 2 * m)[0]) * 0.5);
  });

  it('addAcc は足し算(範囲を分けて実行した統計の統合に使う)', () => {
    const x = { nF: 1, sF: 1, nS: 2, sS: 0.5, m: 1, pSum: 0.5, pSq: 0.25 };
    expect(addAcc(x, x)).toEqual({ nF: 2, sF: 2, nS: 4, sS: 1, m: 2, pSum: 1, pSq: 0.5 });
  });
});

describe('範囲を分けて実行した対戦の統合', () => {
  const base = (o: Partial<MatchOpts> = {}): MatchOpts => ({
    deckA: deckCards('maruru'),
    deckB: deckCards('zardy'),
    agentA: { kind: 'rule' },
    agentB: { kind: 'random' },
    games: 12,
    seed: 5,
    ...o,
  });
  for (const first of ['alternate', 'duplicate'] as const) {
    it(`first=${first}: 3つに分けて統合した結果は、一括の結果と一致する(推定値・区間を含む)`, () => {
      const whole = runMatches(CARD_DB, base({ first }));
      const parts = [0, 4, 8].map((st) => runMatches(CARD_DB, base({ first, games: 4, startIndex: st })));
      const m = mergeMatches(parts);
      expect(m.games).toBe(whole.games);
      expect(m.winsA).toBe(whole.winsA);
      expect(m.winRateA).toBeCloseTo(whole.winRateA, 12);
      expect(m.ci95A[0]).toBeCloseTo(whole.ci95A[0], 12);
      expect(m.ci95A[1]).toBeCloseTo(whole.ci95A[1], 12);
    });
  }
});

describe('ルールベースのターン中の行動は、ビューの複製なしでも同じ手を選ぶ', () => {
  it('viewless を無効にした場合と、1試合の全手順が一致する', () => {
    const reg = loadRegistry(CARD_DB);
    const rule = makeAgent({ kind: 'rule' });
    const masked = { ...rule, viewless: undefined };
    for (const seed of [1, 2, 3]) {
      const decks: [string[], string[]] = [deckCards('maruru'), deckCards('zardy')];
      const a = playGameSync(reg, [rule, rule], { decks, seed, first: 0 });
      const b = playGameSync(reg, [masked, masked], { decks, seed, first: 0 });
      expect(JSON.stringify(a.actions)).toBe(JSON.stringify(b.actions));
      expect(a.winner).toBe(b.winner);
    }
  });
});
