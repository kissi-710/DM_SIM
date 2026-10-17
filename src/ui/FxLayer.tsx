// 演出のオーバーレイ(ターン遷移・攻撃・シールドブレイクなど)。見た目だけで、操作は妨げない(pointer-events: none)。
// 演出が無効なら何も描かない(タイマーも持たない)。判定は fx.ts の cuesOf。
import { useEffect, useRef, useState } from 'react';
import { civGradient } from './CardView';
import { tierOf, type FxCue } from './fx';

/** 表示の列の要素。同じ演出を2回積んでも別物として扱えるよう、通し番号を付ける */
interface Queued {
  key: number;
  cue: FxCue;
}

export function FxLayer({ cues, token, enabled }: { cues: FxCue[]; token: unknown; enabled: boolean }) {
  const [queue, setQueue] = useState<Queued[]>([]);
  const seq = useRef(0);
  const lastToken = useRef<unknown>(undefined);

  // 新しい手の演出を、表示の列に積む(前の演出が残っていれば、その後ろに続ける)。同じ手は一度だけ
  useEffect(() => {
    if (!enabled) {
      lastToken.current = token; // 無効の間の手は、有効に戻した時に見せない
      return;
    }
    if (lastToken.current === token) return;
    lastToken.current = token;
    if (cues.length === 0) return;
    const add = cues.map((cue) => ({ key: ++seq.current, cue }));
    setQueue((q) => (q.length > 4 ? q : q.concat(add)));
  }, [token, enabled, cues]);

  // 無効にした時は、残りをすべて捨てる
  useEffect(() => {
    if (!enabled) setQueue([]);
  }, [enabled]);

  // 先頭を、その長さだけ見せてから外す
  const head = queue[0];
  useEffect(() => {
    if (!head) return;
    const t = setTimeout(() => setQueue((q) => (q[0]?.key === head.key ? q.slice(1) : q)), head.cue.ms);
    return () => clearTimeout(t);
  }, [head?.key]);

  if (!enabled || !head) return null;
  const c = head.cue;
  const tier = tierOf(c);
  const r = c.reveal;
  return (
    <div
      key={head.key}
      className="fx-layer"
      aria-hidden="true"
      data-fx-kind={c.kind}
      data-fx-tier={tier}
      data-fx-variant={c.variant}
      style={{ animationDuration: `${c.ms}ms` }}
    >
      <div className={`fx-cue fx-${c.kind} fx-side-${c.side}${c.reveal ? ' has-reveal' : ''}`} style={{ animationDuration: `${c.ms}ms` }}>
        {r && (
          <div className="fx-reveal" style={{ animationDuration: `${Math.round(c.ms * 0.35)}ms` }}>
            <div className="fx-reveal-bar" style={{ background: civGradient(r.civs) }} />
            <div className="fx-reveal-head">
              <span className="fx-reveal-cost">{r.cost}</span>
              <span className="fx-reveal-name">{r.name}</span>
            </div>
            <div className="fx-reveal-type">
              {r.type}
              {r.power !== undefined ? ` / パワー ${r.power}` : ''}
            </div>
            <div className="fx-reveal-text">{r.text}</div>
          </div>
        )}
        <div className="fx-cue-main">
          <div className="fx-title">{c.title}</div>
          {c.sub && <div className="fx-sub">{c.sub}</div>}
        </div>
      </div>
    </div>
  );
}
