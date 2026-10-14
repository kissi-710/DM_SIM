// Node(CLI・worker_threads)で、ラウンドの評価を Rust 版(WASM)に切り替える。
//   DM_WASM=rust/target/wasm32-unknown-unknown/release/dmsim.wasm npm run aibench -- ...
// 環境変数が無い・読み込めない時は何もしない(TS 版のまま)。
import { existsSync, readFileSync } from 'node:fs';
import { CARD_DB } from '../cards';
import { setNativeRounds } from '../ai/mcts';
import { loadRegistry } from '../engine/registry';
import { DmEngine } from './dmEngine';

let installed = false;

export function installNativeFromEnv(): boolean {
  if (installed) return true;
  const path = process.env.DM_WASM;
  if (!path || !existsSync(path)) return false;
  try {
    const reg = loadRegistry(CARD_DB);
    const eng = DmEngine.createSync(readFileSync(path), JSON.stringify(reg.defs));
    setNativeRounds(eng.asNativeRounds());
    installed = true;
    return true;
  } catch (e) {
    console.error('Rust 版エンジン(WASM)を読み込めませんでした。TS 版で続けます:', (e as Error).message);
    return false;
  }
}
