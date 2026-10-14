// Rust 版エンジンを WASM にビルドして、src/wasm/dmsim.wasm に置く(無ければ TS 版で動く)。
//   npm run build:wasm
// 前提: Rust(rustup)と wasm32-unknown-unknown ターゲット(rustup target add wasm32-unknown-unknown)。
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cargoBin = join(homedir(), '.cargo', 'bin');
const env = { ...process.env, PATH: `${cargoBin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}` };
const r = spawnSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], { cwd: join(root, 'rust'), env, stdio: 'inherit', shell: false });
if (r.status !== 0) {
  console.error('cargo build に失敗しました');
  process.exit(r.status ?? 1);
}
const src = join(root, 'rust', 'target', 'wasm32-unknown-unknown', 'release', 'dmsim.wasm');
const dst = join(root, 'src', 'wasm', 'dmsim.wasm');
mkdirSync(dirname(dst), { recursive: true });
copyFileSync(src, dst);
console.log('→', dst);
