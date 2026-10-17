// 悪手の集計: scripts/blunders.ts の出力を、判断の種類・ターン帯・損失の大きさで集計し、代表例を出す。
//   npx tsx scripts/blunders-report.ts <名前> [しきい値=0.10] [例の数=12]
import { readFileSync } from 'node:fs';
import type { Rec } from './blunderWorker';

const [name = 'big', thArg = '0.10', exArg = '12', deckMinArg = '0'] = process.argv.slice(2);
const deckMin = Number(deckMinArg);
const th = Number(thArg);
const data = JSON.parse(readFileSync(`scratch/blunders/${name}.json`, 'utf8')) as { recs: Rec[] };
// 山札が少ない局面(山札切れに絡む)は、教師の L1 の続きが不自然なので、deckMin 枚未満は除く
const recs = data.recs.filter((r) => !r.deck || (r.deck[0] >= deckMin && r.deck[1] >= deckMin));
const games = new Set(recs.map((r) => r.seed)).size;
const pct = (x: number, d = 1) => (x * 100).toFixed(d);

// 判断の種類
const kindOf = (r: Rec): string => {
  if (r.why === 'turnAction') {
    if (r.chosen.startsWith('マナに置く') || r.chosen.startsWith('マナに置かない')) return 'マナチャージ';
    if (r.chosen.startsWith('出す')) return '召喚・詠唱';
    if (r.chosen.startsWith('攻撃')) return r.chosen.endsWith('プレイヤー') ? '攻撃(プレイヤー)' : '攻撃(クリーチャー)';
    return 'ターン終了・メイン終了';
  }
  return `効果の選択:${r.why}`;
};
const band = (t: number) => (t <= 4 ? '1-4' : t <= 8 ? '5-8' : t <= 12 ? '9-12' : '13+');

console.log(`試合 ${games} / 判断 ${recs.length}(1試合あたり ${(recs.length / games).toFixed(1)})`);
const mean = recs.reduce((s, r) => s + r.regret, 0) / recs.length;
console.log(`全体の平均損失 ${pct(mean, 2)}pt / しきい値 ${pct(th, 0)}pt 以上の悪手 ${recs.filter((r) => r.regret >= th).length} 件(1試合あたり ${(recs.filter((r) => r.regret >= th).length / games).toFixed(2)})`);

function table(title: string, key: (r: Rec) => string) {
  const m = new Map<string, { n: number; bad: number; reg: number; badReg: number }>();
  for (const r of recs) {
    const k = key(r);
    const e = m.get(k) ?? { n: 0, bad: 0, reg: 0, badReg: 0 };
    e.n++;
    e.reg += r.regret;
    if (r.regret >= th) {
      e.bad++;
      e.badReg += r.regret;
    }
    m.set(k, e);
  }
  console.log(`\n■ ${title}`);
  console.log('  種類'.padEnd(34) + '判断数   悪手   悪手率  平均損失  悪手による損失の寄与(試合あたり pt)');
  for (const [k, e] of [...m].sort((a, b) => b[1].badReg - a[1].badReg)) {
    console.log(`  ${k.padEnd(30)} ${String(e.n).padStart(6)} ${String(e.bad).padStart(6)} ${pct(e.bad / e.n).padStart(6)}% ${pct(e.reg / e.n, 2).padStart(7)}pt  ${((e.badReg / games) * 100).toFixed(2)}`);
  }
}
table('判断の種類', kindOf);
table('ターン帯', (r) => band(r.turn));

// 代表例: 損失の大きい順
const ex = Number(exArg);
console.log(`\n■ 損失の大きい手(上位 ${ex} 件)`);
for (const r of recs.filter((x) => x.regret >= th).sort((a, b) => b.regret - a.regret).slice(0, ex)) {
  console.log(`\n[${kindOf(r)}] T${r.turn} 損失 ${pct(r.regret)}pt(選んだ ${pct(r.qChosen)}% → 最善 ${pct(r.qBest)}%)  ${r.decks.join(' vs ')}`);
  console.log(`  局面: ${r.state}`);
  console.log(`  選んだ: ${r.chosen}`);
  console.log(`  最善:   ${r.best}`);
}
