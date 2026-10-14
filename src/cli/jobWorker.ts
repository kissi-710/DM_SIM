// CLI 用の Worker(node:worker_threads)。ジョブを1つ受け取って runJob で実行し、結果を返す。
import { parentPort } from 'node:worker_threads';
import { CARD_DB } from '../cards';
import { loadRegistry } from '../engine/registry';
import { runJob, type SimJob } from '../sim/jobs';

const reg = loadRegistry(CARD_DB);

parentPort!.on('message', (job: SimJob) => {
  try {
    parentPort!.postMessage({ ok: true, result: runJob(reg, job) });
  } catch (e: any) {
    parentPort!.postMessage({ ok: false, error: String(e?.message ?? e) });
  }
});
