// シード付きの疑似乱数 mulberry32(エージェント・シミュレータ・テストの共通部品)。
// ゲーム状態の中の乱数(state.ts の rngNext)とは別。状態に入れない、呼び出し側の乱数に使う。

/**
 * 実行のシード(base)と、試合・試行の番号(index)から、その試合・試行のシードを作る。
 * base を混ぜてから index を足すので、base が違う実行は、シードの範囲が重ならない
 * (base + index だと、seed=1 と seed=2 の実行が、ほとんど同じ試合になる)。
 * 範囲を分けて並列に実行しても、index が同じなら同じシードになる(統合結果が直列と一致する)。
 */
export function deriveSeed(base: number, index: number): number {
  let x = (base | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x + index) | 0;
}

/** seed から、0 以上 1 未満の乱数を返す関数を作る */
export function mulberry(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
