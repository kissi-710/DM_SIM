// 調査用 Worker のクライアント。キャンセルは Worker を作り直して行う。
import type { SimJob, SimOut } from '../workers/sim.worker';

export interface RunningJob<T> {
  promise: Promise<T>;
  cancel: () => void;
}

export function runSimJob<T>(job: SimJob, onProgress?: (done: number, total: number) => void): RunningJob<T> {
  const w = new Worker(new URL('../workers/sim.worker.ts', import.meta.url), { type: 'module' });
  let rejectFn: (e: Error) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    rejectFn = reject;
    w.onmessage = (e: MessageEvent<SimOut>) => {
      const m = e.data;
      if (m.kind === 'progress') onProgress?.(m.done, m.total);
      else if (m.kind === 'result') {
        resolve(m.result as unknown as T);
        w.terminate();
      } else {
        reject(new Error(m.message));
        w.terminate();
      }
    };
    w.onerror = (ev) => {
      reject(new Error(ev.message || 'Worker のエラー'));
      w.terminate();
    };
    w.postMessage(job);
  });
  return {
    promise,
    cancel: () => {
      rejectFn(new Error('キャンセルしました'));
      w.terminate();
    },
  };
}
