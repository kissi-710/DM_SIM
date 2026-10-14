// Rust 版エンジンの差分テストを、1コマンドで実行する(TS 版が基準)。
//   npm run test:rust
// 1. TS 版で、正解データ(状態 → 合法手 → 行動の列)を rust/fixtures/games.json に書き出す
// 2. rust/ で cargo test --release を実行する(フィクスチャが無いとテストがスキップされるので、必ず先に作る)
// 前提: Rust(rustup)。Windows(MSVC なし)では GNU ツールチェーンと w64devkit の gcc を使い、
// libgcc_eh の空のスタブを作って RUSTFLAGS で渡す(docs/ai-speed-and-strength.md)。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const extra = [join(homedir(), '.cargo', 'bin')];
if (win && existsSync('C:\\w64devkit\\bin')) extra.push('C:\\w64devkit\\bin');
const env = { ...process.env, PATH: [...extra, process.env.PATH].join(delimiter) };

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: 'inherit', env, shell: win && cmd === 'npx', ...opts });

// 1. 正解データ
console.log('■ 正解データを書き出す(TS 版)');
let r = run('npx', ['tsx', 'scripts/dump-fixtures.ts', 'rust/fixtures/games.json'], { cwd: root });
if (r.status !== 0) process.exit(r.status ?? 1);

// cargo があるか
const probe = spawnSync('cargo', ['--version'], { env, encoding: 'utf8' });
if (probe.status !== 0) {
  console.error('cargo が見つかりません(Rust をインストールしてください)。正解データだけ書き出しました。');
  process.exit(1);
}

// Windows(GNU): libgcc_eh の空のスタブ
if (win) {
  const stub = join(root, 'rust', 'target', 'gcc_eh-stub');
  if (!existsSync(join(stub, 'libgcc_eh.a'))) {
    mkdirSync(stub, { recursive: true });
    const ar = spawnSync('ar', ['rcs', 'libgcc_eh.a'], { cwd: stub, env, stdio: 'inherit' });
    if (ar.status !== 0) console.error('警告: libgcc_eh のスタブを作れませんでした(ar が見つかりません)。リンクに失敗するかもしれません');
  }
  env.RUSTFLAGS = `${env.RUSTFLAGS ? env.RUSTFLAGS + ' ' : ''}-L ${stub}`;
}

// 2. 差分テスト
console.log('■ cargo test --release(Rust 版 と TS 版の差分テスト)');
r = run('cargo', ['test', '--release'], { cwd: join(root, 'rust') });
process.exit(r.status ?? 1);
