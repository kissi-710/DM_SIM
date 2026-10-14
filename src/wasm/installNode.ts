// Node(CLI・worker_threads)で、ラウンドの評価を Rust 版(WASM)に切り替える。
// 既定: src/wasm/dmsim.wasm(npm run build:wasm で作る)があれば使う。無ければ TS 版のまま。
//   DM_WASM=<パス>  別の wasm を使う
//   DM_WASM=off     Rust 版を使わない(TS 版で動かす。比較・切り分け用)
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CARD_DB } from '../cards';
import { setNativeRounds } from '../ai/mcts';
import { setNativePairedRound, setNativeTree } from '../ai/tree';
import { loadRegistry } from '../engine/registry';
import { DmEngine } from './dmEngine';

let installed = false;

/** 既定の wasm の場所(リポジトリの src/wasm/dmsim.wasm) */
const DEFAULT_WASM = fileURLToPath(new URL('./dmsim.wasm', import.meta.url));

export function installNativeFromEnv(): boolean {
  if (installed) return true;
  const env = process.env.DM_WASM;
  if (env === 'off') return false;
  const path = env || DEFAULT_WASM;
  if (!existsSync(path)) return false;
  try {
    const reg = loadRegistry(CARD_DB);
    const eng = DmEngine.createSync(readFileSync(path), JSON.stringify(reg.defs));
    setNativeRounds(eng.asNativeRounds());
    setNativeTree(eng.asNativeTree());
    setNativePairedRound(eng.asNativePairedRound());
    installed = true;
    return true;
  } catch (e) {
    console.error('Rust 版エンジン(WASM)を読み込めませんでした。TS 版で続けます:', (e as Error).message);
    return false;
  }
}
