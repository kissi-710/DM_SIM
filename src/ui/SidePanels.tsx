// 対戦画面の右の欄に出す、待機中の能力とログ(因果ツリー)。
import { useEffect, useMemo, useRef } from 'react';
import { entryLabel } from '../engine/procs';
import { mkCtx } from '../engine/state';
import type { GameState } from '../engine/types';
import { buildLogTree, reg, type LogNode } from './format';
import type { Session } from './useGame';

function LogTree({ nodes, depth = 0 }: { nodes: LogNode[]; depth?: number }) {
  return (
    <>
      {nodes.map((n) => (
        <div key={n.id} className={depth > 0 ? 'log-node' : ''}>
          <div className={n.heading ? 'log-heading' : 'log-line'}>
            {n.tag && <span className={'tag' + (n.tag === '自動' ? ' auto' : '')}>{n.tag}</span>} {n.text}
          </div>
          {n.children.length > 0 && <LogTree nodes={n.children} depth={depth + 1} />}
        </div>
      ))}
    </>
  );
}

export function PoolPanel({ s }: { s: GameState }) {
  const c = mkCtx(s, reg);
  const resolving = s.cont.filter((f) => f.kind === 'effect').slice(-1)[0];
  return (
    <div className="box">
      <h3>待機中の能力({s.pool.length})</h3>
      {resolving && resolving.kind === 'effect' && (
        <div className="pool-item" style={{ borderLeft: '3px solid var(--good)' }}>
          解決中: {reg.defs[resolving.lki.defId]?.name}
        </div>
      )}
      {s.pool.length === 0 && !resolving && <div className="muted">なし</div>}
      {s.pool.map((e) => (
        <div key={e.id} className={'pool-item' + (e.stLayer ? ' st' : '')}>
          {entryLabel(c, e)}
        </div>
      ))}
    </div>
  );
}

export function LogPanel({ s, log, me }: { s: GameState; log: Session['log']; me: number | null }) {
  const nodes = useMemo(() => buildLogTree(s, log.slice(-500), me), [s, log, me]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [log.length]);
  return (
    <div className="box" style={{ flex: 1, minHeight: 120, display: 'flex', flexDirection: 'column' }}>
      <h3>対戦ログ(因果ツリー)</h3>
      <div ref={ref} style={{ overflow: 'auto', flex: 1 }}>
        <LogTree nodes={nodes} />
      </div>
    </div>
  );
}
