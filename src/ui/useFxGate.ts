// 演出が終わるまで、質問(入力パネル)を出さない門。演出の途中に選択画面が割り込まないようにする(見た目だけ。状態は変わらない)。
import { useEffect, useState } from 'react';

/**
 * `token`(1手ごとに変わる値)の手の演出が `holdMs` かかる間は false、終わったら true。
 * holdMs が 0(演出が無効・演出がない手)なら、最初から true で、待たない(描画のたびの1フレームも出さない)。
 */
export function useFxGate(holdMs: number, token: unknown): boolean {
  const [readyFor, setReadyFor] = useState<unknown>(null);
  useEffect(() => {
    if (holdMs === 0) return;
    const timer = setTimeout(() => setReadyFor(token), holdMs);
    return () => clearTimeout(timer);
  }, [token, holdMs]);
  return holdMs === 0 || readyFor === token;
}
