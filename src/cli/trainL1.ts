// L1 のカードごとの補正(マナチャージ・召喚の優先度)を、探索(高予算)の手から学習する CLI。docs/ai-quality-plan.md §7。
//   npx tsx src/cli/trainL1.ts --positions 3000 --iterations 1400 --out node_modules/.cache/dm-sim/l1cards.json
// 局面: ルールベース同士の対局から抽出(測る AI によらず同一)。教師: 探索の手。
// 選択肢のうち、教師が選んだカードを当てる条件付きロジット(L1 の現在の点 + カードごとの補正)を、L2 正則化つきで学習する。
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CARD_DB, DECK_PRESETS, deckCards } from '../cards';
import { makeAgent } from '../ai';
import { L1_DEFAULT } from '../ai/l1params';
import { keepScore, playScore } from '../ai/rulebased';
import { legalActions } from '../engine/engine';
import { loadRegistry } from '../engine/registry';
import type { Action, PlayerId } from '../engine/types';
import { FAIR, toPlayerView } from '../engine/view';
import { collectPositions } from '../sim/aiEval';
import { mulberry } from '../sim/playGame';
import { installNativeFromEnv } from '../wasm/installNode';
import { parseArgs } from './args';

const a = parseArgs(process.argv.slice(2)).opts;
const N = Number(a.positions ?? 3000);
const IT = Number(a.iterations ?? 1400);
const SEED = Number(a.seed ?? 9100);
const LAMBDA = Number(a.lambda ?? 0.5);

installNativeFromEnv();
const reg = loadRegistry(CARD_DB);
const pairs = [];
for (const x of DECK_PRESETS) for (const y of DECK_PRESETS) pairs.push({ id: `${x.id}/${y.id}`, a: deckCards(x.id), b: deckCards(y.id) });
const teacher = makeAgent({ kind: 'mcts', iterations: IT });
// 現在の L1 の点(カードごとの補正は除く)
const base = { ...L1_DEFAULT, cardKeep: {}, cardPlay: {} };

interface Choice {
  /** 選択肢ごとの、L1 の点の方向を正に揃えた値(マナチャージ: −keepScore、召喚: playScore) */
  x: number[];
  defs: string[];
  /** 教師が選んだ添字 */
  y: number;
}
const charge: Choice[] = [];
const play: Choice[] = [];

// 局面を多めに集めて、ターン中の行動のうち、マナチャージまたは召喚があるものだけ使う
const positions = collectPositions(reg, pairs, N * 3, SEED);
let used = 0;
for (const p of positions) {
  const s = p.state;
  if (!s.pending || s.pending.why !== 'turnAction') continue;
  const who: PlayerId = s.pending.player;
  const legal = legalActions(s, reg);
  const hasCharge = legal.some((x) => x.type === 'CHARGE_MANA');
  const hasPlay = legal.some((x) => x.type === 'PLAY_CARD');
  if (!hasCharge && !hasPlay) continue;
  if (hasCharge && legal.filter((x) => x.type === 'CHARGE_MANA').length < 2) continue;
  if (!hasCharge && hasPlay && legal.filter((x) => x.type === 'PLAY_CARD').length < 2) continue;
  if (used >= N) break;
  const view = toPlayerView(s, who, FAIR, reg);
  const act = teacher.chooseAction(view, legal, { rand: mulberry(SEED + used), reg }) as Action;
  used++;
  if (hasCharge) {
    if (act.type !== 'CHARGE_MANA') continue;
    const seen = new Map<string, number>();
    const defs: string[] = [];
    const x: number[] = [];
    for (const l of legal) {
      if (l.type !== 'CHARGE_MANA') continue;
      const d = s.cards[l.uid].defId;
      if (seen.has(d)) continue;
      seen.set(d, defs.length);
      defs.push(d);
      x.push(-keepScore(view, reg, l.uid, who, base));
    }
    const y = defs.indexOf(s.cards[act.uid].defId);
    if (defs.length >= 2 && y >= 0) charge.push({ x, defs, y });
  } else {
    if (act.type !== 'PLAY_CARD') continue;
    const best = new Map<string, number>();
    for (const l of legal) {
      if (l.type !== 'PLAY_CARD') continue;
      const d = s.cards[l.uid].defId;
      const v = playScore(view, reg, l, who, base);
      if (!best.has(d) || v > best.get(d)!) best.set(d, v);
    }
    const defs = [...best.keys()];
    const x = defs.map((d) => best.get(d)!);
    const y = defs.indexOf(s.cards[act.uid].defId);
    if (defs.length >= 2 && y >= 0) play.push({ x, defs, y });
  }
}
console.error(`教師の手(反復${IT}): マナチャージの選択 ${charge.length}、召喚の選択 ${play.length}(局面 ${used})`);

