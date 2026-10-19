// AI の強さの測定 CLI(モンテカルロ探索 対 基準のAI)。
//   npm run aibench -- --games 100 --iterations 120 --seed 1
//   npm run aibench -- --prior 0 --w hand=1.2,mana=1.4 --horizon 3
import type { AiTuning } from '../ai';
import type { EvalWeights } from '../ai/eval';
import { benchAi, formatBench } from './benchCore';
import { parseArgs } from './args';

const args = parseArgs(process.argv.slice(2)).opts;
if (args.help) {
  console.log(`使い方: npm run aibench -- [オプション]
  --games <n>       デッキの組ごとの試合数(既定 100。組は maruru/zardy の4通り)
  --iterations <n>  モンテカルロ探索の反復回数(既定 120)
  --seed <n>        シード(既定 1)
  --horizon <n>     何ターン先で打ち切るか(既定 3)
  --prior <x>       L1 の手への上乗せ(既定 0.08)
  --w <k=v,...>     評価関数の重み(例 hand=1.2,mana=1.4。キー: creature powerDiv blocker speedAttacker stack shield hand mana handCost deckOut scale)
  --opponent <k>    基準のAI rule / mcts(既定 rule)
  --jobs <n>        並列数
  --json            JSON で出力`);
  process.exit(0);
}

const num = (name: string, d: number): number => {
  const raw = args[name];
  if (raw === undefined) return d;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.error(`エラー: --${name} は数で指定してください(指定値: ${raw})`);
    process.exit(1);
  }
  return n;
};

const tuning: AiTuning = {};
if (args.horizon !== undefined) tuning.horizonTurns = num('horizon', 3);
if (args.prior !== undefined) tuning.priorBonus = num('prior', 0.08);
if (args.w) {
  const w: Record<string, number> = {};
  for (const kv of args.w.split(',')) {
    const [k, v] = kv.split('=');
    if (!k || !Number.isFinite(Number(v))) {
      console.error(`エラー: --w は k=v,k=v の形で指定してください(指定値: ${args.w})`);
      process.exit(1);
    }
    w[k] = Number(v);
  }
  tuning.weights = w as Partial<EvalWeights>;
}

const r = await benchAi({
  games: num('games', 100),
  seed: num('seed', 1),
  iterations: num('iterations', 120),
  tuning,
  opponent: args.opponent === 'mcts' ? { kind: 'mcts', iterations: num('iterations', 120) } : { kind: 'rule' },
  jobs: args.jobs ? num('jobs', 1) : undefined,
});
if (args.json) console.log(JSON.stringify(r, null, 2));
else {
  console.log(`■ モンテカルロ(反復${num('iterations', 120)}、${JSON.stringify(tuning)}) 対 ${args.opponent ?? 'rule'} seed=${num('seed', 1)}`);
  console.log(formatBench(r));
}
