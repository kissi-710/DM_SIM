// AI Worker のクライアント。Worker が使えない環境では、その場で同期的に決定する。
// モンテカルロ探索は、複数の Worker に探索のラウンドを分けて並列に評価する(結果は逐次の探索と同じ)。
import { decide } from '../ai/decide';
import type { DecideReq } from '../ai/decide';
import { canParallelize, decideParallel, poolDispatch } from '../ai/parallel';
import type { RoundDispatch, SearchEnv } from '../ai/mcts';
import type { AiWorkerIn, AiWorkerOut } from '../workers/ai.worker';
import { CARD_DB } from '../cards';
import type { Action } from '../engine/types';

/** 探索に使う Worker の数(UI のために1コアを残す。最大8。1なら並列にしない) */
export function aiParallelism(): number {
  const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
  return Math.max(1, Math.min(8, (hc ?? 4) - 1));
}

/** 探索に使うエンジン: Rust 版(WASM)/ TS 版(WASM がない・読み込めない。約 6 倍遅い)/ まだ分からない */
export type AiEngine = 'unknown' | 'native' | 'ts';
let engine: AiEngine = 'unknown';
const engineListeners = new Set<(e: AiEngine) => void>();

export function aiEngine(): AiEngine {
  return engine;
}

/** エンジンの種類が分かった時・変わった時に呼ばれる。戻り値で購読をやめる */
export function onAiEngine(cb: (e: AiEngine) => void): () => void {
  engineListeners.add(cb);
  return () => engineListeners.delete(cb);
}

function setEngine(e: AiEngine): void {
  if (e === engine) return;
  engine = e;
  for (const cb of engineListeners) cb(e);
}

/** Worker を先に起動しておく(最初の CPU の手で、起動を待たせない)。種類は onAiEngine で分かる */
export function warmAi(): void {
  if (getPool(aiParallelism()).length === 0) setEngine('ts');
}

type Waiting = { resolve: (m: AiWorkerOut & { ok: true }) => void; reject: (e: Error) => void };

const pool: Worker[] = [];
let seq = 0;
let sidSeq = 0;
const waiting = new Map<number, Waiting>();
let broken = false;

function spawn(): Worker | null {
  try {
    const w = new Worker(new URL('../workers/ai.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<AiWorkerOut>) => {
      const m = e.data;
      if (!('ok' in m)) {
        // どれか 1 本でも Rust 版なら、Rust 版(全員が同じビルドなので、通常は揃う)
        if (m.native) setEngine('native');
        else if (engine === 'unknown') setEngine('ts');
        return;
      }
      const p = waiting.get(m.id);
      if (!p) return;
      waiting.delete(m.id);
      if (m.ok) p.resolve(m);
      else p.reject(new Error(m.error));
    };
    w.onerror = (e) => {
      for (const [, p] of waiting) p.reject(new Error(e.message));
      waiting.clear();
    };
    return w;
  } catch {
    return null;
  }
}

/** n 本まで Worker を用意して返す(作れなければ、作れた分だけ) */
function getPool(n: number): Worker[] {
  if (typeof Worker === 'undefined' || broken) return [];
  while (pool.length < n) {
    const w = spawn();
    if (!w) {
      if (pool.length === 0) broken = true;
      break;
    }
    pool.push(w);
  }
  return pool.slice(0, n);
}

const call = (w: Worker, msg: (id: number) => AiWorkerIn) =>
  new Promise<AiWorkerOut & { ok: true }>((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    w.postMessage(msg(id));
  });

/** 画面を離れる・対戦をやり直す時の取り消し。待機中の要求は、これで失敗として返る */
export class AiCancelled extends Error {
  constructor() {
    super('AI の思考を取り消しました');
    this.name = 'AiCancelled';
  }
}

/**
 * 実行中・待機中の AI の探索をすべて取り消す。Worker は途中で止められないので、停止(terminate)して
 * 次の要求で作り直す。やり直した対戦の最初の CPU の手が、前の対戦の探索に待たされないようにする。
 */
export function cancelAi(): void {
  const err = new AiCancelled();
  for (const w of pool.splice(0)) w.terminate();
  for (const [, p] of waiting) p.reject(err);
  waiting.clear();
}

export function chooseWithWorker(req: DecideReq): Promise<Action> {
  const n = canParallelize(CARD_DB, req) ? aiParallelism() : 1;
  const ws = getPool(n);
  if (ws.length === 0) {
    setEngine('ts');
    return Promise.resolve().then(() => decide(CARD_DB, req));
  }
  if (ws.length === 1 || n === 1) {
    return call(ws[0], (id) => ({ id, req })).then((m) => {
      if (!('action' in m)) throw new Error('不正な応答');
      return m.action;
    });
  }
  const sid = ++sidSeq;
  // 空いた Worker から順に、2ラウンドずつ取って評価する(重いラウンドに全体が待たされにくい)
  const runners: RoundDispatch[] = ws.map((w) => async (seeds, alive) => {
    const m = await call(w, (id) => ({ kind: 'rounds', id, sid, seeds, alive }));
    if (!('rows' in m)) throw new Error('不正な応答');
    return m.rows;
  });
  const dispatch = poolDispatch(runners, 2);
  const begin = (env: SearchEnv) => {
    for (const w of ws) w.postMessage({ kind: 'begin', sid, env } satisfies AiWorkerIn);
  };
  return decideParallel(CARD_DB, req, { begin, dispatch, parallelism: ws.length });
}
