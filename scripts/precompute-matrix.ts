// 全デッキの全組み合わせ(席を入れ替えて集約した組)の勝率を、探索 AI 同士(同じ反復回数)の複製対局で事前に計算する。
//   npx tsx scripts/precompute-matrix.ts [--iter 80] [--target 0.02] [--min-blocks 2] [--max-blocks 40] [--jobs 12] [--block 200]
//   npx tsx scripts/precompute-matrix.ts export   状態(docs/data/matrix-mcts<iter>/state.json)を画面用の src/ui/data/matrix.json に書き出す
// 200 試合のブロックを、95% 区間の半幅が --target 以下になるまで組ごとに足す(勝率が 0 や 1 に近い組は早く終わる)。
// ブロック番号からシードが決まるので、後から --target を下げて足しても、別マシンで分けても、同じ試合が同じ結果になる。
// 状態はウェーブ(最大 --wave 組)ごとに保存する。途中で止めても、続きから再開できる。
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { DECK_PRESETS, deckCards } from '../src/cards';
import { runParallel } from '../src/cli/parallel';
import type { MatchOpts, MatchStats } from '../src/sim/batch';
import { addAcc, emptyAcc, estimateRate, type RateAcc } from '../src/sim/stats';

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'run';
const opt = (k: string, d: string) => {
  const i = argv.indexOf('--' + k);
  return i < 0 ? d : argv[i + 1];
};
const ITER = Number(opt('iter', '80'));
const TARGET = Number(opt('target', '0.02'));
const MIN_BLOCKS = Number(opt('min-blocks', '2'));
const MAX_BLOCKS = Number(opt('max-blocks', '40'));
const JOBS = Number(opt('jobs', '12'));
const BLOCK = Number(opt('block', '200')); // 偶数(複製対局のペアを割らない)
const WAVE = Number(opt('wave', '96'));
const DIR = `docs/data/matrix-mcts${ITER}`;
const STATE = `${DIR}/state.json`;
const SEED0 = 800000;

const ids = DECK_PRESETS.map((d) => d.id);
interface Cell {
  a: string;
  b: string;
  blocks: number;
  games: number;
  winsA: number;
  winsB: number;
  draws: number;
  turns: number; // 往復ターン数の合計
  acc: RateAcc;
}
interface State {
  iterations: number;
  block: number;
  seed0: number;
  decks: string[];
  head: string;
  cells: Record<string, Cell>;
}
const key = (a: string, b: string) => `${a}|${b}`;
const half = (c: Cell) => {
  const { ci } = estimateRate(c.acc);
  return (ci[1] - ci[0]) / 2;
};
const git = (c: string) => {
  try {
    return execSync(c, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

function load(): State {
  if (existsSync(STATE)) return JSON.parse(readFileSync(STATE, 'utf8'));
  const cells: Record<string, Cell> = {};
  for (let i = 0; i < ids.length; i++)
    for (let j = i; j < ids.length; j++) cells[key(ids[i], ids[j])] = { a: ids[i], b: ids[j], blocks: 0, games: 0, winsA: 0, winsB: 0, draws: 0, turns: 0, acc: emptyAcc() };
  return { iterations: ITER, block: BLOCK, seed0: SEED0, decks: ids, head: '', cells };
}
function save(s: State) {
  mkdirSync(DIR, { recursive: true });
  s.head = git('git rev-parse HEAD') + (git('git status --porcelain src rust') ? '+dirty' : '');
  writeFileSync(`${STATE}.tmp`, JSON.stringify(s));
  // Windows では rename が(ウイルス対策などで)失敗することがあるので、数回やり直し、だめなら直接書く
  for (let i = 0; ; i++) {
    try {
      renameSync(`${STATE}.tmp`, STATE);
      return;
    } catch {
      if (i >= 5) {
        writeFileSync(STATE, readFileSync(`${STATE}.tmp`));
        return;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
}

async function run() {
  const s = load();
  if (s.block !== BLOCK || s.iterations !== ITER) throw new Error('状態の block/iterations と引数が違う');
  const order = Object.keys(s.cells); // シードは組の並び順で決める(固定)
  const t0 = Date.now();
  let totalGames = 0;
  for (;;) {
    const need = order.filter((k) => {
      const c = s.cells[k];
      return c.blocks < MIN_BLOCKS || (c.blocks < MAX_BLOCKS && half(c) > TARGET);
    });
    if (!need.length) break;
    need.sort((x, y) => s.cells[x].blocks - s.cells[y].blocks);
    for (let w = 0; w < need.length; w += WAVE) {
      const wave = need.slice(w, w + WAVE);
      const agent = { kind: 'mcts' as const, iterations: ITER };
      const opts: MatchOpts[] = wave.map((k) => {
        const c = s.cells[k];
        return { deckA: deckCards(c.a), deckB: deckCards(c.b), agentA: agent, agentB: agent, games: BLOCK, seed: SEED0 + order.indexOf(k), startIndex: c.blocks * BLOCK, first: 'duplicate' };
      });
      const stats = (await runParallel({ type: 'batch', opts }, JOBS)) as MatchStats[];
      wave.forEach((k, i) => {
        const c = s.cells[k];
        const m = stats[i];
        c.blocks++;
        c.games += m.games;
        c.winsA += m.winsA;
        c.winsB += m.winsB;
        c.draws += m.draws;
        c.turns += m.avgTurns * m.games;
        c.acc = addAcc(c.acc, m.acc);
      });
      save(s);
      totalGames += wave.length * BLOCK;
      const left = need.length - Math.min(need.length, w + WAVE);
      console.log(`${new Date().toISOString().slice(11, 19)} ウェーブ ${wave.length} 組 完了(残り ${left} 組 / 今回 ${totalGames} 試合 / ${((Date.now() - t0) / 60000).toFixed(1)} 分)`);
    }
  }
  const hs = Object.values(s.cells).map(half);
  console.log(`全 ${hs.length} 組が終了。最大の半幅 ${(Math.max(...hs) * 100).toFixed(2)}%、平均 ${((hs.reduce((a, b) => a + b, 0) / hs.length) * 100).toFixed(2)}%`);
}

function exportUi() {
  const s = load();
  const cells = Object.values(s.cells).map((c) => {
    const { rate, ci } = estimateRate(c.acc);
    const f = c.acc.nF ? c.acc.sF / c.acc.nF : null; // A が先攻の時の A の勝率
    const b = c.acc.nS ? c.acc.sS / c.acc.nS : null;
    return { a: c.a, b: c.b, games: c.games, rate: +rate.toFixed(4), lo: +ci[0].toFixed(4), hi: +ci[1].toFixed(4), aFirst: f === null ? null : +f.toFixed(4), aSecond: b === null ? null : +b.toFixed(4), draw: +(c.draws / Math.max(1, c.games)).toFixed(4), turns: +(c.turns / Math.max(1, c.games)).toFixed(2) };
  });
  writeFileSync('src/ui/data/matrix.json', JSON.stringify({ iterations: s.iterations, head: s.head, decks: s.decks, cells }));
  console.log('書き出し', cells.length, '組');
}

if (cmd === 'export') exportUi();
else void run();
