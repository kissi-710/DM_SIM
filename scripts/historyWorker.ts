// 履歴ベンチ用 Worker: 版(現在・過去のコミットから取り出した探索 AI)を指定して、デッキの組ごとに複製対局を行う。
import { parentPort } from 'node:worker_threads';
import { CARD_DB, deckCards } from '../src/cards';
import { makeAgent as makeCurrent } from '../src/ai';
import { parseSpec } from '../src/ai/specString';
import type { Agent } from '../src/ai/types';
import { loadRegistry } from '../src/engine/registry';
import { playGameSync } from '../src/sim/playGame';
import { installNativeFromEnv } from '../src/wasm/installNode';
import { makeMcts as makeV0 } from './legacy/v0/mcts';
import { makeAgent as makeV1 } from './legacy/v1/index';
import { makeAgent as makeV2 } from './legacy/v2/index';
import { makeAgent as makeV3 } from './legacy/v3/index';
import { makeAgent as makeVmain } from './legacy/vmain/index';

// 現在の探索だけが Rust 版(WASM)を使う。過去の版は、それぞれのコピーの TS 版(基準の実装)で動く。
installNativeFromEnv();
const reg = loadRegistry(CARD_DB);

/** 版の指定: ver = cur | v0 | v1 | v2 | v3 | vmain。mode = iter(反復回数を揃える) | time(1手の時間を揃える)。n = 反復回数 or ms。extra = 現在の版への設定の追加(例 infer=0) */
export interface AgentDesc {
  ver: string;
  mode: 'iter' | 'time';
  n: number;
  extra?: string;
}

const BIG = 10_000_000;
export function makeAgentOf(d: AgentDesc): Agent {
  const iterOpts = d.mode === 'iter' ? { iterations: d.n, ms: BIG } : { iterations: BIG, ms: d.n };
  switch (d.ver) {
    case 'cur':
      return makeCurrent(parseSpec(d.mode === 'iter' ? `mcts:iter=${d.n}${d.extra ? ',' + d.extra : ''}` : `mcts:ms=${d.n}${d.extra ? ',' + d.extra : ''}`));
    case 'v0':
      return makeV0(iterOpts);
    case 'v1':
      return makeV1({ kind: 'mcts', ...iterOpts });
    case 'v2':
    case 'v3':
    case 'vmain': {
      // ptree 以降は、反復回数を指定しなければ時間主導になる
      const spec = d.mode === 'iter' ? { kind: 'mcts' as const, iterations: d.n, ms: BIG } : { kind: 'mcts' as const, ms: d.n };
      return (d.ver === 'v2' ? makeV2 : d.ver === 'v3' ? makeV3 : makeVmain)(spec);
    }
    default:
      throw new Error('未知の版: ' + d.ver);
  }
}

export interface HistoryTask {
  a: AgentDesc;
  b: AgentDesc;
  deckA: string;
  deckB: string;
  games: number;
  seed: number;
}
export interface HistoryOut {
  ok: true;
  n: number;
  wins: number;
  turns: number;
  /** A / B の 1 手あたりの思考時間(ms の合計と回数) */
  think: { msA: number; nA: number; msB: number; nB: number };
}

const timed = (ag: Agent, side: 'A' | 'B', think: HistoryOut['think']): Agent => ({
  ...ag,
  chooseAction(v, l, c) {
    const t = performance.now();
    const r = ag.chooseAction(v, l, c);
    if (l.length > 1) {
      think[side === 'A' ? 'msA' : 'msB'] += performance.now() - t;
      think[side === 'A' ? 'nA' : 'nB']++;
    }
    return r;
  },
});

parentPort!.on('message', (t: HistoryTask) => {
  try {
    const think = { msA: 0, nA: 0, msB: 0, nB: 0 };
    const A = timed(makeAgentOf(t.a), 'A', think);
    const B = timed(makeAgentOf(t.b), 'B', think);
    let wins = 0;
    let n = 0;
    let turns = 0;
    for (let g = 0; g < t.games; g++) {
      const sd = t.seed * 1000003 + g;
      for (const swap of [false, true]) {
        const r = playGameSync(reg, swap ? [B, A] : [A, B], { decks: [deckCards(t.deckA), deckCards(t.deckB)], seed: sd, first: 0 });
        const aSeat = swap ? 1 : 0;
        if (r.winner === aSeat) wins++;
        else if (r.winner === 'draw' || r.winner === null) wins += 0.5;
        turns += r.turns;
        n++;
      }
    }
    parentPort!.postMessage({ ok: true, n, wins, turns, think } satisfies HistoryOut);
  } catch (e) {
    parentPort!.postMessage({ ok: false, error: String(e) });
  }
});
