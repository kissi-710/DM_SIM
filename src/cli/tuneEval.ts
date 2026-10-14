// 評価関数の重みの自己対戦による調整(座標降下)。モンテカルロ探索(上乗せなし)の対ルールベース勝率を最大にする。
//   npm run tune-eval -- --games 100 --rounds 2 --start mana=2.5
// 各ラウンドは別のシードで測る(特定の試合の並びに合わせ込まないため)。同じラウンド内では全候補を同じシードで比べる。
import { DEFAULT_WEIGHTS, type EvalWeights } from '../ai/eval';
import { benchAi } from './benchCore';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[k] = v;
    }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const games = Number(args.games ?? 100);
const rounds = Number(args.rounds ?? 2);
const iterations = Number(args.iterations ?? 120);
const margin = Number(args.margin ?? 0.01);
const seed0 = Number(args.seed ?? 1000);
const only = args.only ? args.only.split(',') : null;

let w: EvalWeights = { ...DEFAULT_WEIGHTS };
if (args.start) for (const kv of args.start.split(',')) w = { ...w, [kv.split('=')[0]]: Number(kv.split('=')[1]) };

const KEYS = (['mana', 'hand', 'handCost', 'creature', 'powerDiv', 'shield', 'blocker', 'speedAttacker', 'stack', 'deckOut', 'scale'] as (keyof EvalWeights)[]).filter(
  (k) => !only || only.includes(k),
);
const round2 = (x: number) => Math.round(x * 1000) / 1000;
const evalW = async (ww: EvalWeights, seed: number) => (await benchAi({ games, seed, iterations, tuning: { priorBonus: 0, weights: ww } })).rate;

console.log('開始', JSON.stringify(w), `games=${games}×4 rounds=${rounds}`);
for (let r = 0; r < rounds; r++) {
  const seed = seed0 + r * 17;
  let best = await evalW(w, seed);
  console.log(`ラウンド${r + 1} seed=${seed} 現在 ${(best * 100).toFixed(1)}%`);
  for (const k of KEYS) {
    const cur = w[k];
    const cands = [round2(cur * 0.7), round2(cur * 1.4)];
    let pick: { v: number; rate: number } | null = null;
    for (const v of cands) {
      const rate = await evalW({ ...w, [k]: v }, seed);
      console.log(`  ${k}=${v}: ${(rate * 100).toFixed(1)}%`);
      if (rate > best + margin && (!pick || rate > pick.rate)) pick = { v, rate };
    }
    if (pick) {
      w = { ...w, [k]: pick.v };
      best = pick.rate;
      console.log(`  → ${k} を ${pick.v} に更新(${(best * 100).toFixed(1)}%)`);
    }
  }
  console.log('ラウンド終了', JSON.stringify(w));
}
console.log('結果', JSON.stringify(w));
