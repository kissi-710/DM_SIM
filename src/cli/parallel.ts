// CLI の並列実行: ジョブを分割し、node:worker_threads のプールで実行して統合する。
// 結果は直列実行と一致する(シードの割り当ては元のジョブと同じ。sim/jobs.ts)。
import { availableParallelism } from 'node:os';
import { CARD_DB } from '../cards';
import { loadRegistry } from '../engine/registry';
import { planJob, runJob, type JobResult, type SimJob } from '../sim/jobs';
import { installNativeFromEnv } from '../wasm/installNode';
import { runPool } from './pool';

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
  const total = plan.units.reduce((a, b) => a + b, 0);
  let doneUnits = 0;
  const results = await runPool<SimJob, { ok: boolean; result?: JobResult; error?: string }, JobResult>(new URL('./jobWorker.ts', import.meta.url), plan.chunks, jobs, {
    unwrap: (m) => {
      if (!m.ok) throw new Error(m.error);
      return m.result!;
    },
    onResult: (_r, i) => {
      doneUnits += plan.units[i];
      onProgress?.(doneUnits, total);
    },
  });
  return plan.merge(results, Date.now() - t0);
}
