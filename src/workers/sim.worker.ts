// 重い調査(確率・パターン・バッチ・カード強さ)を UI スレッドの外で実行する Worker。
// 実行の中身は sim/jobs.ts の runJob。分割・統合はクライアント側(ui/simClient.ts)が行う。
import { CARD_DB } from '../cards';
import { loadRegistry } from '../engine/registry';
import { runJob, type SimJob, type SimOut } from '../sim/jobs';

export type { SimJob, SimOut };

const reg = loadRegistry(CARD_DB);
let lastPost = 0;
const post = (m: SimOut) => (self as unknown as Worker).postMessage(m);
const progress = (done: number, total: number) => {
  const now = Date.now();
  if (now - lastPost > 80 || done === total) {
    lastPost = now;
    post({ kind: 'progress', done, total });
  }
};

self.onmessage = (e: MessageEvent<SimJob>) => {
  const job = e.data;
  try {
    lastPost = 0;
    const result = runJob(reg, job, progress);
    post({ kind: 'result', job: job.type, result } as SimOut);
  } catch (err: any) {
    post({ kind: 'error', message: String(err?.message ?? err) });
  }
};
