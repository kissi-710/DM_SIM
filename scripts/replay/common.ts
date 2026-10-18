// 再検討の実験の共通部品: 手の説明、手の列からの局面の再現、局面からの続きのプレイ。
import { deckCards } from '../../src/cards';
import { makeAgent } from '../../src/ai';
import type { AiTuning } from '../../src/ai';
import { parseSpec } from '../../src/ai/specString';
import type { SearchInfo } from '../../src/ai/mcts';
import type { Agent } from '../../src/ai/types';
import { createGame, legalActions, step } from '../../src/engine/engine';
import type { Registry } from '../../src/engine/registry';
import type { Action, GameState, PlayerId } from '../../src/engine/types';
import { FAIR, toPlayerView } from '../../src/engine/view';
import { mulberry } from '../../src/engine/prng';

export interface GameRecord {
  id: number;
  deckA: string;
  deckB: string;
  seed: number;
  first: PlayerId;
  actions: Action[];
  winner: PlayerId | 'draw' | null;
  turns: number;
  /** 判断(合法手が 2 つ以上だった入力待ち)ごとの、通常の探索の記録。k = 何手目の行動か */
  decisions: { k: number; who: PlayerId; ms: number; iters: number | null; decided: boolean | null; n: number }[];
}

const nameOf = (reg: Registry, s: GameState, u: number) => reg.defs[s.cards[u].defId].name.split(' / ')[0];

/** 手の説明(同じ意味の手は同じ文字列になる。同名のカードのどれを選んでも同じ、など) */
export function describeAction(reg: Registry, s: GameState, a: Action): string {
  const me = s.pending!.player;
  const topName = (p: number, pid: number) => {
    const perm = s.players[p].battle.find((x) => x.pid === pid);
    if (!perm) return '?';
    const top = s.cards[perm.cards[0]];
    const d = reg.defs[top.defId];
    return d.faces[top.face]?.name ?? d.name;
  };
  switch (a.type) {
    case 'CHARGE_MANA':
      return `マナに置く: ${nameOf(reg, s, a.uid)}`;
    case 'SKIP_MANA':
      return 'マナに置かない';
    case 'PLAY_CARD': {
      const d = reg.defs[s.cards[a.uid].defId];
      const f = d.faces[a.face ?? 0] ?? d.faces[0];
      const taps = a.extra?.tap?.length ? ` タップ${a.extra.tap.length}` : '';
      const from = a.from && a.from !== 'hand' ? `(${a.from === 'mana' ? 'マナ' : '墓地'}から)` : '';
      return `${f.type === 'spell' ? '唱える' : '出す'}: ${f.name}${from}${taps}`;
    }
    case 'ATTACK':
      return `攻撃: ${topName(me, a.attacker)} → ${a.target.kind === 'player' ? '相手プレイヤー' : topName(1 - me, a.target.pid)}`;
    case 'END_MAIN':
      return '攻撃に進む(メインを終える)';
    case 'END_TURN':
      return 'ターンを終える';
    case 'ANSWER': {
      const p = s.pending!;
      const inp = p.input;
      const src = p.source ? nameOf(reg, s, p.source.uid) : '';
      let d = JSON.stringify(a.value);
      if (inp && inp.shape === 'yesno') d = a.value ? 'はい' : 'いいえ';
      else if (inp && inp.shape === 'option') d = (a.value as number[]).map((i) => inp.options[i]).join(' + ');
      else if (inp && inp.shape === 'pick') d = (a.value as number[]).map((u) => nameOf(reg, s, u)).sort().join('、') || '選ばない';
      else if (inp && inp.shape === 'assign') d = Object.entries(a.value as Record<string, number[]>).map(([k, v]) => `${inp.slots.find((x) => x.id === k)?.label ?? k}: ${v.map((u) => nameOf(reg, s, u)).sort().join('、')}`).join(' / ');
      return `回答[${p.why}${src ? ':' + src : ''}] ${d}`;
    }
    default:
      return JSON.stringify(a);
  }
}

/** 同じ意味の手(説明が同じ)を畳んだ候補の一覧 */
export function distinctOptions(reg: Registry, s: GameState, legal: Action[]): { text: string; act: Action }[] {
  const seen = new Map<string, { text: string; act: Action }>();
  for (const a of legal) {
    const t = describeAction(reg, s, a);
    if (!seen.has(t)) seen.set(t, { text: t, act: a });
  }
  return [...seen.values()];
}

/** 手の列から、各判断の直前の局面を順に出す */
export function* replay(reg: Registry, g: GameRecord): Generator<{ k: number; s: GameState; a: Action }> {
  let s = createGame(reg, { decks: [deckCards(g.deckA), deckCards(g.deckB)], seed: g.seed, first: g.first }).state;
  for (let k = 0; k < g.actions.length; k++) {
    yield { k, s, a: g.actions[k] };
    s = step(s, g.actions[k], reg).state;
  }
}

/** 探索 AI を作る。onInfo に、直近の探索の反復回数などが入る */
export function makeSearchAgent(specText: string, onInfo?: (i: SearchInfo) => void): Agent {
  const spec = parseSpec(specText);
  if (onInfo) spec.tuning = { ...spec.tuning, onSearch: onInfo } as AiTuning;
  return makeAgent(spec);
}

/** 局面から、両者が agents で最後まで指す。勝者を返す */
/** 続きの手数の上限(これを超えたら引き分け扱い)。極端に長い試合で、検証が止まらないようにする */
const MAX_CONT_STEPS = Number(process.env.DM_CONT_CAP ?? 300);
export function playOut(reg: Registry, s0: GameState, agents: [Agent, Agent], rand: () => number): PlayerId | 'draw' | null {
  let s = s0;
  let guard = 0;
  while (s.winner === null && guard++ < MAX_CONT_STEPS) {
    const legal = legalActions(s, reg);
    if (legal.length === 0) break;
    const who = s.pending!.player;
    const ag = agents[who];
    const view = ag.needsView === false ? s : toPlayerView(s, who, ag.policy ?? FAIR, reg);
    const a = ag.chooseAction(view, legal, { rand, reg }) as Action;
    s = step(s, a, reg).state;
  }
  return s.winner;
}

/** 局面 s で手 a を指したあと、agents で最後まで n 回続けた時の、who の勝率(引分は 0.5)。同じ seed 列なら、手を替えても条件がそろう */
export function winRateAfter(reg: Registry, s: GameState, a: Action, who: PlayerId, agents: [Agent, Agent], n: number, seed: number): { rate: number; n: number; wins: number; capped: number } {
  let wins = 0;
  let capped = 0;
  for (let i = 0; i < n; i++) {
    const rand = mulberry(seed * 7919 + i);
    const next = step(s, a, reg).state;
    const w = playOut(reg, next, agents, rand);
    if (w === who) wins++;
    else if (w === 'draw' || w === null) wins += 0.5;
    if (w === null) capped++;
  }
  return { rate: wins / n, n, wins, capped };
}

export const seedOf = (seed: number, k: number) => ((seed * 2654435761) ^ (k * 40503)) >>> 0;
export { mulberry };
