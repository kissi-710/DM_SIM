// 調査結果のエクスポート(JSON / CSV)と、テキスト整形(spec 6.6)。
import type { PatternResult, ProbResult } from './solitaire';

const esc = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function probToCsv(r: ProbResult): string {
  const rows: (string | number)[][] = [['ターン', '方針プレイ(累積)', '方針プレイ(その回に初めて達成)']];
  for (let t = 0; t < r.policy.byTurn.length; t++) rows.push([t, r.policy.byTurn[t], r.policy.turnDist[t]]);
  rows.push([]);
  rows.push(['項目', '値']);
  rows.push(['試行回数', r.trials]);
  rows.push(['方針プレイの達成率', r.policy.rate]);
  rows.push(['95%信頼区間(下)', r.policy.ci95[0]]);
  rows.push(['95%信頼区間(上)', r.policy.ci95[1]]);
  if (r.search) {
    rows.push(['探索による上限(達成率)', r.search.rate]);
    rows.push(['探索による上限(未判定を含めた最大値)', r.search.maxRate]);
    rows.push(['探索: 未判定の試行', r.search.unknown]);
  }
  if (r.exact) rows.push(['超幾何分布の厳密値', r.exact.value]);
  return rows.map((row) => row.map(esc).join(',')).join('\n');
}

export function patternsToCsv(r: PatternResult): string {
  const rows: (string | number)[][] = [['順位', 'パターン', '件数', '全試行に対する割合', '達成した試行に対する割合', '代表シード']];
  r.patterns.forEach((p, i) => rows.push([i + 1, p.key, p.count, p.ratioAll, p.ratioAchieved, p.sampleSeed]));
  return rows.map((row) => row.map(esc).join(',')).join('\n');
}

export const pct = (x: number, d = 1) => (x * 100).toFixed(d) + '%';

export function formatProb(r: ProbResult): string {
  const lines: string[] = [];
  lines.push(`試行 ${r.trials} 回 / 調査ターン ${r.maxTurns} / ${r.ms}ms`);
  lines.push(`方針プレイ: ${pct(r.policy.rate)}(95%信頼区間 ${pct(r.policy.ci95[0])} 〜 ${pct(r.policy.ci95[1])})`);
  if (r.search) {
    lines.push(
      `探索による上限: ${pct(r.search.rate)}${r.search.unknown > 0 ? `〜${pct(r.search.maxRate)}` : ''}(95%信頼区間 ${pct(r.search.ci95[0])} 〜 ${pct(r.search.ci95[1])}、未判定 ${r.search.unknown} 回、平均 ${r.search.avgNodes.toFixed(0)} ノード)`,
    );
  }
  if (r.exact) lines.push(`厳密値(超幾何分布): ${pct(r.exact.value, 2)} … ${r.exact.note}`);
  lines.push('ターンまでの達成率(累積):');
  r.policy.byTurn.forEach((v, t) => {
    if (t >= 1) lines.push(`  ${t}ターン目まで ${pct(v)}`);
  });
  return lines.join('\n');
}

export function formatPatterns(r: PatternResult, top = 10): string {
  const lines: string[] = [];
  lines.push(`試行 ${r.trials} 回 / 達成した試行 ${r.achievedTrials} / 未判定 ${r.unknownTrials} / パターン ${r.patterns.length} 種 / ${r.ms}ms`);
  r.patterns.slice(0, top).forEach((p, i) => {
    lines.push(`#${i + 1} ${pct(p.ratioAll)}(達成した試行の ${pct(p.ratioAchieved)}) ${p.count}件`);
    for (const t of p.turns) {
      lines.push(`    ${t.turn}T: マナ ${t.charge ?? '-'} / 使用 ${t.plays.join(' → ') || '-'}${t.choices.length ? ' / 選択 ' + t.choices.join('; ') : ''}`);
    }
  });
  return lines.join('\n');
}
