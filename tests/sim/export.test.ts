import { describe, expect, it } from 'vitest';
import { formatPatterns, formatProb, patternsToCsv, pct, probToCsv } from '../../src/sim/export';
import type { PatternResult, ProbResult } from '../../src/sim/solitaire';

const prob = (o: Partial<ProbResult> = {}): ProbResult => ({
  trials: 100,
  maxTurns: 3,
  policy: { achieved: 40, rate: 0.4, ci95: [0.31, 0.5], byTurn: [0, 0.1, 0.3, 0.4], turnDist: [0, 0.1, 0.2, 0.1] },
  ms: 12,
  ...o,
});

const patterns = (): PatternResult => ({
  trials: 50,
  achievedTrials: 20,
  unknownTrials: 1,
  ms: 7,
  patterns: [
    {
      key: 'T1 マナ:A 使用:-',
      turns: [{ turn: 1, charge: 'A', plays: [], choices: [] }, { turn: 2, charge: 'B', plays: ['X', 'Y'], choices: ['X: Z'] }],
      count: 12,
      ratioAll: 0.24,
      ratioAchieved: 0.6,
      sampleSeed: 7,
      sampleActions: [],
      handFreq: {},
    },
    { key: 'カンマ,と"引用符"', turns: [], count: 8, ratioAll: 0.16, ratioAchieved: 0.4, sampleSeed: 9, sampleActions: [], handFreq: {} },
  ],
});

describe('pct', () => {
  it('小数をパーセント表記にする(桁数指定可)', () => {
    expect(pct(0.1234)).toBe('12.3%');
    expect(pct(0.1234, 2)).toBe('12.34%');
    expect(pct(0)).toBe('0.0%');
    expect(pct(1)).toBe('100.0%');
  });
});

describe('probToCsv', () => {
  it('ターンごとの累積・初達成の列と、要約の項目が出る', () => {
    const csv = probToCsv(prob());
    const lines = csv.split('\n');
    expect(lines[0]).toBe('ターン,方針プレイ(累積),方針プレイ(その回に初めて達成)');
    expect(lines[1]).toBe('0,0,0');
    expect(lines[4]).toBe('3,0.4,0.1');
    expect(csv).toContain('試行回数,100');
    expect(csv).toContain('方針プレイの達成率,0.4');
    expect(csv).toContain('95%信頼区間(下),0.31');
    expect(csv).not.toContain('探索による上限');
    expect(csv).not.toContain('超幾何分布');
  });
  it('探索結果・厳密値があれば追加の行が出る', () => {
    const csv = probToCsv(
      prob({
        search: { achieved: 5, unknown: 2, judged: 8, rate: 0.5, ci95: [0.1, 0.9], avgNodes: 10, maxRate: 0.7 },
        exact: { value: 0.25, note: 'メモ' },
      }),
    );
    expect(csv).toContain('探索による上限(達成率),0.5');
    expect(csv).toContain('探索: 未判定の試行,2');
    expect(csv).toContain('探索による上限(未判定を含めた最大値),0.7');
    expect(csv).toContain('超幾何分布の厳密値,0.25');
  });
});

describe('patternsToCsv', () => {
  it('順位・件数・割合・代表シードが並び、カンマや引用符を含む値は引用符で囲まれる', () => {
    const csv = patternsToCsv(patterns());
    const lines = csv.split('\n');
    expect(lines[0]).toBe('順位,パターン,件数,全試行に対する割合,達成した試行に対する割合,代表シード');
    expect(lines[1]).toBe('1,T1 マナ:A 使用:-,12,0.24,0.6,7');
    expect(lines[2]).toBe('2,"カンマ,と""引用符""",8,0.16,0.4,9');
  });
  it('パターンが空ならヘッダだけ', () => {
    expect(patternsToCsv({ ...patterns(), patterns: [] }).split('\n')).toHaveLength(1);
  });
});

describe('formatProb', () => {
  it('試行回数・達成率・累積の行が出る(0ターン目は出さない)', () => {
    const t = formatProb(prob());
    expect(t).toContain('試行 100 回');
    expect(t).toContain('方針プレイ: 40.0%');
    expect(t).toContain('1ターン目まで 10.0%');
    expect(t).toContain('3ターン目まで 40.0%');
    expect(t).not.toContain('0ターン目まで');
  });
  it('未判定がなければ、探索の上限に範囲(最大値)は付かない', () => {
    const t = formatProb(prob({ search: { achieved: 5, unknown: 0, judged: 10, rate: 0.5, ci95: [0.2, 0.8], avgNodes: 10, maxRate: 0.5 } }));
    expect(t).toContain('探索による上限: 50.0%(95%信頼区間');
    expect(t).not.toContain('50.0%〜');
  });
  it('探索・厳密値の行は、あるときだけ出る', () => {
    expect(formatProb(prob())).not.toContain('探索による上限');
    const t = formatProb(prob({ search: { achieved: 5, unknown: 2, judged: 8, rate: 0.5, ci95: [0.1, 0.9], avgNodes: 10, maxRate: 0.7 }, exact: { value: 0.123, note: 'N' } }));
    expect(t).toContain('探索による上限: 50.0%〜70.0%');
    expect(t).toContain('未判定 2 回');
    expect(t).toContain('厳密値(超幾何分布): 12.30% … N');
  });
});

describe('formatPatterns', () => {
  it('上位のパターンを、ターンごとの履歴つきで出す', () => {
    const t = formatPatterns(patterns());
    expect(t).toContain('達成した試行 20');
    expect(t).toContain('#1 24.0%(達成した試行の 60.0%) 12件');
    expect(t).toContain('1T: マナ A / 使用 -');
    expect(t).toContain('2T: マナ B / 使用 X → Y / 選択 X: Z');
  });
  it('top で件数を絞れる', () => {
    expect(formatPatterns(patterns(), 1)).not.toContain('#2');
    expect(formatPatterns(patterns(), 5)).toContain('#2');
  });
});
