// 1試合を最後まで進める(Node・ブラウザ共通)。
import { createGame, legalActions, step, registryOf } from '../engine/engine';
import type { Action, CardDB, Ev, GameConfig, GameState, PlayerId } from '../engine/types';
import type { Registry } from '../engine/registry';
import type { Agent } from '../ai/types';
import { hashSeed } from '../engine/state';

export function mulberry(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PlayResult {
  state: GameState;
  winner: PlayerId | 'draw' | null;
  turns: number;
  steps: number;
  actions: Action[];
  reason: string | null;
}

export interface PlayOpts {
  decks: [string[], string[]];
  seed: number | string;
  first?: PlayerId | 'random';
  cfg?: Partial<GameConfig>;
  /** 検証用: 各手のあとに呼ばれる */
  onStep?: (state: GameState, action: Action, events: Ev[]) => void;
  maxSteps?: number;
}

export function playGameSync(db: CardDB | Registry, agents: [Agent, Agent], opts: PlayOpts): PlayResult {
  const reg = registryOf(db);
  const { state: s0 } = createGame(reg, { decks: opts.decks, seed: opts.seed, first: opts.first ?? 'random', cfg: opts.cfg });
  let s = s0;
  const rng = mulberry(hashSeed(opts.seed) ^ 0x9e3779b9);
  const actions: Action[] = [];
  let steps = 0;
  const max = opts.maxSteps ?? 20000;
  while (s.winner === null && steps < max) {
    const legal = legalActions(s, reg);
    if (legal.length === 0) throw new Error('合法手がありません: ' + JSON.stringify(s.pending));
    const who = s.pending!.player;
    const a = agents[who].chooseAction(s, legal, { rand: rng, reg });
    if (a instanceof Promise) throw new Error('同期実行に非同期AIは使えません');
    const r = step(s, a, reg);
    opts.onStep?.(r.state, a, r.events);
    actions.push(a);
    s = r.state;
    steps++;
  }
  return { state: s, winner: s.winner, turns: s.turn, steps, actions, reason: s.loseReason };
}
