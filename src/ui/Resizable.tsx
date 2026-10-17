// 触って動かせる境界: 盤面の上に重ねるパネル(入力・ログ)の「移動・8方向のサイズ変更」と、盤面と右レールの間の仕切り。
// 位置とサイズは localStorage に残し、ダブルクリックで元に戻す。
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { loadJson, saveJson } from './util';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;

function isBox(b: unknown): b is Box {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  return (['x', 'y', 'w', 'h'] as const).every((k) => typeof o[k] === 'number' && Number.isFinite(o[k]));
}

/** パネルを、親の中に収める(幅・高さは最小〜親の大きさ、位置は親の内側) */
export function clampBox(b: Box, pw: number, ph: number, minW: number, minH: number): Box {
  const w = Math.min(Math.max(b.w, minW), Math.max(pw, 1));
  const h = Math.min(Math.max(b.h, minH), Math.max(ph, 1));
  return { w, h, x: Math.min(Math.max(b.x, 0), Math.max(pw - w, 0)), y: Math.min(Math.max(b.y, 0), Math.max(ph - h, 0)) };
}

/** つまんだ辺・角(dir)と移動量から、新しい箱を作る。'move' は位置だけ動かす */
export function dragBox(start: Box, dir: string, dx: number, dy: number, minW: number, minH: number): Box {
  let { x, y, w, h } = start;
  if (dir === 'move') {
    x += dx;
    y += dy;
  } else {
    if (dir.includes('e')) w += dx;
    if (dir.includes('s')) h += dy;
    if (dir.includes('w')) {
      x += dx;
      w -= dx;
    }
    if (dir.includes('n')) {
      y += dy;
      h -= dy;
    }
    // 最小より小さくはしない(左・上の辺をつまんだ時は、反対側の辺を動かさない)
    if (w < minW) {
      if (dir.includes('w')) x -= minW - w;
      w = minW;
    }
    if (h < minH) {
      if (dir.includes('n')) y -= minH - h;
      h = minH;
    }
  }
  return { x, y, w, h };
}

interface PanelProps {
  /** 位置・サイズの保存先(localStorage のキー) */
  boxKey: string;
  className: string;
  /** つまみ(ドラッグで移動する帯)に出す文字 */
  title?: string;
  onClose?: () => void;
  label?: string;
  minW?: number;
  minH?: number;
  children: ReactNode;
}

