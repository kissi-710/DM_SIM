// 棋譜({seed, decks, first, actions[]})の読み込みと再生(design 10 / spec 3.13 の再現性)。
import { useState } from 'react';
import { ReplayViewer } from './ReplayViewer';
import { replayRecord, type GameRecord } from './useGame';
import { loadJson } from './util';
import type { Ev, GameState } from '../engine/types';

export function ReplayScreen() {
  const [text, setText] = useState('');
  const [view, setView] = useState<{ title: string; states: GameState[]; events: Ev[][] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const saved = loadJson<{ at: number; rec: GameRecord }[]>('dmsim.records', []);

  const open = (rec: GameRecord) => {
    try {
      const r = replayRecord(rec);
      setView({ title: `棋譜の再生(シード ${rec.seed} / ${rec.actions.length}手)`, states: r.states, events: r.events });
      setErr(null);
    } catch (e: any) {
      setErr('再生できません: ' + String(e?.message ?? e));
    }
  };

  return (
    <div className="page">
      <div className="menu">
        <h2>棋譜の再生</h2>
        <p className="muted">対戦画面の「棋譜」から保存した JSON を読み込むと、同じ試合を最初から再現して、1手ずつ確認できます。</p>
        <div className="panel col">
          <textarea className="json" value={text} onChange={(e) => setText(e.target.value)} placeholder="棋譜のJSONを貼り付け" />
          <div className="row">
            <button
              className="primary"
              onClick={() => {
                try {
                  open(JSON.parse(text));
                } catch (e: any) {
                  setErr('JSONを読み込めません: ' + e.message);
                }
              }}
            >
              再生する
            </button>
            <label>
              <input
                type="file"
                accept="application/json"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setText(await f.text());
                }}
              />
            </label>
          </div>
          {err && <span style={{ color: 'var(--bad)' }}>{err}</span>}
        </div>
        <div className="panel col">
          <h3>ブラウザに保存した棋譜</h3>
          {saved.length === 0 && <span className="muted">まだありません。</span>}
          {saved
            .slice()
            .reverse()
            .map((s, i) => (
              <div key={i} className="deck-line">
                <span className="nm">
                  {new Date(s.at).toLocaleString('ja-JP')} / シード {s.rec.seed} / {s.rec.actions.length}手
                </span>
                <button className="small" onClick={() => open(s.rec)}>
                  再生
                </button>
              </div>
            ))}
        </div>
      </div>
      {view && <ReplayViewer title={view.title} states={view.states} events={view.events} me={null} showOppHand peek onClose={() => setView(null)} />}
    </div>
  );
}
