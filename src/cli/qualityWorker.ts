// AI の質の測定用 Worker(node:worker_threads)。教師の値の計算と、測る AI の判定を、局面のまとまりごとに行う。
import { parentPort } from 'node:worker_threads';
import type { AgentSpec } from '../ai';
import { CARD_DB } from '../cards';
import { loadRegistry } from '../engine/registry';
import { judgeAgent, teacherValues, type Judgement, type Position, type TeacherEntry, type TeacherOpts } from '../sim/aiEval';
import { installNativeFromEnv } from '../wasm/installNode';

installNativeFromEnv();
const reg = loadRegistry(CARD_DB);

export type QualityTask =
  | { kind: 'teacher'; positions: Position[]; opts: TeacherOpts }
  | { kind: 'judge'; items: { pos: Position; teacher: TeacherEntry }[]; spec: AgentSpec; seed: number };
export type QualityOut = { ok: true; teacher?: TeacherEntry[]; judged?: Judgement[] } | { ok: false; error: string };

parentPort!.on('message', (t: QualityTask) => {
  try {
    if (t.kind === 'teacher') {
      parentPort!.postMessage({ ok: true, teacher: t.positions.map((p) => teacherValues(reg, p, t.opts)) } satisfies QualityOut);
    } else {
      parentPort!.postMessage({
        ok: true,
        judged: t.items.map((it, i) => judgeAgent(reg, it.pos, it.teacher, t.spec, t.seed + i)),
      } satisfies QualityOut);
    }
  } catch (e: any) {
    parentPort!.postMessage({ ok: false, error: String(e?.message ?? e) } satisfies QualityOut);
  }
});
