// AI の思考を UI スレッドの外で行う Web Worker(design 7.4)。
// 受け取るのは JSON 化できるデータ(状態・設定)だけ。
import { decide, type DecideReq } from '../ai/decide';
import { CARD_DB } from '../cards';
import { loadRegistry } from '../engine/registry';

export interface AiWorkerIn {
  id: number;
  req: DecideReq;
}
export type AiWorkerOut = { id: number; ok: true; action: import('../engine/types').Action; ms: number } | { id: number; ok: false; error: string };

const reg = loadRegistry(CARD_DB);

self.onmessage = (e: MessageEvent<AiWorkerIn>) => {
  const { id, req } = e.data;
  const t0 = Date.now();
  try {
    const action = decide(reg, req);
    (self as unknown as Worker).postMessage({ id, ok: true, action, ms: Date.now() - t0 } satisfies AiWorkerOut);
  } catch (err: any) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String(err?.message ?? err) } satisfies AiWorkerOut);
  }
};
