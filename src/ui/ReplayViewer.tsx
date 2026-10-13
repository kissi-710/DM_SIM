// 状態列の再生(パターン調査の履歴・対戦の棋譜)。対戦画面の盤面を再利用する(spec 6.5)。
import { useEffect, useMemo, useState } from 'react';
import type { Ev, GameState } from '../engine/types';
import { Board } from './Board';
import { CardDetail, LogPanel, PoolPanel } from './GameView';
import { describeEvent } from './format';

export function ReplayViewer({
  states,
  events,
  title,
  me = 0,
  showOppHand = false,
  peek = true,
  onClose,
}: {
  states: GameState[];
  events: Ev[][];
  title: string;
  me?: 0 | 1 | null;
  showOppHand?: boolean;
  peek?: boolean;
  onClose?: () => void;
}) {
  const [i, setI] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const last = states.length - 1;
  const s = states[Math.min(i, last)];

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setI((cur) => {
        if (cur >= last) {
          setPlaying(false);
          return cur;
        }
        return cur + 1;
      });
    }, 700);
    return () => clearInterval(t);
  }, [playing, last]);

  // ターンの先頭の位置(ジャンプ用)
  const turnStarts = useMemo(() => {
    const out: { idx: number; label: string }[] = [];
    let prev = -1;
    states.forEach((st, k) => {
      const t = st.turn;
      if (t !== prev) {
        out.push({ idx: k, label: `${Math.ceil(t / 2)}T${st.active === 0 ? '(自)' : '(相)'}` });
        prev = t;
      }
    });
    return out;
  }, [states]);

  const log = useMemo(() => events.slice(0, i + 1).flat(), [events, i]);
  const nowEvents = (events[i] ?? []).map((e) => describeEvent(s, e, me)).filter((x): x is string => !!x);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" style={{ width: 'min(1200px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{title}</h2>
          {onClose && <button onClick={onClose}>閉じる</button>}
        </div>
        <div className="row">
          <button disabled={i <= 0} onClick={() => setI(0)}>
            ⏮
          </button>
          <button disabled={i <= 0} onClick={() => setI(i - 1)}>
            ◀
          </button>
          <button onClick={() => setPlaying(!playing)}>{playing ? '⏸' : '▶ 再生'}</button>
          <button disabled={i >= last} onClick={() => setI(i + 1)}>
            ▶
          </button>
          <input type="range" min={0} max={last} value={i} onChange={(e) => setI(Number(e.target.value))} style={{ flex: 1, minWidth: 160 }} />
          <span className="muted">
            {i} / {last}
          </span>
        </div>
        <div className="row" style={{ margin: '6px 0' }}>
          {turnStarts.map((t) => (
            <button key={t.idx} className={'small' + (i >= t.idx ? '' : '')} onClick={() => setI(t.idx)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="status-chip" style={{ marginBottom: 6 }}>
          {Math.ceil(s.turn / 2)}ターン目 / {s.step}
          {nowEvents.length > 0 && <span className="muted"> — {nowEvents.slice(0, 3).join(' / ')}</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: 8, maxHeight: '60vh' }}>
          <div style={{ overflow: 'auto', minHeight: 0 }}>
            <Board
              s={s}
              me={me}
              legal={[]}
              interactive={false}
              onAction={() => {}}
              onHover={setHover}
              peek={peek}
              showOppHand={showOppHand}
              selected={null}
              onSelect={() => {}}
            />
          </div>
          <div className="col" style={{ overflow: 'auto' }}>
            <div className="box panel">
              <CardDetail s={s} uid={hover} />
            </div>
            <PoolPanel s={s} />
            <LogPanel s={s} log={log} me={me} />
          </div>
        </div>
      </div>
    </div>
  );
}
