// 再検討の実験の Worker: ①通常の時間で CPU 同士の試合を記録 ②各判断を、反復を大幅に増やした探索で再検討 ③候補を、続きを最後まで多数回プレイした勝率で評価
import { parentPort } from 'node:worker_threads';
import { CARD_DB, deckCards } from '../../src/cards';
import type { SearchInfo } from '../../src/ai/mcts';
import type { Agent } from '../../src/ai/types';
import { legalActions } from '../../src/engine/engine';
import { loadRegistry } from '../../src/engine/registry';
import type { Action, GameState, PlayerId } from '../../src/engine/types';
import { FAIR, toPlayerView } from '../../src/engine/view';
import { playGameSync } from '../../src/sim/playGame';
import { installNativeFromEnv } from '../../src/wasm/installNode';
import { describeAction, distinctOptions, makeSearchAgent, mulberry, replay, seedOf, winRateAfter, type GameRecord } from './common';

installNativeFromEnv();
const reg = loadRegistry(CARD_DB);

export interface CollectTask {
  kind: 'collect';
  games: { id: number; deckA: string; deckB: string; seed: number; first: PlayerId }[];
  spec: string;
}
export interface DeepTask {
  kind: 'deep';
  game: GameRecord;
  /** 反復を大幅に増やした探索 */
  deepSpec: string;
  /** 通常の探索(もう一度、別の乱数で選ばせて、自分自身との食い違いの基準にする) */
  normalSpec: string;
}
export interface DeepRow {
  gameId: number;
  k: number;
  who: PlayerId;
  turn: number;
  n: number;
  chosen: string;
  deep: string;
  recheck: string;
  /** 通常の探索が実際に使った時間・反復回数 */
  ms: number;
  iters: number | null;
  decided: boolean | null;
  deepMs: number;
}
export interface EvalTask {
  kind: 'eval';
  game: GameRecord;
  /** texts: 評価する候補の説明の一覧 / 'all' = 全候補 / 'chosen' = 実際に指した手だけ */
  items: { k: number; texts: string[] | 'all' | 'chosen' }[];
  contSpec: string;
  n: number;
  seed: number;
}
export interface EvalRow {
  gameId: number;
  k: number;
  who: PlayerId;
  turn: number;
  chosen: string;
  options: { text: string; rate: number; wins: number; n: number; capped: number }[];
}
export interface ChooseTask {
  kind: 'choose';
  game: GameRecord;
  ks: number[];
  spec: string;
  reps: number;
}
export interface ChooseRow {
  gameId: number;
  k: number;
  choices: string[];
}
export type ReplayTask = CollectTask | DeepTask | EvalTask | ChooseTask;

function collect(t: CollectTask): GameRecord[] {
  const out: GameRecord[] = [];
  for (const g of t.games) {
    const info = { last: null as SearchInfo | null };
    const mk = () => makeSearchAgent(t.spec, (i) => (info.last = i));
    const decisions: GameRecord['decisions'] = [];
    let k = 0;
    const wrap = (ag: Agent): Agent => ({
      ...ag,
      chooseAction(v, l, c) {
        info.last = null;
        const t0 = performance.now();
        const a = ag.chooseAction(v, l, c);
        if (l.length > 1) {
          decisions.push({ k, who: v.pending!.player, ms: performance.now() - t0, iters: (info.last as SearchInfo | null)?.iterations ?? null, decided: (info.last as SearchInfo | null)?.decided ?? null, n: l.length });
        }
        return a;
      },
    });
    const agents: [Agent, Agent] = [wrap(mk()), wrap(mk())];
    const actions: Action[] = [];
    const r = playGameSync(reg, agents, {
      decks: [deckCards(g.deckA), deckCards(g.deckB)],
      seed: g.seed,
      first: g.first,
      onStep: (_s, a) => {
        actions.push(a);
        k++;
      },
    });
    out.push({ id: g.id, deckA: g.deckA, deckB: g.deckB, seed: g.seed, first: g.first, actions, winner: r.winner, turns: r.turns, decisions });
  }
  return out;
}

