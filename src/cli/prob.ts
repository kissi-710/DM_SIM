// 確率調査・パターン調査 CLI。
//   npm run prob -- --deck maruru --goal cost7-t4 --trials 500 --maxNodes 3000
//   npm run prob -- --deck maruru --goal mana5-t3 --mode patterns --trials 100 --top-n 5
import { writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { CARD_DB, DECK_PRESETS, deckCards } from '../cards';
import { loadRegistry } from '../engine/registry';
import { formatPatterns, formatProb, patternsToCsv, probToCsv } from '../sim/export';
import { GOAL_PRESETS, describeGoal, type Goal } from '../sim/goal';
import { initialProblems, type PatternGranularity, type PatternResult, type ProbResult, type SolitaireParams } from '../sim/solitaire';
import { runParallel } from './parallel';
import { errorMessage } from '../engine/types';

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
  --jobs <n>         並列数(既定: コア数-1、最大8。1なら直列。結果は並列数によらず同じ)
  --seed <n>         シード(既定 1)
  --maxNodes <n>     探索のノード数上限(0で探索しない。既定 3000)
  --agent <kind>     方針プレイのAI rule / random(既定 rule)
  --must <名前,..>   初手に必ず含める   --exclude <名前,..> 初手に含めない   --top <名前,..> 山札の上を固定
  --gran <g>         ordered / set / cards / choices(パターンの粗さ。既定 ordered)
  --top-n <n>        パターンの表示数(既定 10)
  --out <file>       結果を保存(.json または .csv)`);
  process.exit(0);
}

function fail(msg: string): never {
  console.error('エラー: ' + msg);
  process.exit(1);
}

/** 数値の引数(未指定なら既定値)。数でない・範囲外なら、黙って空の結果を出さずに止める */
function num(name: string, dflt: number, min = 0): number {
  const raw = args[name];
  if (raw === undefined) return dflt;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) fail(`--${name} は ${min} 以上の数で指定してください(指定値: ${raw})`);
  return n;
}

function oneOf<T extends string>(name: string, allowed: readonly T[], dflt: T): T {
  const raw = args[name];
  if (raw === undefined) return dflt;
  if (!(allowed as readonly string[]).includes(raw)) fail(`--${name} は ${allowed.join(' / ')} のどれかを指定してください(指定値: ${raw})`);
  return raw as T;
}

const deckId = args.deck ?? 'maruru';
if (!DECK_PRESETS.some((d) => d.id === deckId)) fail(`--deck は ${DECK_PRESETS.map((d) => d.id).join(' / ')} のどれかを指定してください(指定値: ${deckId})`);
let goal: Goal;
const g = args.goal ?? 'cost7-t4';
const preset = GOAL_PRESETS.find((x) => x.id === g);
if (preset) goal = preset.goal;
else {
  try {
    goal = JSON.parse(readFileSync(g, 'utf8')) as Goal;
  } catch (e) {
    fail(`--goal はプリセット(${GOAL_PRESETS.map((x) => x.id).join(' / ')})か、読める JSON ファイルを指定してください(${g}: ${errorMessage(e)})`);
  }
}

const list = (s?: string) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
const params: SolitaireParams = {
  deck: deckCards(deckId),
  first: Number(oneOf('first', ['0', '1'], '0')) as 0 | 1,
  goal,
  trials: num('trials', 300, 1),
  seed: num('seed', 1, -Infinity),
  maxNodes: num('maxNodes', 3000),
  agent: { kind: oneOf('agent', ['rule', 'random'], 'rule') },
  initial: { mustHand: list(args.must), mustNotHand: list(args.exclude), topFixed: list(args.top) },
};

// 名前の打ち間違い・デッキに無いカードは、無視すると条件なしの結果が出るので、実行前に止める
const problems = initialProblems(loadRegistry(CARD_DB), params.deck, params.initial);
if (problems.length) fail(['初期条件を確認してください:', ...problems].join('\n  '));

const mode = oneOf('mode', ['prob', 'patterns'], 'prob');
const gran = oneOf('gran', ['ordered', 'set', 'cards', 'choices'], 'ordered') as PatternGranularity;
const topN = num('top-n', 10, 1);
const jobs = args.jobs ? Math.floor(num('jobs', 1, 1)) : undefined;
console.log(`目標: ${describeGoal(goal)}`);
console.log(`デッキ: ${deckId} / ${params.first === 0 ? '先攻' : '後攻'}`);

if (mode === 'patterns') {
  const opts = { granularity: gran, maxHistoriesPerTrial: 24 };
  const r = (await runParallel({ type: 'patterns', params, opts }, jobs)) as PatternResult;
  console.log(formatPatterns(r, topN));
  if (args.out) writeFileSync(args.out, args.out.endsWith('.csv') ? patternsToCsv(r) : JSON.stringify(r, null, 2));
} else {
  const r = (await runParallel({ type: 'prob', params }, jobs)) as ProbResult;
  console.log(formatProb(r));
  if (args.out) writeFileSync(args.out, args.out.endsWith('.csv') ? probToCsv(r) : JSON.stringify(r, null, 2));
}