export function ResizablePanel({ boxKey, className, title, onClose, label, minW = 260, minH = 110, children }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(() => {
    const b = loadJson<unknown>(boxKey, null);
    return isBox(b) ? b : null; // 形の違う保存は捨てる(位置・大きさが NaN になって、パネルが消えないように)
  });
  const drag = useRef<{ dir: string; start: Box; sx: number; sy: number; pw: number; ph: number; last: Box } | null>(null);

  /** パネルの座標系(位置を決める親)の大きさ。位置は親の左上からの距離で持つ */
  const parentRect = () => {
    const el = ref.current;
    const p = (el?.offsetParent as HTMLElement | null) ?? el?.parentElement ?? null;
    return p ? p.getBoundingClientRect() : null;
  };

  // 画面の大きさが変わっても、パネルが見えない所に行かないようにする
  useLayoutEffect(() => {
    const fit = () => {
      const p = parentRect();
      if (!p || p.width === 0) return;
      setBox((cur) => (cur ? clampBox(cur, p.width, p.height, minW, minH) : cur));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [minW, minH]);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    const grip = (e.target as HTMLElement).closest<HTMLElement>('[data-dir]');
    if (!grip || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const el = ref.current;
    const p = parentRect();
    if (!el || !p) return;
    const r = el.getBoundingClientRect();
    const start = { x: r.left - p.left, y: r.top - p.top, w: r.width, h: r.height };
    drag.current = { dir: grip.dataset.dir!, start, sx: e.clientX, sy: e.clientY, pw: p.width, ph: p.height, last: start };
    grip.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    setBox(start); // 自動配置(中央など)から、位置を持つ配置に切り替える。見た目は動かない
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const next = clampBox(dragBox(d.start, d.dir, e.clientX - d.sx, e.clientY - d.sy, minW, minH), d.pw, d.ph, minW, minH);
    d.last = next;
    setBox(next);
  };
  const onUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    saveJson(boxKey, d.last);
  };
  const reset = () => {
    setBox(null);
    saveJson(boxKey, null);
  };

  return (
    <div
      ref={ref}
      role="group"
      aria-label={label ?? title}
      className={'rzp ' + className}
      style={box ? { position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, maxWidth: 'none', maxHeight: 'none' } : undefined}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div className="rzp-head">
        <div className="rzp-grip" data-dir="move" title="ドラッグで移動(ダブルクリックでリセット)" onDoubleClick={reset}>
          ⠿ {title}
        </div>
        {onClose && (
          <button className="small" onClick={onClose} aria-label="閉じる" title="閉じる">
            ✕
          </button>
        )}
      </div>
      <div className="rzp-body">{children}</div>
      {DIRS.map((d) => (
        <div key={d} className={'rz rz-' + d} data-dir={d} aria-hidden="true" onDoubleClick={reset} />
      ))}
    </div>
  );
}

/**
 * 盤面と右レールの間の仕切り。つまんで左右に動かすと、レールの幅が変わる(仕切りがポインタに付いてくる)。
 * 盤面(field)は広い画面でも FIELD_MAX までは広がり(styles.css の .stage と同じ値)、それを超えた分だけ左右の余白にして中央に寄せている。
 */
export const FIELD_MAX = 1600;
export const RAIL_MIN = 220;
export const RAIL_MAX = 560;
export const RAIL_DEFAULT = 300;

/**
 * 仕切りの中心が stage の左端から x にある時の、レールの幅。
 * 盤面が上限に達していない間は、仕切りの左がすべて盤面なので、レール = stage - x - gap/2。
 * 上限を超える間は、盤面を FIELD_MAX に保ち、余白を左右に分けるので、x = (stage + FIELD_MAX - レール) / 2 から逆算する。
 */
export function railWidthFor(stageW: number, x: number, gap = 10): number {
  const r = x - gap / 2 <= FIELD_MAX ? stageW - x - gap / 2 : stageW + FIELD_MAX - 2 * x;
  return Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(r)));
}

export function useRailWidth(): [number, (w: number) => void] {
  const [w, setW] = useState<number>(() => {
    const v = loadJson<number>('dmsim.railW', RAIL_DEFAULT);
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(RAIL_MAX, Math.max(RAIL_MIN, v)) : RAIL_DEFAULT;
  });
  useEffect(() => {
    saveJson('dmsim.railW', w);
  }, [w]);
  return [w, setW];
}

export function Splitter({ width, onChange, stageRef }: { width: number; onChange: (w: number) => void; stageRef: React.RefObject<HTMLElement | null> }) {
  const dragging = useRef(false);
  const down = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const st = stageRef.current?.getBoundingClientRect();
    if (!dragging.current || !st) return;
    onChange(railWidthFor(st.width, e.clientX - st.left));
  };
  const up = () => {
    dragging.current = false;
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    // 盤面のカードを選ぶ矢印キー(window)に渡さない
    e.preventDefault();
    e.stopPropagation();
    onChange(Math.min(RAIL_MAX, Math.max(RAIL_MIN, width + (e.key === 'ArrowLeft' ? 20 : -20))));
  };
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="盤面と右の欄の境界(左右キーで幅を変える)"
      aria-valuenow={width}
      aria-valuemin={RAIL_MIN}
      aria-valuemax={RAIL_MAX}
      tabIndex={0}
      title="ドラッグで幅を変更(ダブルクリックでリセット)"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      onDoubleClick={() => onChange(RAIL_DEFAULT)}
    />
  );
}
