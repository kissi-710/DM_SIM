// L1(ルールベース)の調整値の自己対戦による調整(座標降下)。docs/ai-quality-plan.md §7。
//   npx tsx src/cli/tuneL1.ts --games 300 --rounds 2
// 候補(1つの値を変えた L1)を、現在の L1 と、複製対局・全デッキの組で対戦させ、有意に勝ち越したものを採る。
// ラウンドごとに別のシードで測る(特定の試合の並びに合わせ込まないため)。
import { DECK_PRESETS, deckCards } from '../cards';
import type { AgentSpec } from '../ai';
import { L1_DEFAULT, type L1Params } from '../ai/l1params';
import { wilson } from '../sim/stats';
import type { MatchStats } from '../sim/batch';
import { runParallel } from './parallel';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}
const a = parseArgs(process.argv.slice(2));
const games = Number(a.games ?? 300); // デッキの組ごと(偶数)
const rounds = Number(a.rounds ?? 2);
const seed0 = Number(a.seed ?? 5000);
const sigma = Number(a.sigma ?? 1.5); // 採用に必要な勝ち越しの大きさ(標準誤差の何倍か)
const only = a.only ? a.only.split(',') : null;
const jobs = a.jobs ? Number(a.jobs) : undefined;
const pairs: [string, string][] = [];
for (const x of DECK_PRESETS) for (const y of DECK_PRESETS) pairs.push([x.id, y.id]);

/** A(候補)対 B(基準)の勝率(引分は 0.5) */
async function rate(cand: Partial<L1Params>, base: Partial<L1Params>, seed: number): Promise<{ rate: number; n: number }> {
  const A: AgentSpec = { kind: 'rule', l1: cand };
  const B: AgentSpec = { kind: 'rule', l1: base };
  const stats = (await runParallel(
    { type: 'batch', opts: pairs.map(([x, y]) => ({ deckA: deckCards(x), deckB: deckCards(y), agentA: A, agentB: B, games, seed, first: 'duplicate' as const })) },
    jobs,
  )) as MatchStats[];
  let w = 0;
  let n = 0;
  for (const s of stats) {
    w += s.winsA + s.draws * 0.5;
    n += s.games;
  }
  return { rate: w / n, n };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const INT_KEYS = new Set<keyof L1Params>(['skipManaFrom', 'keepBlockerShield']);
function candidates(k: keyof L1Params, v: number): number[] {
  if (typeof v !== 'number') return [];
  if (INT_KEYS.has(k)) return [v - 1, v + 1].filter((x) => x >= 0);
  const step = Math.max(Math.abs(v) * 0.4, 0.3);
  return [r3(v - step), r3(v + step)];
}

let cur: Partial<L1Params> = a.start ? JSON.parse(a.start) : {};
const full = (p: Partial<L1Params>): L1Params => ({ ...L1_DEFAULT, ...p });
const KEYS = (Object.keys(L1_DEFAULT) as (keyof L1Params)[]).filter((k) => typeof L1_DEFAULT[k] === 'number' && (!only || only.includes(k)));
console.log('開始', JSON.stringify(cur), `games=${games}×${pairs.length}組(複製) rounds=${rounds} 採用=${sigma}σ`);
for (let r = 0; r < rounds; r++) {
  const seed = seed0 + r * 101;
  for (const k of KEYS) {
    const v0 = full(cur)[k] as number;
    let pick: { v: number; rate: number } | null = null;
    for (const v of candidates(k, v0)) {
      const { rate: x, n } = await rate({ ...cur, [k]: v }, cur, seed);
      const se = Math.sqrt(0.25 / n);
      console.log(`  r${r + 1} ${k}=${v}: ${(x * 100).toFixed(1)}%`);
      if (x > 0.5 + sigma * se && (!pick || x > pick.rate)) pick = { v, rate: x };
    }
    if (pick) {
      cur = { ...cur, [k]: pick.v };
      console.log(`  → ${k} を ${pick.v} に更新(${(pick.rate * 100).toFixed(1)}%)`);
    }
  }
  console.log(`ラウンド${r + 1} 終了`, JSON.stringify(cur));
}
// 確認: 既定に対する勝率(別のシード)
const fin = await rate(cur, {}, seed0 + 9999);
const ci = wilson(Math.round(fin.rate * fin.n), fin.n);
console.log('結果', JSON.stringify(cur));
console.log(`既定に対して: ${(fin.rate * 100).toFixed(1)}%(${fin.n}試合、95%区間 ${(ci[0] * 100).toFixed(1)}〜${(ci[1] * 100).toFixed(1)}%)`);
