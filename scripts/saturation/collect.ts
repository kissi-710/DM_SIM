// 1 試合ごとの結果を JSONL に集める(1 プロセス。並列は run.sh が --shard で子プロセスを並べる)。
//   npx tsx scripts/saturation/collect.ts --a mcts:40 --b rule --games 400 --first duplicate --out out.jsonl [--shard 0/4]
//   --a/--b: rule | random | mcts:<反復回数>   --pairs a/b,c/d(既定: 4 デッキの全順列 16 組)   --games: 組ごと
//   --shard i/K: 試合番号を chunk 単位で K 分割して i 番目だけ(コアや別マシンに分散する用。全 shard を合わせると全試合)
// 出力 1 行: {"p":"maruru/zardy","i":試合番号,"s":A の得点(勝ち 1・引分 0.5)}。席は番号で決まる(batch.ts と同じ: 偶数番号は A が先攻)
import { appendFileSync, writeFileSync } from 'node:fs';
import type { AgentSpec } from '../../src/ai';
import { CARD_DB, deckCards } from '../../src/cards';
import { loadRegistry } from '../../src/engine/registry';
import { runMatches, type FirstMode } from '../../src/sim/batch';
import { installNativeFromEnv } from '../../src/wasm/installNode';

installNativeFromEnv();
const argv = process.argv.slice(2);
const opt = (k: string, d?: string): string => {
  const i = argv.indexOf('--' + k);
  if (i < 0) {
    if (d === undefined) throw new Error(`--${k} が必要`);
    return d;
  }
  return argv[i + 1];
};
const parseAgent = (s: string): AgentSpec => {
  const [k, v] = s.split(':');
  if (k === 'mcts') return { kind: 'mcts', iterations: Number(v) };
  if (k === 'rule' || k === 'random') return { kind: k };
  throw new Error('未知のAI: ' + s);
};

const DECKS = ['maruru', 'zardy', 'lost-maruru', 'interstellar-maruru'];
const pairs = opt('pairs', DECKS.flatMap((a) => DECKS.map((b) => `${a}/${b}`)).join(',')).split(',');
const games = Number(opt('games'));
const seed = Number(opt('seed', '1'));
const first = opt('first', 'duplicate') as FirstMode;
const agentA = parseAgent(opt('a'));
const agentB = parseAgent(opt('b'));
const chunk = Number(opt('chunk', '10')); // 偶数(duplicate のペアを分けない)
const out = opt('out');
const [si, sk] = opt('shard', '0/1').split('/').map(Number);
const reg = loadRegistry(CARD_DB);

writeFileSync(out, '');
const t0 = Date.now();
let done = 0;
for (let from = 0; from < games; from += chunk) {
  for (const p of pairs) {
    if ((from / chunk + pairs.indexOf(p)) % sk !== si) continue;
    const [deckA, deckB] = p.split('/');
    const pSeed = seed * 1000 + pairs.indexOf(p); // 組ごとに別のシード空間
    const lines: string[] = [];
    for (let i = from; i < Math.min(from + chunk, games); i++) {
      const s = runMatches(reg, { deckA: deckCards(deckA), deckB: deckCards(deckB), agentA, agentB, games: 1, seed: pSeed, startIndex: i, first });
      lines.push(JSON.stringify({ p, i, s: s.winsA + s.draws * 0.5 }));
    }
    appendFileSync(out, lines.join('\n') + '\n');
    done += lines.length;
  }
}
console.error(`shard ${si}/${sk}: ${done} 試合 ${((Date.now() - t0) / 1000).toFixed(0)}秒 → ${out}`);
