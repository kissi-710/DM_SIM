// AI同士のバッチ対戦 CLI。
//   npm run batch -- --deckA maruru --deckB zardy --games 1000 --seed 1 --agentA rule --agentB random
import { CARD_DB, DECK_PRESETS, deckCards } from '../cards';
import type { AgentKind } from '../ai';
import type { InfoPolicy, InfoPreset } from '../engine/view';
import { formatStats, runMatches, type FirstMode } from '../sim/batch';
import { measureCardStrength } from '../sim/strength';

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
  --seed <n>       シード  既定 1
  --first <m>      fixed / alternate / random  既定 alternate
  --iterations <n> mcts の反復回数  --ms <n> mcts の時間上限
  --strength       カード単体の強さ(1枚を入れ替えた時の勝率差)を測る(デッキA vs デッキB、ルールベース同士)
  --json           JSONで出力`);
  process.exit(0);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) usage();
const deckA = args.deckA ?? 'maruru';
const deckB = args.deckB ?? 'zardy';
const games = Number(args.games ?? 1000);
const seed = Number(args.seed ?? 1);
const kindA = (args.agentA ?? 'random') as AgentKind;
const kindB = (args.agentB ?? 'random') as AgentKind;

if (args.strength) {
  const res = measureCardStrength(CARD_DB, {
    deck: deckCards(deckA),
    opponent: deckCards(deckB),
    agent: { kind: 'rule' },
    games,
    seed,
  });
  console.log(`■ カード単体の強さ: ${deckA} vs ${deckB}(ルールベース同士・各${games}試合)`);
  for (const r of res) {
    console.log(`  ${(r.delta * 100).toFixed(1).padStart(6)}pt  ${r.name} ×${r.copies}  (95%信頼区間 ${(r.ci95[0] * 100).toFixed(1)} 〜 ${(r.ci95[1] * 100).toFixed(1)})`);
  }
  process.exit(0);
}

const stats = runMatches(CARD_DB, {
  deckA: deckCards(deckA),
  deckB: deckCards(deckB),
  agentA: { kind: kindA, policy: policyOf(args.infoA), iterations: args.iterations ? Number(args.iterations) : undefined, ms: args.ms ? Number(args.ms) : undefined },
  agentB: { kind: kindB, policy: policyOf(args.infoB), iterations: args.iterations ? Number(args.iterations) : undefined, ms: args.ms ? Number(args.ms) : undefined },
  games,
  seed,
  first: (args.first ?? 'alternate') as FirstMode,
});

if (args.json) console.log(JSON.stringify(stats, null, 2));
else console.log(formatStats(`${deckA}(${kindA}) vs ${deckB}(${kindB}) seed=${seed}`, stats));
