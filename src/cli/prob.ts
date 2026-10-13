// 確率調査・パターン調査 CLI。
//   npm run prob -- --deck maruru --goal cost7-t4 --trials 500 --maxNodes 3000
//   npm run prob -- --deck maruru --goal mana5-t3 --mode patterns --trials 100 --top 5
import { writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { CARD_DB, DECK_PRESETS, deckCards } from '../cards';
import { formatPatterns, formatProb, patternsToCsv, probToCsv } from '../sim/export';
import { GOAL_PRESETS, describeGoal, type Goal } from '../sim/goal';
import { runPatterns, runProbability, type PatternGranularity, type SolitaireParams } from '../sim/solitaire';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[a.slice(2)] = v;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`使い方: npm run prob -- [オプション]
  --deck <id>        ${DECK_PRESETS.map((d) => d.id).join(' / ')}(既定 maruru)
  --goal <id|file>   プリセット(${GOAL_PRESETS.map((g) => g.id).join(' / ')})または目標のJSONファイル
  --mode <m>         prob(確率調査・既定)/ patterns(パターン調査)
  --first <0|1>      0=先攻 1=後攻(既定 0)
  --trials <n>       試行回数(既定 300)
  --seed <n>         シード(既定 1)
  --maxNodes <n>     探索のノード数上限(0で探索しない。既定 3000)
  --agent <kind>     方針プレイのAI rule / random(既定 rule)
  --must <名前,..>   初手に必ず含める   --exclude <名前,..> 初手に含めない   --top <名前,..> 山札の上を固定
  --gran <g>         ordered / set / cards / choices(パターンの粗さ。既定 ordered)
  --top-n <n>        パターンの表示数(既定 10)
  --out <file>       結果を保存(.json または .csv)`);
  process.exit(0);
}

const deckId = args.deck ?? 'maruru';
let goal: Goal;
const g = args.goal ?? 'cost7-t4';
const preset = GOAL_PRESETS.find((x) => x.id === g);
if (preset) goal = preset.goal;
else goal = JSON.parse(readFileSync(g, 'utf8')) as Goal;

const list = (s?: string) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
const params: SolitaireParams = {
  deck: deckCards(deckId),
  first: (Number(args.first ?? 0) === 1 ? 1 : 0) as 0 | 1,
  goal,
  trials: Number(args.trials ?? 300),
  seed: Number(args.seed ?? 1),
  maxNodes: Number(args.maxNodes ?? 3000),
  agent: { kind: (args.agent as any) ?? 'rule' },
  initial: { mustHand: list(args.must), mustNotHand: list(args.exclude), topFixed: list(args.top) },
};

console.log(`目標: ${describeGoal(goal)}`);
console.log(`デッキ: ${deckId} / ${params.first === 0 ? '先攻' : '後攻'}`);

if ((args.mode ?? 'prob') === 'patterns') {
  const r = runPatterns(CARD_DB, params, { granularity: (args.gran as PatternGranularity) ?? 'ordered' });
  console.log(formatPatterns(r, Number(args['top-n'] ?? 10)));
  if (args.out) writeFileSync(args.out, args.out.endsWith('.csv') ? patternsToCsv(r) : JSON.stringify(r, null, 2));
} else {
  const r = runProbability(CARD_DB, params);
  console.log(formatProb(r));
  if (args.out) writeFileSync(args.out, args.out.endsWith('.csv') ? probToCsv(r) : JSON.stringify(r, null, 2));
}
