// AI の質の測定(docs/ai-quality-plan.md §3.2): 局面の集合を作り、教師の手の価値と、測る AI の手を比べる。
//  - collectPositions: ルールベース同士の対局から、2択以上の意思決定の局面を層化して抽出する(測る AI によらず同一)
//  - teacherValues: 局面の全候補手を、同じ世界・同じ乱数でペア比較し、手ごとの平均報酬(勝率)を出す(外さない)
//  - judgeAgent: 測る AI の手を選ばせ、教師の値との差(損失 regret)・一致を出す
import { makeAgent, type AgentSpec } from '../ai';
import { evalRound, roundSeed, type SearchEnv } from '../ai/mcts';
import { legalActions, registryOf } from '../engine/engine';
import type { Registry } from '../engine/registry';
import type { Action, CardDB, GameState, PlayerId } from '../engine/types';
import { FAIR, toPlayerView, type InfoPolicy } from '../engine/view';
import { makeRuleBased } from '../ai/rulebased';
import { mulberry, playGameSync } from './playGame';

export interface Position {
  /** デッキの組の番号(collectPositions に渡した pairs の添字) */
  pair: number;
  /** 何ターン目か */
  turn: number;
  /** 入力待ちの状態(隠れたカードは伏せていない完全な状態) */
  state: GameState;
}

export interface DeckPair {
  id: string;
  a: string[];
  b: string[];
}

/** ターンの帯(層化の単位) */
const BANDS: [number, number][] = [
  [1, 3],
  [4, 6],
  [7, 9],
  [10, 999],
];
const bandOf = (turn: number) => BANDS.findIndex(([lo, hi]) => turn >= lo && turn <= hi);

/**
 * 局面を count 個、集める。ルールベース同士の対局(組・シード固定)から、帯ごとに均等になるよう、
 * 「合法手が2つ以上の入力待ち」の局面を無作為に取る。同じ引数なら同じ集合になる。
 */
export function collectPositions(db: CardDB | Registry, pairs: DeckPair[], count: number, seed: number): Position[] {
  const reg = registryOf(db);
  const rule = makeRuleBased();
  const out: Position[] = [];
  const perBand = Math.ceil(count / BANDS.length);
  const bandCount = BANDS.map(() => 0);
  const rng = mulberry(seed ^ 0x51ed270b);
  for (let g = 0; out.length < count && g < count * 20; g++) {
    const pair = pairs[g % pairs.length];
    const posts: GameState[] = [];
    playGameSync(reg, [rule, rule], {
      decks: g % 2 === 0 ? [pair.a, pair.b] : [pair.b, pair.a],
      seed: seed + g,
      first: 0,
      onStep: (s) => {
        if (s.winner === null && s.pending) posts.push(s);
      },
    });
    // 帯ごとに、まだ足りない帯の局面から1つずつ取る(1試合から取りすぎない)
    const order = BANDS.map((_, i) => i).sort((x, y) => bandCount[x] - bandCount[y] || x - y);
    for (const band of order) {
      if (bandCount[band] >= perBand || out.length >= count) continue;
      const cand = posts.filter((s) => bandOf(s.turn) === band);
      // 合法手が2つ以上の局面だけ(判定は少数の候補に対して行う)
      for (let t = 0; t < 6 && cand.length > 0; t++) {
        const i = Math.floor(rng() * cand.length);
        const s = cand.splice(i, 1)[0];
        if (legalActions(s, reg).length > 1) {
          out.push({ pair: pairs.indexOf(pair), turn: s.turn, state: s });
          bandCount[band]++;
          break;
        }
      }
    }
  }
  return out;
}

export interface TeacherOpts {
  /** ラウンド数(世界の数) */
  rounds: number;
  /** 何ターン先まで進めるか(大きければゲーム終了まで) */
  horizon: number;
  seed: number;
  policy?: InfoPolicy;
}

export interface TeacherEntry {
  who: PlayerId;
  why: string;
  legal: Action[];
  /** 手ごとの平均報酬(評価できたラウンドの平均。1回も評価できなければ NaN) */
  means: number[];
}

