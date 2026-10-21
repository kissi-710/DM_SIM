// 重い調査(確率・パターン・バッチ・カード強さ)を UI スレッドの外で実行する Worker。
// 実行の中身は sim/jobs.ts の runJob。分割・統合はクライアント側(ui/simClient.ts)が行う。
// src/wasm/dmsim.wasm(npm run build:wasm)があれば、モンテカルロ探索のラウンドの評価を Rust 版(WASM)で行う。無ければ TS 版。
import { setNativeRounds } from '../ai/mcts';
import { setNativePairedRound, setNativeTree } from '../ai/tree';
import { CARD_DB } from '../cards';
import { loadRegistry } from '../engine/registry';
import { runJob, type SimJob, type SimOut } from '../sim/jobs';
import { DmEngine } from '../wasm/dmEngine';
import { errorMessage } from '../engine/types';

export type { SimJob, SimOut };

const reg = loadRegistry(CARD_DB);

// Rust 版(WASM)。ビルドされていなければ何もしない(結果は TS 版と同じ)
const wasmUrls = import.meta.glob<string>('../wasm/dmsim.wasm', { query: '?url', import: 'default', eager: true });
const post = (m: SimOut) => (self as unknown as Worker).postMessage(m);
const nativeReady: Promise<void> = (async () => {
  const url = Object.values(wasmUrls)[0];
  if (!url) throw new Error('src/wasm/dmsim.wasm がありません');
  const bytes = await (await fetch(url)).arrayBuffer();
  const eng = await DmEngine.create(bytes, JSON.stringify(reg.defs));
  setNativeRounds(eng.asNativeRounds());
  setNativeTree(eng.asNativeTree());
  setNativePairedRound(eng.asNativePairedRound());
  console.info('[sim.worker] Rust 版エンジン(WASM)で探索します');
  post({ kind: 'ready', native: true });
})().catch((e) => {
  // 古い wasm は新しいカードを読めずにここへ来る。黙って遅くならないよう、画面へ知らせる(UI は simClient が受け取る)
  console.warn('[sim.worker] Rust 版エンジン(WASM)を読み込めませんでした。TS 版で動きます:', e);
  post({ kind: 'ready', native: false, why: errorMessage(e) });
});
let lastPost = 0;
const progress = (done: number, total: number) => {
  const now = Date.now();
  if (now - lastPost > 80 || done === total) {
    lastPost = now;
    post({ kind: 'progress', done, total });
  }
};

self.onmessage = async (e: MessageEvent<SimJob>) => {
  const job = e.data;
  await nativeReady;
  try {
    lastPost = 0;
    const result = runJob(reg, job, progress);
    post({ kind: 'result', job: job.type, result } as SimOut);
  } catch (err) {
    post({ kind: 'error', message: errorMessage(err) });
  }
};
