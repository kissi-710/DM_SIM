// CLI の並列実行: ジョブを分割し、node:worker_threads のプールで実行して統合する。
// 結果は直列実行と一致する(シードの割り当ては元のジョブと同じ。sim/jobs.ts)。
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { CARD_DB } from '../cards';
import { loadRegistry } from '../engine/registry';
import { planJob, runJob, type JobResult, type SimJob } from '../sim/jobs';
import { installNativeFromEnv } from '../wasm/installNode';

// 直列実行(--jobs 1)でも、環境変数 DM_WASM があれば Rust 版でラウンドを評価する
installNativeFromEnv();

/** 既定の並列数(1コアを残す。最大8) */
export function defaultJobs(): number {
  return Math.max(1, Math.min(8, availableParallelism() - 1));
}

export async function runParallel(job: SimJob, jobs: number = defaultJobs(), onProgress?: (done: number, total: number) => void): Promise<JobResult> {
  const t0 = Date.now();
  if (jobs <= 1) return runJob(loadRegistry(CARD_DB), job, onProgress);
  const plan = planJob({ defs: CARD_DB }, job, jobs * 3);
  const results: JobResult[] = new Array(plan.chunks.length);
  const total = plan.units.reduce((a, b) => a + b, 0);
  let doneUnits = 0;
  let next = 0;
  let finished = 0;
  const workers: Worker[] = [];
  const url = new URL('./jobWorker.ts', import.meta.url);
  try {
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        const w = new Worker(url);
        workers.push(w);
        let cur = -1;
        const feed = () => {
          if (next >= plan.chunks.length) {
            void w.terminate();
            return;
          }
          cur = next++;
          w.postMessage(plan.chunks[cur]);
        };
        w.on('message', (m: { ok: boolean; result?: JobResult; error?: string }) => {
          if (!m.ok) return reject(new Error(m.error));
          results[cur] = m.result!;
          doneUnits += plan.units[cur];
          onProgress?.(doneUnits, total);
          if (++finished === plan.chunks.length) resolve();
          else feed();
        });
        w.on('error', reject);
        feed();
      };
      for (let i = 0; i < Math.min(jobs, plan.chunks.length); i++) start();
    });
  } finally {
    for (const w of workers) void w.terminate();
  }
  return plan.merge(results, Date.now() - t0);
}
