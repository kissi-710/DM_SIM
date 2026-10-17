// 演出のための「位置の記憶」。盤面の各要素の矩形を、描画のたびに測っておく。
// 新しい手が来た描画では、上書きする前(=直前の描画)の位置を使える。破壊されて消えたカードや、
// 攻撃で向きの変わったクリーチャーの「元の位置」を、演出が知るために使う。見た目だけで、状態には触れない。
import { useLayoutEffect, useRef } from 'react';

/** キー: `uid:カード` / `pid:クリーチャー(山)` / `zone:ゾーン:プレイヤー`(grave・hand・mana・shield) */
export type Rects = Map<string, DOMRect>;

export function measureAll(): Rects {
  const m: Rects = new Map();
  for (const el of document.querySelectorAll<HTMLElement>('.board [data-uid]')) {
    const k = `uid:${el.dataset.uid}`;
    if (!m.has(k)) m.set(k, el.getBoundingClientRect());
  }
  for (const el of document.querySelectorAll<HTMLElement>('.board [data-drop]')) {
    const mm = /^(?:opp-)?pile:(\d+)$/.exec(el.dataset.drop ?? '');
    if (mm) m.set(`pid:${mm[1]}`, el.getBoundingClientRect());
  }
  for (const el of document.querySelectorAll<HTMLElement>('.board [data-zone]')) {
    const k = `zone:${el.dataset.zone}`;
    if (!m.has(k)) m.set(k, el.getBoundingClientRect());
  }
  return m;
}

/** 矩形が使えるか(描かれていて大きさがある) */
export function usable(r: DOMRect | undefined): r is DOMRect {
  return !!r && r.width > 0 && r.height > 0;
}

export function center(r: DOMRect): { x: number; y: number } {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * 描画のたびに位置を測り、`token` が変わった描画では、直前の描画の位置を `onNew` に渡す(演出が有効な時だけ)。
 * 同じ token では一度しか呼ばない(StrictMode の二重実行でも)。
 */
export function useFxOnToken(token: unknown, enabled: boolean, onNew: (prev: Rects) => void): void {
  const rects = useRef<Rects>(new Map());
  const last = useRef<unknown>(undefined);
  useLayoutEffect(() => {
    const prev = rects.current;
    if (last.current !== token) {
      last.current = token;
      if (enabled) onNew(prev);
    }
    rects.current = measureAll();
  });
}
