// シード付きの疑似乱数 mulberry32(エージェント・シミュレータ・テストの共通部品)。
// ゲーム状態の中の乱数(state.ts の rngNext)とは別。状態に入れない、呼び出し側の乱数に使う。

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
