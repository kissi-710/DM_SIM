// Rust 版エンジン(WASM)の薄いラッパー。ラウンドの評価(evalRound)を、TS 版と同じ入力・同じ結果で高速に行う。
// 境界は C ABI(rust/src/ffi.rs)。JSON は UTF-8 でリニアメモリに書き、結果は f64 の配列で読む。
import type { NativeRounds, SearchEnv } from '../ai/mcts';
import type { NativePairedRound, NativeTree, TreeOpts, TreeStats } from '../ai/tree';

interface Exports {
  memory: WebAssembly.Memory;
  dm_alloc(len: number): number;
  dm_free(ptr: number, len: number): void;
  dm_error_ptr(): number;
  dm_error_len(): number;
  dm_load_registry(ptr: number, len: number): number;
  dm_begin(ptr: number, len: number): number;
  dm_rounds(seeds: number, nSeeds: number, alive: number, nAlive: number, out: number): number;
  dm_tree_begin(c: number, maxDepth: number): number;
  dm_tree_run(base: number, target: number, outVisits: number, outSums: number): number;
  dm_tree_round(seed: number, alive: number, nAlive: number, out: number): number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export class DmEngine {
  private nArms = 0;
  private constructor(private x: Exports) {}

  /** wasm のバイト列とカード定義(TS 版 registry.defs の JSON)から作る */
  static async create(wasm: BufferSource, defsJson: string): Promise<DmEngine> {
    const { instance } = await WebAssembly.instantiate(wasm, {});
    return DmEngine.init(instance, defsJson);
  }

  /** 同期版(Node の CLI・Worker 用。小さなモジュールなので同期コンパイルで足りる) */
  static createSync(wasm: BufferSource, defsJson: string): DmEngine {
    const instance = new WebAssembly.Instance(new WebAssembly.Module(wasm), {});
    return DmEngine.init(instance, defsJson);
  }

  private static init(instance: WebAssembly.Instance, defsJson: string): DmEngine {
    const e = new DmEngine(instance.exports as unknown as Exports);
    e.check(e.withBytes(enc.encode(defsJson), (p, n) => e.x.dm_load_registry(p, n)));
    return e;
  }

  /**
   * mcts.ts の setNativeRounds に渡す関数にする。同じ env(同一のオブジェクト)の間は、
   * 入力の登録(JSON の受け渡し)を1度だけ行う。
   */
  asNativeRounds(): NativeRounds {
    let last: SearchEnv | null = null;
    return (env, seed, alive) => {
      if (env !== last) {
        this.begin(env);
        last = env;
      }
      return this.rounds([seed], alive)[0];
    };
  }

  /**
   * tree.ts の setNativeTree に渡す関数にする。同じ env・同じ種・同じ設定の間は、木を保って続きから反復する
   * (時間主導の探索が、反復を増やしながら呼んでも、やり直さない)。
   */
  asNativeTree(): NativeTree {
    let last: SearchEnv | null = null;
    let lastBase = -1;
    let lastO: TreeOpts | null = null;
    let arms = 0;
    return (env, base, iterations, o) => {
      if (env !== last || base !== lastBase || lastO === null || lastO.c !== o.c || lastO.maxDepth !== o.maxDepth) {
        this.begin(env);
        arms = this.check(this.x.dm_tree_begin(o.c, o.maxDepth));
        last = env;
        lastBase = base;
        lastO = o;
      }
      return this.treeRun(base, iterations, arms);
    };
  }

  /**
   * tree.ts の setNativePairedRound に渡す関数にする(ペア比較の木の1ラウンド)。
   * 同じ env・設定の間は、木を保つ(env が変わったら作り直す)。
   */
  asNativePairedRound(): NativePairedRound {
    let last: SearchEnv | null = null;
    let lastO: TreeOpts | null = null;
    let arms = 0;
    return (env, seed, alive, o) => {
      if (env !== last || lastO === null || lastO.c !== o.c || lastO.maxDepth !== o.maxDepth) {
        this.begin(env);
        arms = this.check(this.x.dm_tree_begin(o.c, o.maxDepth));
        last = env;
        lastO = o;
      }
      const align = (p: number, a: number) => (p + a - 1) & ~(a - 1);
      const rawA = this.x.dm_alloc(alive.length * 4 + 4);
      const rawO = this.x.dm_alloc(arms * 8 + 8);
      const pA = align(rawA, 4);
      const pO = align(rawO, 8);
      try {
        new Uint32Array(this.x.memory.buffer, pA, alive.length).set(alive);
        this.check(this.x.dm_tree_round(seed >>> 0, pA, alive.length, pO));
        return Array.from(new Float64Array(this.x.memory.buffer, pO, arms));
      } finally {
        this.x.dm_free(rawA, alive.length * 4 + 4);
        this.x.dm_free(rawO, arms * 8 + 8);
      }
    };
  }

  private treeRun(base: number, target: number, arms: number): TreeStats {
    const align = (p: number, a: number) => (p + a - 1) & ~(a - 1);
    const rawV = this.x.dm_alloc(arms * 4 + 4);
    const rawS = this.x.dm_alloc(arms * 8 + 8);
    const pV = align(rawV, 4);
    const pS = align(rawS, 8);
    try {
      this.check(this.x.dm_tree_run(base >>> 0, target, pV, pS));
      return {
        visits: Array.from(new Uint32Array(this.x.memory.buffer, pV, arms)),
        sums: Array.from(new Float64Array(this.x.memory.buffer, pS, arms)),
      };
    } finally {
      this.x.dm_free(rawV, arms * 4 + 4);
      this.x.dm_free(rawS, arms * 8 + 8);
    }
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
