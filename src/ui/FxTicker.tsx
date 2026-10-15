// 軽い演出の表示(ドロー・ステップの切り替わり)。画面の端に小さく積み、それぞれ自分のタイマーで消える。
// 見た目だけで、操作・CPU の進行を待たせない。無効なら何も描かない。判定は fx.ts。
import { useEffect, useRef, useState } from 'react';
import { stepCueOf, type LightCue } from './fx';

interface Item {
  key: number;
  cue: LightCue;
}

const MAX_ITEMS = 3;

export function FxTicker({
  draws,
  drawToken,
  step,
  enabled,
}: {
  /** 直近の1手のドロー(drawCuesOf) */
  draws: LightCue[];
  /** 1手ごとに変わる値(同じ手を二重に出さない) */
  drawToken: unknown;
  /** 現在のステップ。切り替わりを検知して出す(最初の表示では出さない) */
  step: { key: string; step: string; active: number; me: number | null };
  enabled: boolean;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const seq = useRef(0);
  const lastDraw = useRef<unknown>(undefined);
  const lastStep = useRef<string | null>(null);

  const push = (cues: LightCue[]) => {
    const add = cues.map((cue) => ({ key: ++seq.current, cue }));
    setItems((cur) => cur.concat(add).slice(-MAX_ITEMS));
    // それぞれ自分のタイマーで消える(列の先頭を待たない)
    for (const a of add) setTimeout(() => setItems((cur) => cur.filter((x) => x.key !== a.key)), a.cue.ms);
  };

  useEffect(() => {
    if (!enabled) {
      lastDraw.current = drawToken;
      return;
    }
    if (lastDraw.current === drawToken) return;
    lastDraw.current = drawToken;
    if (draws.length > 0) push(draws);
  }, [drawToken, enabled]);

  useEffect(() => {
    const prev = lastStep.current;
    lastStep.current = step.key;
    if (!enabled || prev === null || prev === step.key) return;
    push([stepCueOf(step.step, step.active, step.me)]);
  }, [step.key, enabled]);

  useEffect(() => {
    if (!enabled) setItems([]);
  }, [enabled]);

  if (!enabled || items.length === 0) return null;
  return (
    <div className="fx-ticker" aria-hidden="true">
      {items.map((it) => (
        <div key={it.key} className={`fx-chip fx-chip-${it.cue.kind} fx-side-${it.cue.side}`} style={{ animationDuration: `${it.cue.ms}ms` }}>
          <span className="fx-chip-title">{it.cue.title}</span>
          {it.cue.sub && <span className="fx-chip-sub">{it.cue.sub}</span>}
        </div>
      ))}
    </div>
  );
}