/** 条件付きロジット: 効用 = a·x + b[def]。b を L2 正則化。戻り値は [a, b(defId → 値)] */
function fit(data: Choice[]): { a: number; b: Record<string, number> } {
  const defs = [...new Set(data.flatMap((c) => c.defs))];
  const idx = new Map(defs.map((d, i) => [d, i]));
  let A = 1;
  const B = new Float64Array(defs.length);
  for (let it = 0; it < 4000; it++) {
    let gA = 0;
    const gB = new Float64Array(defs.length);
    for (const c of data) {
      const u = c.x.map((x, i) => A * x + B[idx.get(c.defs[i])!]);
      const m = Math.max(...u);
      const e = u.map((v) => Math.exp(v - m));
      const z = e.reduce((p, q) => p + q, 0);
      for (let i = 0; i < u.length; i++) {
        const p = e[i] / z;
        const r = p - (i === c.y ? 1 : 0);
        gA += r * c.x[i];
        gB[idx.get(c.defs[i])!] += r;
      }
    }
    const lr = 0.5 / Math.max(1, data.length / 50);
    A -= lr * gA;
    for (let j = 0; j < defs.length; j++) B[j] -= lr * (gB[j] + LAMBDA * B[j]);
  }
  return { a: A, b: Object.fromEntries(defs.map((d, i) => [d, B[i]])) };
}

/** 一致率: 最大の効用の選択肢が、教師の手と同じか(L1 の点だけ / 補正つき) */
function acc(data: Choice[], a: number, b: Record<string, number>): number {
  let ok = 0;
  for (const c of data) {
    let best = 0;
    let bv = -Infinity;
    c.x.forEach((x, i) => {
      const v = a * x + (b[c.defs[i]] ?? 0);
      if (v > bv) {
        bv = v;
        best = i;
      }
    });
    if (best === c.y) ok++;
  }
  return ok / Math.max(1, data.length);
}

const out: { cardKeep: Record<string, number>; cardPlay: Record<string, number> } = { cardKeep: {}, cardPlay: {} };
for (const [name, data] of [
  ['マナチャージ', charge],
  ['召喚', play],
] as const) {
  const train = data.filter((_, i) => i % 5 !== 4);
  const hold = data.filter((_, i) => i % 5 === 4);
  const f = fit(train);
  console.log(`${name}: 学習 ${train.length} / 保留 ${hold.length}`);
  console.log(`  L1 の点だけ: 保留の一致率 ${(acc(hold, 1, {}) * 100).toFixed(1)}%(学習側 ${(acc(train, 1, {}) * 100).toFixed(1)}%)`);
  console.log(`  カード別の補正あり: 保留の一致率 ${(acc(hold, f.a, f.b) * 100).toFixed(1)}%(学習側 ${(acc(train, f.a, f.b) * 100).toFixed(1)}%)  a=${f.a.toFixed(2)}`);
  // 全データで学習し直して出力する(L1 の点の単位に直す: b / a)
  const all = fit(data);
  const tab: Record<string, number> = {};
  for (const [d, v] of Object.entries(all.b)) tab[d] = Math.round((v / all.a) * 100) / 100;
  if (name === 'マナチャージ') {
    // keepScore は小さいほど置きたい(x = −keepScore)。b が大きい = 置きたい = keepScore を下げる
    for (const [d, v] of Object.entries(tab)) out.cardKeep[d] = -v;
  } else out.cardPlay = tab;
}
console.log(JSON.stringify(out));
if (a.out) {
  mkdirSync(dirname(a.out), { recursive: true });
  writeFileSync(a.out, JSON.stringify(out, null, 1));
  console.error('→', a.out);
}