/** 局面の全候補手の価値を、同じ世界・同じ乱数のペア比較で評価する */
export function teacherValues(db: CardDB | Registry, pos: Position, o: TeacherOpts): TeacherEntry {
  const reg = registryOf(db);
  const s = pos.state;
  const who = s.pending!.player;
  const legal = legalActions(s, reg);
  const view = toPlayerView(s, who, o.policy ?? FAIR, reg);
  const env: SearchEnv = { view, legal, me: who, policy: o.policy ?? FAIR, horizon: o.horizon };
  const alive = legal.map((_, i) => i);
  const sum = new Array<number>(legal.length).fill(0);
  const cnt = new Array<number>(legal.length).fill(0);
  const base = Math.floor(mulberry(o.seed ^ pos.turn)() * 0x7fffffff);
  for (let r = 0; r < o.rounds; r++) {
    const row = evalRound(env, reg, roundSeed(base, r), alive);
    for (let k = 0; k < legal.length; k++) {
      if (!Number.isNaN(row[k])) {
        sum[k] += row[k];
        cnt[k]++;
      }
    }
  }
  return { who, why: s.pending!.why, legal, means: sum.map((v, k) => (cnt[k] ? v / cnt[k] : NaN)) };
}

export interface Judgement {
  why: string;
  /** 教師の最善手の値 − 選んだ手の値(勝率。0以上) */
  regret: number;
  /** 教師の最善手と同じ手を選んだか(同値の最善手も一致とする) */
  agree: boolean;
  /** 教師の1位と2位の差(接戦かの判定に使う) */
  gap: number;
  /** 手の数 */
  arms: number;
  /** 選んだ手が教師の評価で何位か(0 = 最善) */
  rank: number;
  /** 思考時間(ms) */
  ms: number;
}

const sameAction = (a: Action, b: Action) => JSON.stringify(a) === JSON.stringify(b);

/** 測る AI に手を選ばせ、教師の値と比べる */
export function judgeAgent(db: CardDB | Registry, pos: Position, teacher: TeacherEntry, spec: AgentSpec, seed: number): Judgement {
  const reg = registryOf(db);
  const agent = makeAgent(spec);
  const s = pos.state;
  const view = agent.needsView === false ? s : toPlayerView(s, teacher.who, agent.policy ?? FAIR, reg);
  const t0 = performance.now();
  const a = agent.chooseAction(view, teacher.legal, { rand: mulberry(seed), reg });
  const ms = performance.now() - t0;
  if (a instanceof Promise) throw new Error('非同期のAIは測れません');
  const idx = teacher.legal.findIndex((x) => sameAction(x, a));
  const vals = teacher.means.map((v) => (Number.isNaN(v) ? -Infinity : v));
  const best = Math.max(...vals);
  const chosen = idx >= 0 ? vals[idx] : -Infinity;
  const sorted = vals.slice().sort((x, y) => y - x);
  const second = sorted.length > 1 ? sorted[1] : sorted[0];
  const rank = sorted.findIndex((v) => v <= chosen + 1e-12);
  return {
    why: teacher.why,
    regret: Number.isFinite(chosen) ? Math.max(0, best - chosen) : Math.max(0, best - (sorted[sorted.length - 1] ?? 0)),
    agree: idx >= 0 && chosen >= best - 1e-12,
    gap: Number.isFinite(second) ? best - second : 0,
    arms: teacher.legal.length,
    rank: Math.max(0, rank),
    ms,
  };
}

export interface JudgeSummary {
  n: number;
  /** 損失の平均(勝率ポイントではなく 0〜1 の差) */
  regret: number;
  regretSe: number;
  agree: number;
  /** 接戦(教師の1位と2位の差が closeGap 未満)を除いた一致率と、その局面数 */
  agreeDecisive: number;
  nDecisive: number;
  avgMs: number;
  byWhy: Record<string, { n: number; regret: number; agree: number }>;
}

export function summarize(js: Judgement[], closeGap = 0.01): JudgeSummary {
  const n = js.length;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const regs = js.map((j) => j.regret);
  const m = mean(regs);
  const varr = n > 1 ? regs.reduce((a, x) => a + (x - m) * (x - m), 0) / (n - 1) : 0;
  const dec = js.filter((j) => j.gap >= closeGap);
  const byWhy: JudgeSummary['byWhy'] = {};
  for (const j of js) {
    const e = (byWhy[j.why] ??= { n: 0, regret: 0, agree: 0 });
    e.n++;
    e.regret += j.regret;
    e.agree += j.agree ? 1 : 0;
  }
  for (const e of Object.values(byWhy)) {
    e.regret /= e.n;
    e.agree /= e.n;
  }
  return {
    n,
    regret: m,
    regretSe: Math.sqrt(varr / Math.max(1, n)),
    agree: mean(js.map((j) => (j.agree ? 1 : 0))),
    agreeDecisive: mean(dec.map((j) => (j.agree ? 1 : 0))),
    nDecisive: dec.length,
    avgMs: mean(js.map((j) => j.ms)),
    byWhy,
  };
}
