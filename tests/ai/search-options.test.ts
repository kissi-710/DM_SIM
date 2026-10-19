// 探索の早期終了の設定(precision / minIterations)と、spec 文字列の prec= minit=
import { describe, expect, it } from 'vitest';
import { MctsSearch, pairedVerdict } from '../../src/ai/mcts';
import { STRONG_TUNING, withStrong } from '../../src/ai';
import { parseSpec, specLabel } from '../../src/ai/specString';

/** 2 つの手が、毎ラウンドまったく同じ報酬(差が 0)の探索を、終わるまで進めて、使った反復数を返す */
function runTie(opts: { precise?: number; minIt?: number }): { it: number; decided: boolean } {
  const s = new MctsSearch(2, 0, 0, 100000, true, 2.5, false, opts.precise ?? 0.012, opts.minIt ?? 0);
  for (let r = 0; r < 100000 && !s.finished; r++) s.feed([0.5, 0.5]);
  return { it: s.it, decided: s.decided };
}

describe('早期終了の設定', () => {
  it('既定: 差が無い 2 つの手は、判定できる精度に達した所(100 ラウンド台)で打ち切る', () => {
    const r = runTie({});
    expect(r.decided).toBe(true);
    expect(r.it).toBeGreaterThan(150);
    expect(r.it).toBeLessThan(400);
  });
  it('precision を小さくすると、僅差の比較を長く続ける', () => {
    const a = runTie({}).it;
    const b = runTie({ precise: 0.003 }).it;
    expect(b).toBeGreaterThan(a * 5);
  });
  it('minIterations までは、1位と2位の判定で打ち切らない', () => {
    const a = runTie({}).it;
    const b = runTie({ minIt: 3000 }).it;
    expect(a).toBeLessThan(500);
    expect(b).toBeGreaterThanOrEqual(3000);
    expect(b).toBeLessThan(3200);
  });
  it('pairedVerdict: precise の引数で、precise と open が切り替わる', () => {
    // n = 200 ラウンド、差の平均 0、分散は下限(0.0025)
    expect(pairedVerdict(200, 0, 0, 0)).toBe('precise');
    expect(pairedVerdict(200, 0, 0, 0, 2.5, 0.001)).toBe('open');
  });
});

describe('「強い」CPU の設定', () => {
  it('STRONG_TUNING: 手を外す判定をせず、精度の基準を細かくする(docs/ai-replay-analysis.md)', () => {
    expect(STRONG_TUNING).toEqual({ elimZ: 99, precision: 0.003 });
  });
  it('withStrong は mcts にだけ設定を重ね、明示した値が優先される', () => {
    expect(withStrong({ kind: 'mcts', ms: 1200 }).tuning).toEqual({ elimZ: 99, precision: 0.003 });
    expect(withStrong({ kind: 'mcts', tuning: { precision: 0.01, horizonTurns: 4 } }).tuning).toEqual({ elimZ: 99, precision: 0.01, horizonTurns: 4 });
    expect(withStrong({ kind: 'rule' })).toEqual({ kind: 'rule' });
  });
  it('spec 文字列の strong=1: 設定が入り、明示した z・prec が優先。strong=0 は入らない', () => {
    expect(parseSpec('mcts:ms=1200,strong=1').tuning).toEqual({ elimZ: 99, precision: 0.003 });
    expect(parseSpec('mcts:strong=1,prec=0.006').tuning).toMatchObject({ elimZ: 99, precision: 0.006 });
    expect(parseSpec('mcts:strong=1,z=3').tuning).toMatchObject({ elimZ: 3, precision: 0.003 });
    expect(parseSpec('mcts:strong=0').tuning).toBeUndefined();
  });
});

describe('spec 文字列の prec= minit=', () => {
  it('読み取り、ラベルに戻る', () => {
    const spec = parseSpec('mcts:ms=1200,prec=0.003,minit=1500,z=99');
    expect(spec.tuning).toMatchObject({ precision: 0.003, minIterations: 1500, elimZ: 99 });
    const label = specLabel(spec);
    expect(label).toContain('prec=0.003');
    expect(label).toContain('minit=1500');
  });
  it('数でなければエラー', () => {
    expect(() => parseSpec('mcts:prec=abc')).toThrow();
    expect(() => parseSpec('mcts:minit=x')).toThrow();
  });
});
