// worker_threads のプール: タスクを 1 つずつ Worker に渡し、結果を 1 つずつ受け取る(空いた Worker に次のタスクを渡す)。
import { Worker } from 'node:worker_threads';

export interface PoolOpts<T, M, R> {
  /** Worker からのメッセージを結果にする。例外を投げると、全 Worker を止めて reject する(例: `{ ok: false, error }` を Error にする) */
  unwrap?: (message: M, task: T) => R;
  /** 1 つ終わるたびに呼ばれる(index はタスクの添字、finished は終わった数) */
  onResult?: (result: R, index: number, finished: number) => void;
}

/** tasks を workerUrl の Worker で workers 並列に実行する。結果は tasks と同じ順 */
export function runPool<T, M = unknown, R = M>(workerUrl: URL, tasks: T[], workers: number, opts: PoolOpts<T, M, R> = {}): Promise<R[]> {
  const results: R[] = new Array(tasks.length);
  if (tasks.length === 0) return Promise.resolve(results);
  const pool: Worker[] = [];
  const stop = () => pool.forEach((w) => void w.terminate());
  let next = 0;
  let finished = 0;
  return new Promise<R[]>((resolve, reject) => {
    const fail = (e: unknown) => {
      stop();
      reject(e);
    };
    const start = () => {
      const w = new Worker(workerUrl);
      pool.push(w);
      let cur = -1;
      const feed = () => {
        if (next >= tasks.length) return void w.terminate();
        cur = next++;
        w.postMessage(tasks[cur]);
      };
      w.on('message', (m: M) => {
        try {
          results[cur] = opts.unwrap ? opts.unwrap(m, tasks[cur]) : (m as unknown as R);
          finished++;
          opts.onResult?.(results[cur], cur, finished);
        } catch (e) {
          return fail(e);
        }
        if (finished === tasks.length) {
          stop();
          resolve(results);
        } else feed();
      });
      w.on('error', fail);
      feed();
    };
    for (let i = 0; i < Math.min(workers, tasks.length); i++) start();
  });
}
