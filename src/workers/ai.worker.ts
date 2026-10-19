// AI の思考を UI スレッドの外で行う Web Worker(design 7.4)。
// 受け取るのは JSON 化できるデータ(状態・設定)だけ。
// 1つの意思決定を丸ごと行う(decide)ほか、並列探索のラウンドの評価(begin → rounds)も受け持つ。
// src/wasm/dmsim.wasm(npm run build:wasm)があれば、ラウンドの評価を Rust 版(WASM)で行う。無ければ TS 版。
import { decide, type DecideReq } from '../ai/decide';
import { evalRound, setNativeRounds, type SearchEnv } from '../ai/mcts';
import { PairedTree, setNativePairedRound, setNativeTree } from '../ai/tree';
import { CARD_DB } from '../cards';
import { loadRegistry } from '../engine/registry';
import { errorMessage, type Action } from '../engine/types';
import { DmEngine } from '../wasm/dmEngine';

export type AiWorkerIn =
  | { id: number; req: DecideReq }
  /** 並列探索の入力を登録する(sid ごと。新しいものから数件だけ覚える) */
  | { kind: 'begin'; sid: number; env: SearchEnv }
  /** 並列探索のラウンドを評価する。rows[i] は seeds[i] の結果 */
  | { kind: 'rounds'; id: number; sid: number; seeds: number[]; alive: number[] };
export type AiWorkerOut =
  /** 起動の完了。native は Rust 版(WASM)で探索するか(読み込めなければ TS 版) */
  | { kind: 'ready'; native: boolean }
  | { id: number; ok: true; action: Action; ms: number }
  | { id: number; ok: true; rows: number[][]; ms: number }
  | { id: number; ok: false; error: string };

const reg = loadRegistry(CARD_DB);
const envs = new Map<number, SearchEnv>();
/** 木のペア比較(env.tree)の探索の木。入力(sid)ごとに保つ */
const trees = new Map<number, PairedTree>();
const post = (m: AiWorkerOut) => (self as unknown as Worker).postMessage(m);

// Rust 版(WASM)。ビルドされていなければ何もしない
const wasmUrls = import.meta.glob<string>('../wasm/dmsim.wasm', { query: '?url', import: 'default', eager: true });
const nativeReady: Promise<boolean> = (async () => {
  const url = Object.values(wasmUrls)[0];
  if (!url) return false;
  const bytes = await (await fetch(url)).arrayBuffer();
  const eng = await DmEngine.create(bytes, JSON.stringify(reg.defs));
  setNativeRounds(eng.asNativeRounds());
  setNativeTree(eng.asNativeTree());
  setNativePairedRound(eng.asNativePairedRound());
  console.info('[ai.worker] Rust 版エンジン(WASM)で探索します');
  return true;
})().catch((e) => {
  // 読み込めなければ TS 版で動く
  console.warn('[ai.worker] Rust 版エンジン(WASM)を読み込めませんでした。TS 版で動きます:', e);
  return false;
});
void nativeReady.then((native) => post({ kind: 'ready', native }));

self.onmessage = async (e: MessageEvent<AiWorkerIn>) => {
  await nativeReady;
  const m = e.data;
  if ('kind' in m && m.kind === 'begin') {
    envs.set(m.sid, m.env);
    trees.delete(m.sid);
    while (envs.size > 4) {
      const old = envs.keys().next().value as number;
      envs.delete(old);
      trees.delete(old);
    }
    return;
  }
  const t0 = Date.now();
  if ('kind' in m && m.kind === 'rounds') {
    try {
      const env = envs.get(m.sid);
      if (!env) throw new Error('探索の入力がありません');
      let rows: number[][];
      if (env.tree) {
        // 木のペア比較: このWorkerが受け持ったラウンドの結果で、このWorkerの木を育てる(根の並列)
        let tree = trees.get(m.sid);
        if (!tree) trees.set(m.sid, (tree = new PairedTree(env, reg, env.tree)));
        rows = m.seeds.map((sd) => tree!.round(sd, m.alive));
      } else {
        rows = m.seeds.map((sd) => evalRound(env, reg, sd, m.alive));
      }
      post({ id: m.id, ok: true, rows, ms: Date.now() - t0 });
    } catch (err) {
      post({ id: m.id, ok: false, error: errorMessage(err) });
    }
    return;
  }
  const { id, req } = m as { id: number; req: DecideReq };
  try {
    post({ id, ok: true, action: decide(reg, req), ms: Date.now() - t0 });
  } catch (err) {
    post({ id, ok: false, error: errorMessage(err) });
  }
};
