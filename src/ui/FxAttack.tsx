// 攻撃の演出: 攻撃線(赤。対象がシールドかクリーチャーかを線と札で明示)・ブロック線(緑)・
// 着弾(シールドが砕ける・バトルの火花・ダイレクトアタック)。見た目だけで、操作を妨げない。無効なら何も描かない。
// 判定は fx.ts の attackFxOf、位置は fxRects.ts(破壊されて消えた札の元の位置も、直前の描画から分かる)。
import { useRef, useState } from 'react';
import { ATK_MS, attackFxOf, scaleMs, type AttackFx, type BurstTone } from './fx';
import { center, useFxOnToken, usable, type Rects } from './fxRects';
import type { Ev } from '../engine/types';

interface Line {
  key: number;
  tone: 'attack' | 'block';
  shield: boolean;
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  delay: number;
  ms: number;
}

interface Burst {
  key: number;
  tone: BurstTone;
  n: number;
  draw: boolean;
  x: number;
  y: number;
  delay: number;
  ms: number;
}

const SHARDS: Record<BurstTone, number> = { shield: 12, clash: 10, direct: 18 };

export function FxAttack({ events, token, enabled, scale }: { events: Ev[]; token: unknown; enabled: boolean; scale: number }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const seq = useRef(0);

  useFxOnToken(token, enabled, (prev: Rects) => {
    const fx: AttackFx[] = attackFxOf(events);
    if (fx.length === 0) return;
    const addL: Line[] = [];
    const addB: Burst[] = [];
    let k = seq.current;
    for (const f of fx) {
      if (f.kind === 'line') {
        const a = prev.get(f.from);
        const b = prev.get(f.to);
        if (!usable(a) || !usable(b)) continue;
        const p = center(a);
        const q = center(b);
        addL.push({ key: ++k, tone: f.tone, shield: f.shield, label: f.label, x1: p.x, y1: p.y, x2: q.x, y2: q.y, delay: scaleMs(f.delay, scale), ms: scaleMs(ATK_MS.line, scale) });
      } else {
        const r = prev.get(f.at);
        if (!usable(r)) continue;
        const c = center(r);
        addB.push({ key: ++k, tone: f.tone, n: f.n, draw: f.draw, x: c.x, y: c.y, delay: scaleMs(f.delay, scale), ms: scaleMs(ATK_MS.burst, scale) });
      }
    }
    seq.current = k;
    if (addL.length > 0) {
      setLines((cur) => cur.concat(addL));
      for (const l of addL) setTimeout(() => setLines((cur) => cur.filter((x) => x.key !== l.key)), l.delay + l.ms + 50);
    }
    if (addB.length > 0) {
      setBursts((cur) => cur.concat(addB));
      for (const b of addB) setTimeout(() => setBursts((cur) => cur.filter((x) => x.key !== b.key)), b.delay + b.ms + 50);
    }
  });

  if (!enabled || (lines.length === 0 && bursts.length === 0)) return null;
  return (
    <div className="fx-atk" aria-hidden="true">
      <svg className="fx-atk-svg" width="100%" height="100%">
        <defs>
          <filter id="fx-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        {lines.map((l) => {
          const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
          const style = { '--len': len, animationDuration: `${l.ms}ms`, animationDelay: `${l.delay}ms` } as React.CSSProperties;
          return (
            <g key={l.key} className={`fx-line fx-line-${l.tone}`} style={style}>
              <line className="fx-line-glow" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} filter="url(#fx-glow)" />
              <line className="fx-line-core" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
              <circle className="fx-line-origin" cx={l.x1} cy={l.y1} r="7" />
              <g className="fx-reticle" transform={`translate(${l.x2} ${l.y2})`}>
                <circle r={l.shield ? 30 : 24} />
                <circle r={l.shield ? 18 : 12} />
                <path d="M-40 0H-22M22 0H40M0 -40V-22M0 22V40" />
              </g>
            </g>
          );
        })}
      </svg>
      {lines.map((l) => (
        <div
          key={'t' + l.key}
          className={`fx-line-tag fx-line-tag-${l.tone}`}
          style={{ left: l.x2, top: l.y2, animationDuration: `${l.ms}ms`, animationDelay: `${l.delay}ms` }}
        >
          {l.tone === 'block' ? 'ブロック!' : `${l.label}へ攻撃`}
        </div>
      ))}
      {bursts.map((b) => (
        <div key={b.key} className={`fx-burst fx-burst-${b.tone}`} style={{ left: b.x, top: b.y, animationDelay: `${b.delay}ms`, animationDuration: `${b.ms}ms` }}>
          <div className="fx-burst-flash" style={{ animationDelay: `${b.delay}ms`, animationDuration: `${Math.round(b.ms * 0.5)}ms` }} />
          <div className="fx-burst-ring" style={{ animationDelay: `${b.delay}ms`, animationDuration: `${b.ms}ms` }} />
          {Array.from({ length: SHARDS[b.tone] }, (_, i) => {
            const a = (360 / SHARDS[b.tone]) * i + (i % 2 ? 9 : 0);
            const d = (b.tone === 'direct' ? 110 : 70) + (i % 3) * 18;
            return (
              <span
                key={i}
                className="fx-shard"
                style={{ '--a': `${a}deg`, '--d': `${d}px`, animationDelay: `${b.delay}ms`, animationDuration: `${b.ms}ms` } as React.CSSProperties}
              />
            );
          })}
          {b.tone === 'shield' && b.n > 1 && (
            <div className="fx-burst-n" style={{ animationDelay: `${b.delay}ms`, animationDuration: `${b.ms}ms` }}>
              ×{b.n}
            </div>
          )}
          {b.tone === 'clash' && b.draw && (
            <div className="fx-burst-n" style={{ animationDelay: `${b.delay}ms`, animationDuration: `${b.ms}ms` }}>
              相打ち
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
