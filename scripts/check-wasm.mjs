// src/wasm/dmsim.wasm が、rust/ のソースより古くないかを確かめて、古ければ警告する(dev・batch・prob・aibench の前に自動で走る)。
//   node scripts/check-wasm.mjs
// wasm は git の管理外なので、カードやルールを取り込んだ(git pull / merge)だけでは作り直されない。
// 古い wasm は新しいカードを読めず、黙って TS 版(約 10 倍遅く、Worker ごとに約 240MB)になって、CPU とメモリを使い切る。
// 警告だけで、止めはしない(終了コードは常に 0)。
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasm = join(root, 'src', 'wasm', 'dmsim.wasm');

/** dir 以下の .rs と Cargo.toml / Cargo.lock のうち、いちばん新しい更新時刻(ms) */
function newestSource(dir) {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) t = Math.max(t, newestSource(p));
    else if (e.name.endsWith('.rs') || e.name === 'Cargo.toml' || e.name === 'Cargo.lock') t = Math.max(t, statSync(p).mtimeMs);
  }
  return t;
}

const rustDir = join(root, 'rust');
if (existsSync(rustDir)) {
  if (!existsSync(wasm)) {
    console.warn('[wasm] src/wasm/dmsim.wasm がありません。探索は TS 版(約 10 倍遅い)で動きます。npm run build:wasm で作れます。');
  } else if (statSync(wasm).mtimeMs < newestSource(join(rustDir, 'src'))) {
    console.warn(
      '[wasm] src/wasm/dmsim.wasm が rust/ のソースより古いです。新しいカードを読めず、探索が TS 版(約 10 倍遅く、CPU・メモリを使い切る)に落ちることがあります。\n' +
        '       npm run build:wasm で作り直してください。',
    );
  }
}
