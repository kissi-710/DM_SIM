// AI同士のバッチ対戦 CLI。
//   npm run batch -- --deckA maruru --deckB zardy --games 1000 --seed 1 --agentA rule --agentB random
import { DECK_PRESETS, deckCards } from '../cards';
import type { AgentKind } from '../ai';
import type { InfoPolicy, InfoPreset } from '../engine/view';
import { formatStats, type FirstMode, type MatchStats } from '../sim/batch';
import type { CardStrength } from '../sim/strength';
import { runParallel } from './parallel';

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

function policyOf(preset: string | undefined): InfoPolicy | undefined {
  if (!preset) return undefined;
  const p = preset as InfoPreset;
  return {
    preset: p,
    knowOpponentDecklist: true,
    reveal: p === 'partial' ? { opponentHandCount: 2, opponentHandKinds: ['shieldTrigger', 'blocker'] } : undefined,
  };
}

function usage(): never {
  console.log(`使い方: npm run batch -- [オプション]
  --deckA <id>     デッキA(${DECK_PRESETS.map((d) => d.id).join(' / ')})  既定 maruru
  --deckB <id>     デッキB  既定 zardy
  --agentA <kind>  random / rule / mcts  既定 random
  --agentB <kind>  既定 random
  --infoA <p>      Aの情報条件 fair / partial / hypothesis / full(rule・mcts のみ)
  --infoB <p>      Bの情報条件
  --games <n>      試合数  既定 1000
  --jobs <n>       並列数  既定: コア数-1(最大8)。1なら直列。結果は並列数によらず同じ
  --seed <n>       シード  既定 1
  --first <m>      fixed / alternate / random  既定 alternate
  --iterations <n> mcts の反復回数(これだけを指定すると再現できる。既定 120)
  --ms <n>         mcts の最大思考時間(指定すると実行環境の速さ・負荷で結果が変わる)
  --strength       カード単体の強さ(1枚を入れ替えた時の勝率差)を測る(デッキA vs デッキB、ルールベース同士)
  --json           JSONで出力`);
  process.exit(0);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) usage();

function fail(msg: string): never {
  console.error('エラー: ' + msg);
  process.exit(1);
}

/** 数値の引数(未指定なら既定値)。数でない・範囲外なら、黙って空の結果を出さずに止める */
function num(name: string, dflt: number | undefined, min = 0): number | undefined {
  const raw = args[name];
  if (raw === undefined) return dflt;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) fail(`--${name} は ${min} 以上の数で指定してください(指定値: ${raw})`);
  return n;
}

function oneOf<T extends string>(name: string, allowed: readonly T[], dflt: T | undefined): T | undefined {
  const raw = args[name];
  if (raw === undefined) return dflt;
  if (!(allowed as readonly string[]).includes(raw)) fail(`--${name} は ${allowed.join(' / ')} のどれかを指定してください(指定値: ${raw})`);
  return raw as T;
}

const deckIds = DECK_PRESETS.map((d) => d.id);
const jobsRaw = num('jobs', undefined, 1);
const jobs = jobsRaw === undefined ? undefined : Math.floor(jobsRaw);
const deckA = oneOf('deckA', deckIds, 'maruru')!;
const deckB = oneOf('deckB', deckIds, 'zardy')!;
const games = num('games', 1000, 1)!;
const seed = num('seed', 1, -Infinity)!;
const kindA = oneOf('agentA', ['random', 'rule', 'mcts'] as const, 'random')! as AgentKind;
const kindB = oneOf('agentB', ['random', 'rule', 'mcts'] as const, 'random')! as AgentKind;
const infos = ['fair', 'partial', 'hypothesis', 'full'] as const;
const infoA = oneOf('infoA', infos, undefined);
const infoB = oneOf('infoB', infos, undefined);
const first = oneOf('first', ['fixed', 'alternate', 'random'] as const, 'alternate')! as FirstMode;
const iterations = num('iterations', undefined, 1);
const ms = num('ms', undefined, 1);

if (args.strength) {
  const res = (await runParallel(
    { type: 'strength', deck: deckCards(deckA), opponent: deckCards(deckB), agent: { kind: 'rule' }, games, seed },
    jobs,
  )) as CardStrength[];
  console.log(`■ カード単体の強さ: ${deckA} vs ${deckB}(ルールベース同士・各${games}試合)`);
  for (const r of res) {
    console.log(`  ${(r.delta * 100).toFixed(1).padStart(6)}pt  ${r.name} ×${r.copies}  (95%信頼区間 ${(r.ci95[0] * 100).toFixed(1)} 〜 ${(r.ci95[1] * 100).toFixed(1)})`);
  }
  process.exit(0);
}

const [stats] = (await runParallel(
  {
    type: 'batch',
    opts: [
      {
        deckA: deckCards(deckA),
        deckB: deckCards(deckB),
        agentA: { kind: kindA, policy: policyOf(infoA), iterations, ms },
        agentB: { kind: kindB, policy: policyOf(infoB), iterations, ms },
        games,
        seed,
        first,
      },
    ],
  },
  jobs,
)) as MatchStats[];

if (args.json) console.log(JSON.stringify(stats, null, 2));
else console.log(formatStats(`${deckA}(${kindA}) vs ${deckB}(${kindB}) seed=${seed}`, stats));