function deep(t: DeepTask): DeepRow[] {
  const g = t.game;
  const info = { last: null as SearchInfo | null };
  const deepAgent = makeSearchAgent(t.deepSpec);
  const normal = makeSearchAgent(t.normalSpec, (i) => (info.last = i));
  const meta = new Map(g.decisions.map((d) => [d.k, d]));
  const rows: DeepRow[] = [];
  for (const { k, s, a } of replay(reg, g)) {
    const d = meta.get(k);
    if (!d) continue;
    const legal = legalActions(s, reg);
    const opts = distinctOptions(reg, s, legal);
    if (opts.length < 2) continue;
    const who = s.pending!.player;
    const view = toPlayerView(s, who, FAIR, reg);
    const t0 = performance.now();
    const da = deepAgent.chooseAction(view, legal, { rand: mulberry(seedOf(g.seed, k) ^ 0x1234), reg }) as Action;
    const deepMs = performance.now() - t0;
    const ra = normal.chooseAction(view, legal, { rand: mulberry(seedOf(g.seed, k) ^ 0x9876), reg }) as Action;
    rows.push({
      gameId: g.id,
      k,
      who,
      turn: Math.ceil(s.turn / 2),
      n: opts.length,
      chosen: describeAction(reg, s, a),
      deep: describeAction(reg, s, da),
      recheck: describeAction(reg, s, ra),
      ms: d.ms,
      iters: d.iters,
      decided: d.decided,
      deepMs,
    });
  }
  return rows;
}

function evalItems(t: EvalTask): EvalRow[] {
  const g = t.game;
  const agents: [Agent, Agent] = [makeSearchAgent(t.contSpec), makeSearchAgent(t.contSpec)];
  const want = new Map(t.items.map((i) => [i.k, i.texts]));
  const rows: EvalRow[] = [];
  for (const { k, s, a } of replay(reg, g)) {
    const texts = want.get(k);
    if (!texts) continue;
    const legal = legalActions(s, reg);
    const chosenText = describeAction(reg, s, a);
    const opts = distinctOptions(reg, s, legal).filter((o) => texts === 'all' || (texts === 'chosen' ? o.text === chosenText : texts.includes(o.text)));
    const who = s.pending!.player;
    const options = opts.map((o) => {
      const r = winRateAfter(reg, s, o.act, who, agents, t.n, seedOf(t.seed, k));
      return { text: o.text, rate: r.rate, wins: r.wins, n: r.n, capped: r.capped };
    });
    rows.push({ gameId: g.id, k, who, turn: Math.ceil(s.turn / 2), chosen: describeAction(reg, s, a), options });
  }
  return rows;
}

/** 指定した判断の局面で、ある設定の探索に、別の乱数で reps 回選ばせる */
function chooseAt(t: ChooseTask): ChooseRow[] {
  const g = t.game;
  const agent = makeSearchAgent(t.spec);
  const want = new Set(t.ks);
  const rows: ChooseRow[] = [];
  for (const { k, s } of replay(reg, g)) {
    if (!want.has(k)) continue;
    const legal = legalActions(s, reg);
    const view = toPlayerView(s, s.pending!.player, FAIR, reg);
    const choices: string[] = [];
    for (let r = 0; r < t.reps; r++) {
      const a = agent.chooseAction(view, legal, { rand: mulberry(seedOf(g.seed, k) ^ (0x5000 + r * 7919)), reg }) as Action;
      choices.push(describeAction(reg, s, a));
    }
    rows.push({ gameId: g.id, k, choices });
  }
  return rows;
}

parentPort!.on('message', (t: ReplayTask) => {
  try {
    const result = t.kind === 'collect' ? collect(t) : t.kind === 'deep' ? deep(t) : t.kind === 'choose' ? chooseAt(t) : evalItems(t);
    parentPort!.postMessage({ ok: true, result });
  } catch (e) {
    parentPort!.postMessage({ ok: false, error: e instanceof Error ? e.stack : String(e) });
  }
});

export type { GameState };
