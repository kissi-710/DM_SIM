// ポインタイベントによるドラッグ(マウス・タッチ共通)。ドロップ先は data-drop 属性で判定する。
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';

export interface DragState {
  key: string;
  x: number;
  y: number;
  over: string | null;
}

interface Opts {
  /** ドラッグ開始 */
  onStart?: (key: string) => void;
  /** ドロップ(ドロップ先の data-drop の値。無ければ null) */
  onDrop: (key: string, dropKey: string | null) => void;
  /** 動かさずに離した場合(クリック扱い) */
  onClick?: (key: string) => void;
}

const THRESHOLD = 6;

export function useDrag(o: Opts) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const info = useRef<{ key: string; sx: number; sy: number; moved: boolean; id: number } | null>(null);
  const opts = useRef(o);
  opts.current = o;

  const dropAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const t = el?.closest('[data-drop]') as HTMLElement | null;
    return t?.getAttribute('data-drop') ?? null;
  };

  useEffect(() => {
    const move = (e: globalThis.PointerEvent) => {
      const i = info.current;
      if (!i) return;
      if (!i.moved && Math.hypot(e.clientX - i.sx, e.clientY - i.sy) < THRESHOLD) return;
      if (!i.moved) {
        i.moved = true;
        opts.current.onStart?.(i.key);
      }
      setDrag({ key: i.key, x: e.clientX, y: e.clientY, over: dropAt(e.clientX, e.clientY) });
    };
    const up = (e: globalThis.PointerEvent) => {
      const i = info.current;
      if (!i) return;
      info.current = null;
      if (i.moved) {
        const target = dropAt(e.clientX, e.clientY);
        setDrag(null);
        opts.current.onDrop(i.key, target);
      } else {
        opts.current.onClick?.(i.key);
      }
    };
    const cancel = () => {
      info.current = null;
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  }, []);

  const begin = useCallback((key: string) => {
    return (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      info.current = { key, sx: e.clientX, sy: e.clientY, moved: false, id: e.pointerId };
    };
  }, []);

  return { drag, begin };
}
