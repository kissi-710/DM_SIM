// ブラウザに保存した設定(localStorage)の読み込み。古い保存・壊れた保存・消したデッキを選んでいた保存でも、
// 画面が開けなくならないように、項目ごとに形を確かめ、使えない項目は捨てて既定に戻す。
import { isGoal, type Goal } from '../sim/goal';
import { INFO_PRESET_LABEL, type InfoPreset } from '../engine/view';
import type { AgentKind } from '../ai';
import { allDecks } from './decks';
import { loadJson } from './util';

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x: unknown, lo: number, hi: number): number | undefined => (typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi ? x : undefined);
const str = (x: unknown): string | undefined => (typeof x === 'string' ? x : undefined);
const bool = (x: unknown): boolean | undefined => (typeof x === 'boolean' ? x : undefined);
const deckExists = (id: unknown): id is string => typeof id === 'string' && allDecks().some((d) => d.id === id);

export interface SavedSeat {
  kind: 'human' | 'cpu';
  agent: AgentKind;
  info: InfoPreset;
  deck: string;
  hypo?: string;
}

export interface SavedSetup {
  /** 2席とも正しい時だけ入る */
  seats?: [SavedSeat, SavedSeat];
  first?: string;
  seed?: string;
  autoOrder?: boolean;
  undo?: boolean;
  delay?: number;
  think?: number;
}

function seatOf(x: unknown): SavedSeat | null {
  if (!isObj(x)) return null;
  const kind = x.kind === 'human' || x.kind === 'cpu' ? x.kind : null;
  const agent = x.agent === 'random' || x.agent === 'rule' || x.agent === 'mcts' ? x.agent : null;
  const info = typeof x.info === 'string' && x.info in INFO_PRESET_LABEL ? (x.info as InfoPreset) : null;
  if (!kind || !agent || !info || !deckExists(x.deck)) return null;
  return { kind, agent, info, deck: x.deck, ...(typeof x.hypo === 'string' ? { hypo: x.hypo } : {}) };
}

/** 対戦・観戦の設定の保存を、項目ごとに確かめて読む。席は、2席とも正しい時だけ使う(消したデッキを選んでいたら、席ごと既定に戻す) */
export function loadSavedSetup(mode: 'play' | 'watch'): SavedSetup {
  const raw = loadJson<unknown>('dmsim.setup.' + mode, null);
  if (!isObj(raw)) return {};
  const out: SavedSetup = {};
  if (Array.isArray(raw.seats) && raw.seats.length === 2) {
    const a = seatOf(raw.seats[0]);
    const b = seatOf(raw.seats[1]);
    if (a && b) out.seats = [a, b];
  }
  if (raw.first === 'random' || raw.first === '0' || raw.first === '1') out.first = raw.first;
  const seed = str(raw.seed);
  if (seed !== undefined) out.seed = seed;
  const autoOrder = bool(raw.autoOrder);
  if (autoOrder !== undefined) out.autoOrder = autoOrder;
  const undo = bool(raw.undo);
  if (undo !== undefined) out.undo = undo;
  const delay = num(raw.delay, 0, 3000);
  if (delay !== undefined) out.delay = delay;
  const think = num(raw.think, 50, 20000);
  if (think !== undefined) out.think = think;
  return out;
}

export interface SavedSim {
  deckId?: string;
  first?: 0 | 1;
  goal?: Goal;
  trials?: number;
  seed?: number;
  maxNodes?: number;
  agent?: 'rule' | 'random';
  must?: string;
  exclude?: string;
  topFixed?: string;
}

/** ソリティア調査の入力の保存を、項目ごとに確かめて読む(消したデッキ・形の違う目標は捨てる) */
export function loadSavedSim(): SavedSim {
  const raw = loadJson<unknown>('dmsim.sim', null);
  if (!isObj(raw)) return {};
  const out: SavedSim = {};
  if (deckExists(raw.deckId)) out.deckId = raw.deckId;
  if (raw.first === 0 || raw.first === 1) out.first = raw.first;
  if (isGoal(raw.goal)) out.goal = raw.goal;
  const trials = num(raw.trials, 1, 100000);
  if (trials !== undefined) out.trials = Math.floor(trials);
  const seed = num(raw.seed, -2147483648, 4294967295);
  if (seed !== undefined) out.seed = Math.floor(seed);
  const maxNodes = num(raw.maxNodes, 0, 1e9);
  if (maxNodes !== undefined) out.maxNodes = Math.floor(maxNodes);
  if (raw.agent === 'rule' || raw.agent === 'random') out.agent = raw.agent;
  for (const k of ['must', 'exclude', 'topFixed'] as const) {
    const s = str(raw[k]);
    if (s !== undefined) out[k] = s;
  }
  return out;
}
