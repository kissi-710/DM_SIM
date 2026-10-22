// 調査用 Worker のクライアント。ジョブを独立なチャンクに分け、CPU コア数ぶんの Worker で並列に実行して統合する。
// 試合・試行のシードは元のジョブと同じ並びで割り当てるので、結果は1スレッドで実行した場合と一致する。
// キャンセルは Worker を止めて行う。
import { CARD_DB } from '../cards';
import { planJob, type JobResult, type SimJob, type SimOut } from '../sim/jobs';

export interface RunningJob<T> {
  promise: Promise<T>;
  cancel: () => void;
}

/** 使う Worker の数(UI のために1コアを残す。最大8) */
export function workerCount(): number {
  const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
  return Math.max(1, Math.min(8, (hc ?? 4) - 1));
}

/**
 * onTsFallback: Worker が Rust 版(WASM)を読み込めず TS 版で動く時に、1 度だけ呼ばれる(why は理由)。
 * 古い dmsim.wasm は新しいカードを読めず、黙って TS 版(約 10 倍遅く、Worker ごとに約 240MB)になって CPU・メモリを使い切るので、画面に警告を出すために使う。
 */
export function runSimJob<T>(job: SimJob, onProgress?: (done: number, total: number) => void, onTsFallback?: (why?: string) => void): RunningJob<T> {
  const n = workerCount();
  // 負荷の偏りをならすため、Worker の数より細かく分けて、空いた Worker から順に渡す
  const plan = planJob({ defs: CARD_DB }, job, n * 3);
  const results: JobResult[] = new Array(plan.chunks.length);
  const doneUnits = plan.units.map(() => 0);
  const total = plan.units.reduce((a, b) => a + b, 0);
  const t0 = Date.now();
  const workers: Worker[] = [];
  let next = 0;
  let finished = 0;
  let dead = false;
  let tsReported = false;
  let rejectFn: (e: Error) => void = () => {};

  const stopAll = () => {
    dead = true;
    for (const w of workers) w.terminate();
  };
  const report = () => onProgress?.(doneUnits.reduce((a, b) => a + b, 0), total);

  const promise = new Promise<T>((resolve, reject) => {
    rejectFn = reject;
    const fail = (e: Error) => {
      if (dead) return;
      stopAll();
      reject(e);
    };
    const start = () => {
      const w = new Worker(new URL('../workers/sim.worker.ts', import.meta.url), { type: 'module' });
      workers.push(w);
      let cur = -1;
      const feed = () => {
        if (next >= plan.chunks.length) {
          w.terminate();
          return;
        }
        cur = next++;
        w.postMessage(plan.chunks[cur]);
      };
      w.onmessage = (e: MessageEvent<SimOut>) => {
        if (dead) return;
        const m = e.data;
        if (m.kind === 'ready') {
          if (!m.native && !tsReported) {
            tsReported = true;
            onTsFallback?.(m.why);
          }
        } else if (m.kind === 'progress') {
          doneUnits[cur] = Math.min(plan.units[cur], m.done);
          report();
        } else if (m.kind === 'result') {
          results[cur] = m.result;
          doneUnits[cur] = plan.units[cur];
          report();
          if (++finished === plan.chunks.length) {
            stopAll();
            resolve(plan.merge(results, Date.now() - t0) as unknown as T);
          } else feed();
        } else fail(new Error(m.message));
      };
      w.onerror = (ev) => fail(new Error(ev.message || 'Worker のエラー'));
      feed();
    };
    for (let i = 0; i < Math.min(n, plan.chunks.length); i++) start();
  });

  return {
    promise,
    cancel: () => {
      if (dead) return;
      stopAll();
      rejectFn(new Error('キャンセルしました'));
    },
  };
}
