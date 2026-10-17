// カードがフィールドなどから離れた時(破壊・バウンスなど)の「ゴースト」。
// 離れたカードの元の位置に、カードの影を出し、行き先(墓地・手札・マナ)へ縮みながら飛ばす。一瞬で消える。
// 元の位置は、直前の描画で測っておいた各カード(data-uid)の矩形を使う。見た目だけで、操作を妨げない。無効なら何も描かない。
import { useLayoutEffect, useRef, useState } from 'react';
import { useFxOnToken, type Rects } from './fxRects';
import type { GameState } from '../engine/types';
import { civGradient } from './CardView';
import { GHOST_MS, scaleMs, type Removal } from './fx';
import { cardName, civsOf } from './format';

interface Ghost {
  key: number;
  name: string;
  civs: string[];
  label: string;
  left: number;
  top: number;
  w: number;
  h: number;
  dx: number;
  dy: number;
  ms: number;
}

const MAX_GHOSTS = 8;

/** 行き先の要素(盤面の data-zone)。見つからなければ null(その場で縮んで消える) */
function targetRect(r: Removal): DOMRect | null {
  const zone = r.to === 'grave' ? 'grave' : r.to === 'hand' ? 'hand' : r.to === 'mana' ? 'mana' : null;
  if (!zone) return null;
  const el = document.querySelector<HTMLElement>(`[data-zone="${zone}:${r.owner}"]`);
  return el ? el.getBoundingClientRect() : null;
}

export function FxGhosts({ s, removals, token, enabled, scale }: { s: GameState; removals: Removal[]; token: unknown; enabled: boolean; scale: number }) {
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const seq = useRef(0);

  // 新しい手が来た描画で、直前の描画の位置(離れたカードの元の位置)から、行き先へ飛ばす
  useFxOnToken(token, enabled, (prev: Rects) => {
    if (removals.length === 0) return;
    const add: Ghost[] = [];
    for (const r of removals.slice(0, MAX_GHOSTS)) {
      const from = prev.get(`uid:${r.uid}`);
      if (!from || from.width === 0) continue;
      const to = targetRect(r);
      const dx = to ? to.left + to.width / 2 - (from.left + from.width / 2) : 0;
      const dy = to ? to.top + to.height / 2 - (from.top + from.height / 2) : 0;
      add.push({
        key: ++seq.current,
        name: cardName(s, r.uid),
        civs: civsOf(s, r.uid),
        label: r.label,
        left: from.left,
        top: from.top,
        w: from.width,
        h: from.height,
        dx,
        dy,
        ms: scaleMs(GHOST_MS, scale),
      });
    }
    if (add.length > 0) {
      setGhosts((cur) => cur.concat(add));
      for (const gh of add) setTimeout(() => setGhosts((cur) => cur.filter((x) => x.key !== gh.key)), gh.ms + 50);
    }
  });

  useLayoutEffect(() => {
    if (!enabled) setGhosts([]);
  }, [enabled]);

  if (!enabled || ghosts.length === 0) return null;
  return (
    <div className="fx-ghosts" aria-hidden="true">
      {ghosts.map((g) => (
        <div
          key={g.key}
          className={'fx-ghost' + (g.label === '破壊' ? ' destroy' : '')}
          style={
            {
              left: g.left,
              top: g.top,
              width: g.w,
              height: g.h,
              animationDuration: `${g.ms}ms`,
              '--dx': `${g.dx}px`,
              '--dy': `${g.dy}px`,
            } as React.CSSProperties
          }
        >
          <div className="fx-ghost-bar" style={{ background: civGradient(g.civs) }} />
          <div className="fx-ghost-name">{g.name}</div>
          <div className="fx-ghost-label">{g.label}</div>
        </div>
      ))}
    </div>
  );
}
