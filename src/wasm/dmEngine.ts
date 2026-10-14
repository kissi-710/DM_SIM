// Rust 版エンジン(WASM)の薄いラッパー。ラウンドの評価(evalRound)を、TS 版と同じ入力・同じ結果で高速に行う。
// 境界は C ABI(rust/src/ffi.rs)。JSON は UTF-8 でリニアメモリに書き、結果は f64 の配列で読む。
import type { SearchEnv } from '../ai/mcts';

interface Exports {
  memory: WebAssembly.Memory;
  dm_alloc(len: number): number;
  dm_free(ptr: number, len: number): void;
  dm_error_ptr(): number;
  dm_error_len(): number;
  dm_load_registry(ptr: number, len: number): number;
  dm_begin(ptr: number, len: number): number;
  dm_rounds(seeds: number, nSeeds: number, alive: number, nAlive: number, out: number): number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export class DmEngine {
  private nArms = 0;
  private constructor(private x: Exports) {}

  /** wasm のバイト列とカード定義(TS 版 registry.defs の JSON)から作る */
  static async create(wasm: BufferSource, defsJson: string): Promise<DmEngine> {
    const { instance } = await WebAssembly.instantiate(wasm, {});
    const e = new DmEngine(instance.exports as unknown as Exports);
    e.check(e.withBytes(enc.encode(defsJson), (p, n) => e.x.dm_load_registry(p, n)));
    return e;
  }

  private mem(): Uint8Array {
    return new Uint8Array(this.x.memory.buffer);
  }

  private check(code: number): number {
    if (code < 0) {
      const p = this.x.dm_error_ptr();
      const n = this.x.dm_error_len();
      throw new Error('Rust エンジン: ' + dec.decode(this.mem().slice(p, p + n)));
    }
    return code;
  }

  private withBytes<T>(bytes: Uint8Array, f: (ptr: number, len: number) => T): T {
    const ptr = this.x.dm_alloc(bytes.length);
    this.mem().set(bytes, ptr);
    try {
      return f(ptr, bytes.length);
    } finally {
      this.x.dm_free(ptr, bytes.length);
    }
  }

  /** 探索の入力を登録する。手の数を返す */
  begin(env: SearchEnv): number {
    const n = this.check(this.withBytes(enc.encode(JSON.stringify(env)), (p, len) => this.x.dm_begin(p, len)));
    this.nArms = n;
    return n;
  }

  /** seeds ごとのラウンドを alive の手について評価する(評価できなかった手は NaN)。rows[i][k] */
  rounds(seeds: number[], alive: number[]): number[][] {
    const nS = seeds.length;
    const nA = this.nArms;
    const align = (p: number, a: number) => (p + a - 1) & ~(a - 1);
    const rawS = this.x.dm_alloc(nS * 4 + 4);
    const rawA = this.x.dm_alloc(alive.length * 4 + 4);
    const rawO = this.x.dm_alloc(nS * nA * 8 + 8);
    const pS = align(rawS, 4);
    const pA = align(rawA, 4);
    const pO = align(rawO, 8);
    try {
      new Uint32Array(this.x.memory.buffer, pS, nS).set(seeds.map((s) => s >>> 0));
      new Uint32Array(this.x.memory.buffer, pA, alive.length).set(alive);
      this.check(this.x.dm_rounds(pS, nS, pA, alive.length, pO));
      const out = new Float64Array(this.x.memory.buffer, pO, nS * nA);
      const rows: number[][] = [];
      for (let i = 0; i < nS; i++) rows.push(Array.from(out.subarray(i * nA, (i + 1) * nA)));
      return rows;
    } finally {
      this.x.dm_free(rawS, nS * 4 + 4);
      this.x.dm_free(rawA, alive.length * 4 + 4);
      this.x.dm_free(rawO, nS * nA * 8 + 8);
    }
  }
}
