// AI Worker のクライアント。Worker が使えない環境では、その場で同期的に決定する。
import { decide } from '../ai/decide';
import type { DecideReq } from '../ai/decide';
import type { AiWorkerOut } from '../workers/ai.worker';
import { CARD_DB } from '../cards';
import type { Action } from '../engine/types';

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { resolve: (a: Action) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('../workers/ai.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<AiWorkerOut>) => {
        const m = e.data;
        const w = waiting.get(m.id);
        if (!w) return;
        waiting.delete(m.id);
        if (m.ok) w.resolve(m.action);
        else w.reject(new Error(m.error));
      };
      worker.onerror = (e) => {
        for (const [, w] of waiting) w.reject(new Error(e.message));
        waiting.clear();
      };
    } catch {
      worker = null;
    }
  }
  return worker;
}

export function chooseWithWorker(req: DecideReq): Promise<Action> {
  const w = getWorker();
  if (!w) return Promise.resolve().then(() => decide(CARD_DB, req));
  return new Promise<Action>((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    w.postMessage({ id, req });
  });
}
