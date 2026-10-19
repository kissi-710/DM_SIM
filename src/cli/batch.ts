// AI同士のバッチ対戦 CLI。
//   npm run batch -- --deckA maruru --deckB zardy --games 1000 --seed 1 --agentA rule --agentB random
import { DECK_PRESETS, CARD_DB, deckCards } from '../cards';
import { checkHypotheses, hypothesisProblems, makePolicy } from '../ai/policy';
import type { AgentKind } from '../ai';
import { formatStats, type FirstMode, type MatchStats } from '../sim/batch';
import { mergeMatches } from '../sim/jobs';
import type { CardStrength } from '../sim/strength';
import { runParallel } from './parallel';
import { parseArgs } from './args';

function usage(): never {
  console.log(`使い方: npm run batch -- [オプション]
  --deckA <id>     デッキA(${DECK_PRESETS.map((d) => d.id).join(' / ')})  既定 maruru
  --deckB <id>     デッキB  既定 zardy
  --agentA <kind>  random / rule / mcts  既定 random
  --agentB <kind>  既定 random
  --infoA <p>      Aの情報条件 fair / partial / hypothesis / full(rule・mcts のみ)
  --infoB <p>      Bの情報条件
  --hypoA <名前,..> 決め打ち(--infoA hypothesis)の仮説: Aが「相手(B)の手札にある」と決め打つカード(カード名かID)
  --hypoB <名前,..> Bの仮説(Aの手札にあると決め打つカード)
  --games <n>      試合数  既定 1000
  --jobs <n>       並列数  既定: コア数-1(最大8)。1なら直列。結果は並列数によらず同じ
  --seed <n>       シード  既定 1
  --first <m>      fixed / alternate / random / duplicate  既定 alternate(duplicate = 同じシードで席を入れ替えて2試合。games は偶数)
  --precision <pt> 勝率の95%区間の半幅(%)がこの値以下になるまで、--games ごとに続ける(最大 --maxGames 試合)。差が大きい時は早く終わる
  --iterations <n> mcts の反復回数(これだけを指定すると再現できる。既定 120)
  --ms <n>         mcts の最大思考時間(指定すると実行環境の速さ・負荷で結果が変わる)
  --strength       カード単体の強さを測る(デッキA vs デッキB、ルールベース同士)。全コピーを同コスト・文明の無能力カードに替えた時の勝率差(推奨)と、1枚だけを dummy に替えた時(旧方式)を並べる。変種は種類数×2 通り
  --json           JSONで出力`);
  process.exit(0);
}

const args = parseArgs(process.argv.slice(2)).opts;
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
const first = oneOf('first', ['fixed', 'alternate', 'random', 'duplicate'] as const, 'alternate')! as FirstMode;
const precision = num('precision', undefined, 0.01);
const maxGames = Math.floor(num('maxGames', 20000, 1)!);
if (first === 'duplicate' && games % 2 !== 0) fail('--first duplicate の時、--games は偶数にしてください');
const iterations = num('iterations', undefined, 1);
const ms = num('ms', undefined, 1);

/** 情報条件を作る。決め打ちは、仮説(--hypoA / --hypoB)を相手のデッキと照らして検査する */
function policyFor(info: (typeof infos)[number] | undefined, hypo: string | undefined, label: string, opponentDeck: string[]) {
  if (!info) {
    if (hypo) fail(`--hypo${label} は、--info${label} hypothesis と一緒に指定してください`);
    return undefined;
  }
  if (info !== 'hypothesis') {
    if (hypo) fail(`--hypo${label} は、--info${label} hypothesis の時だけ使えます(指定: ${info})`);
    return makePolicy(info);
  }
  const c = checkHypotheses(CARD_DB, (hypo ?? '').split(/[,、]/), opponentDeck);
  const problems = hypothesisProblems(c, `--hypo${label}`);
  if (problems.length) fail(problems.join('\n  '));
  return makePolicy(info, { hypotheses: c.ids });
}
const policyA = policyFor(infoA, args.hypoA, 'A', deckCards(deckB));
const policyB = policyFor(infoB, args.hypoB, 'B', deckCards(deckA));

if (args.strength) {
  const res = (await runParallel(
    { type: 'strength', deck: deckCards(deckA), opponent: deckCards(deckB), agent: { kind: 'rule' }, games, seed },
    jobs,
  )) as CardStrength[];
  const pt = (x: number, w = 6) => (x * 100).toFixed(1).padStart(w);
  console.log(`■ カード単体の強さ: ${deckA} vs ${deckB}(ルールベース同士・各${games}試合)`);
  console.log('  全枚数: そのカードの全コピーを、同じコスト・文明の無能力クリーチャーに替えた時の勝率差(推奨。並びもこの順)');
  console.log('  1枚あたり: 全枚数の差 ÷ 枚数 / 1枚→dummy: 最初の1枚だけを何もしない dummy に替えた時(旧方式。枚数の少ないカードが大きく出る)');
  console.log(`  ${'全枚数'.padStart(8)} ${'1枚あたり'.padStart(8)} ${'1枚→dummy'.padStart(8)}`);
  for (const r of res) {
    const a = r.all;
    console.log(
      `  ${pt(a.delta, 6)}pt ${pt(a.perCopy, 6)}pt ${pt(r.one.delta, 6)}pt  ${r.name} ×${r.copies}  ` +
        `(全枚数: 95%信頼区間 ${pt(a.ci95[0], 0)} 〜 ${pt(a.ci95[1], 0)}、同時比較 ${pt(a.ciFamily[0], 0)} 〜 ${pt(a.ciFamily[1], 0)})`,
    );
  }
  process.exit(0);
}

/** 試合の範囲 [start, start + n) を実行する(範囲を分けても、同じ試合は同じシード) */
async function runRange(start: number, n: number): Promise<MatchStats> {
  const [s] = (await runParallel(
    {
      type: 'batch',
      opts: [
        {
          deckA: deckCards(deckA),
          deckB: deckCards(deckB),
          agentA: { kind: kindA, policy: policyA, iterations, ms },
          agentB: { kind: kindB, policy: policyB, iterations, ms },
          games: n,
          seed,
          first,
          startIndex: start,
        },
      ],
    },
    jobs,
  )) as MatchStats[];
  return s;
}

// --precision: 区間が目標より広い間、games 試合ずつ足す(シードは通し番号で決まるので、一括で実行した結果と一致する)
let stats = await runRange(0, games);
if (precision !== undefined) {
  let done = games;
  const parts: MatchStats[] = [stats];
  while ((stats.ci95A[1] - stats.ci95A[0]) * 50 > precision && done < maxGames) {
    const n = Math.min(games, maxGames - done);
    parts.push(await runRange(done, n % 2 === 0 || first !== 'duplicate' ? n : n - 1));
    done += n;
    stats = mergeMatches(parts);
  }
}

if (args.json) console.log(JSON.stringify(stats, null, 2));
else console.log(formatStats(`${deckA}(${kindA}) vs ${deckB}(${kindB}) seed=${seed}`, stats));
