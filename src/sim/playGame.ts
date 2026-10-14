// 1試合を最後まで進める(Node・ブラウザ・Worker 共通)。
import { createGame, legalActions, registryOf, step } from '../engine/engine';
import { hashSeed } from '../engine/state';
import type { Registry } from '../engine/registry';
import type { Action, CardDB, Ev, GameConfig, GameState, PlayerId } from '../engine/types';
import { FAIR, toPlayerView } from '../engine/view';
import type { Agent } from '../ai/types';

// mulberry は engine/prng.ts に置く(ai からも使うので、sim ではなく下の層に置く)。互換のためここからも出す。
import { mulberry } from '../engine/prng';
export { mulberry };

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
  /** 各手のあとに呼ばれる(検証・観戦用) */
  onStep?: (state: GameState, action: Action, events: Ev[]) => void;
  maxSteps?: number;
  /** 構築制限を検査するか(既定は検査しない) */
  strict?: boolean;
}

function viewFor(s: GameState, who: PlayerId, ag: Agent, reg: Registry): GameState {
  if (ag.needsView === false) return s;
  return toPlayerView(s, who, ag.policy ?? FAIR, reg);
}

/** 1試合の進行状態(同期版・非同期版で共通) */
interface Run {
  reg: Registry;
  s: GameState;
  rng: () => number;
  actions: Action[];
  steps: number;
  max: number;
}

function begin(db: CardDB | Registry, opts: PlayOpts): Run {
  const reg = registryOf(db);
  const { state } = createGame(reg, { decks: opts.decks, seed: opts.seed, first: opts.first ?? 'random', cfg: opts.cfg, strict: opts.strict });
  return { reg, s: state, rng: mulberry(hashSeed(opts.seed) ^ 0x9e3779b9), actions: [], steps: 0, max: opts.maxSteps ?? 20000 };
}

const running = (r: Run) => r.s.winner === null && r.steps < r.max;

/** 次に決めるプレイヤーと、そのエージェントに渡す視点・合法手 */
function turnOf(r: Run, agents: [Agent, Agent]): { ag: Agent; view: GameState; legal: Action[] } {
  const legal = legalActions(r.s, r.reg);
  if (legal.length === 0) throw new Error('合法手がありません: ' + JSON.stringify(r.s.pending));
  const who = r.s.pending!.player;
  const ag = agents[who];
  return { ag, view: viewFor(r.s, who, ag, r.reg), legal };
}

function apply(r: Run, a: Action, opts: PlayOpts): void {
  const out = step(r.s, a, r.reg);
  opts.onStep?.(out.state, a, out.events);
  r.actions.push(a);
  r.s = out.state;
  r.steps++;
}

function finish(r: Run): PlayResult {
  return { state: r.s, winner: r.s.winner, turns: r.s.turn, steps: r.steps, actions: r.actions, reason: r.s.loseReason };
}

export function playGameSync(db: CardDB | Registry, agents: [Agent, Agent], opts: PlayOpts): PlayResult {
  const r = begin(db, opts);
  while (running(r)) {
    const { ag, view, legal } = turnOf(r, agents);
    const a = ag.chooseAction(view, legal, { rand: r.rng, reg: r.reg });
    if (a instanceof Promise) throw new Error('同期実行に非同期AIは使えません');
    apply(r, a, opts);
  }
  return finish(r);
}

export async function playGame(db: CardDB | Registry, agents: [Agent, Agent], opts: PlayOpts): Promise<PlayResult> {
  const r = begin(db, opts);
  while (running(r)) {
    const { ag, view, legal } = turnOf(r, agents);
    const a = await ag.chooseAction(view, legal, { rand: r.rng, reg: r.reg });
    apply(r, a, opts);
  }
  return finish(r);
}
