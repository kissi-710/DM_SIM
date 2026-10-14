// バッチ対戦画面(spec 7): AI同士の対戦を Worker で実行し、勝率・先攻後攻別・情報条件の比較・カードの強さを出す。
import { useRef, useState } from 'react';
import { AGENT_LABEL, type AgentKind, type AgentSpec } from '../ai';
import { INFO_PRESET_LABEL, type InfoPolicy, type InfoPreset } from '../engine/view';
import { pct } from '../sim/export';
import type { FirstMode, MatchStats } from '../sim/batch';
import type { CardStrength } from '../sim/strength';
import { allDecks, findDeck } from './decks';
import { runSimJob, type RunningJob } from './simClient';
import { downloadText } from './util';

/** カード単体の強さは、デッキの全種類ぶん対戦するので、指定の試合数をこの数までに制限する */
const STRENGTH_MAX_GAMES = 300;

function policyOf(preset: InfoPreset): InfoPolicy {
  return {
    preset,
    knowOpponentDecklist: true,
    reveal: preset === 'partial' ? { opponentHandCount: 2, opponentHandKinds: ['shieldTrigger', 'blocker'] } : undefined,
  };
}

function StatsRow({ label, s }: { label: string; s: MatchStats }) {
  return (
    <tr>
      <td>{label}</td>
      <td>{s.games}</td>
      <td>
        {s.winsA} / {s.winsB} / {s.draws}
      </td>
      <td>
        <strong>{pct(s.winRateA)}</strong>
        <span className="muted">
          {' '}
          ({pct(s.ci95A[0])}〜{pct(s.ci95A[1])})
        </span>
      </td>
      <td>
        {s.winRateAFirst !== null ? pct(s.winRateAFirst) : '-'} / {s.winRateASecond !== null ? pct(s.winRateASecond) : '-'}
      </td>
      <td>{pct(s.firstPlayerWinRate)}</td>
      <td>{s.avgTurns.toFixed(1)}</td>
    </tr>
  );
}

export function BatchView() {
  const decks = allDecks();
  const [deckA, setDeckA] = useState('maruru');
  const [deckB, setDeckB] = useState('zardy');
  const [kindA, setKindA] = useState<AgentKind>('rule');
  const [kindB, setKindB] = useState<AgentKind>('random');
  const [infoA, setInfoA] = useState<InfoPreset>('fair');
  const [infoB, setInfoB] = useState<InfoPreset>('fair');
  const [games, setGames] = useState(500);
  const [seed, setSeed] = useState(1);
  const [first, setFirst] = useState<FirstMode>('alternate');
  const [compare, setCompare] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [results, setResults] = useState<{ label: string; s: MatchStats }[] | null>(null);
  const [strength, setStrength] = useState<CardStrength[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const job = useRef<RunningJob<any> | null>(null);

  const spec = (k: AgentKind, i: InfoPreset): AgentSpec => ({ kind: k, policy: policyOf(i), iterations: 40 });

  const run = async () => {
    setError(null);
    setResults(null);
    setProgress([0, 1]);
    try {
      const a = findDeck(deckA).cards;
      const b = findDeck(deckB).cards;
      const variants: { label: string; info: InfoPreset }[] = compare
        ? (['fair', 'partial', 'full'] as InfoPreset[]).map((i) => ({ label: `A: ${INFO_PRESET_LABEL[i]}`, info: i }))
        : [{ label: `A(${AGENT_LABEL[kindA]}) vs B(${AGENT_LABEL[kindB]})`, info: infoA }];
      job.current = runSimJob<MatchStats[]>(
        {
          type: 'batch',
          opts: variants.map((v) => ({ deckA: a, deckB: b, agentA: spec(kindA, v.info), agentB: spec(kindB, infoB), games, seed, first })),
        },
        (d, t) => setProgress([d, t]),
      );
      const r: MatchStats[] = await job.current.promise;
      setResults(r.map((s, i) => ({ label: variants[i].label, s })));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setProgress(null);
    }
  };

  const runStrength = async () => {
    setError(null);
    setStrength(null);
    setProgress([0, 1]);
    try {
      job.current = runSimJob<CardStrength[]>(
        { type: 'strength', deck: findDeck(deckA).cards, opponent: findDeck(deckB).cards, agent: { kind: 'rule' }, games: Math.min(games, STRENGTH_MAX_GAMES), seed },
        (d, t) => setProgress([d, t]),
      );
      setStrength(await job.current.promise);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="page">
      <div className="menu" style={{ maxWidth: 1100 }}>
        <h2>AI同士のバッチ対戦</h2>
        <p className="muted">デッキの勝率・先攻後攻の有利不利・CPUの情報条件による強さの違いを、数百〜数千試合で測ります(同じシード・同じ設定なら同じ結果になります)。</p>
        <div className="grid2">
          {[
            { k: 'A', deck: deckA, setDeck: setDeckA, kind: kindA, setKind: setKindA, info: infoA, setInfo: setInfoA },
            { k: 'B', deck: deckB, setDeck: setDeckB, kind: kindB, setKind: setKindB, info: infoB, setInfo: setInfoB },
          ].map((x) => (
            <div key={x.k} className="panel col">
              <h3>{x.k}</h3>
              <label className="row">
                デッキ
                <select value={x.deck} onChange={(e) => x.setDeck(e.target.value)}>
                  {decks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="row">
                AI
                <select value={x.kind} onChange={(e) => x.setKind(e.target.value as AgentKind)}>
                  {(['random', 'rule', 'mcts'] as AgentKind[]).map((k) => (
                    <option key={k} value={k}>
                      {AGENT_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="row">
                情報条件
                <select value={x.info} onChange={(e) => x.setInfo(e.target.value as InfoPreset)}>
                  {(Object.keys(INFO_PRESET_LABEL) as InfoPreset[]).map((k) => (
                    <option key={k} value={k}>
                      {INFO_PRESET_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
        </div>
        <div className="panel row">
          <label>
            試合数 <input type="number" min={1} value={games} onChange={(e) => setGames(Math.max(1, Number(e.target.value)))} />
          </label>
          <label>
            シード <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
          </label>
          <label>
            先攻
            <select value={first} onChange={(e) => setFirst(e.target.value as FirstMode)}>
              <option value="alternate">交互</option>
              <option value="fixed">Aが常に先攻</option>
              <option value="random">ランダム</option>
            </select>
          </label>
          <label>
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Aの情報条件を比較(公平 / 部分開示 / 全開示)
          </label>
        </div>
        <div className="row">
          {progress === null ? (
            <>
              <button className="primary" onClick={run}>
                バッチ対戦を実行
              </button>
              <button onClick={runStrength} title={`デッキの各カードを1枚抜いた時の勝率差(Aのデッキ vs Bのデッキ、ルールベース同士)。時間がかかるため、試合数は各${STRENGTH_MAX_GAMES}試合までに制限します`}>
                カードの強さを測る
              </button>
            </>
          ) : (
            <>
              <button className="danger" onClick={() => job.current?.cancel()}>
                キャンセル
              </button>
              <div className="bar" style={{ flex: 1, minWidth: 200 }}>
                <span style={{ width: `${(progress[0] / Math.max(1, progress[1])) * 100}%` }} />
              </div>
            </>
          )}
        </div>
        {error && <div className="panel" style={{ borderColor: 'var(--bad)' }}>{error}</div>}
        {results && (
          <div className="panel col">
            <h3>結果</h3>
            <table>
              <thead>
                <tr>
                  <th>条件</th>
                  <th>試合数</th>
                  <th>A勝 / B勝 / 引分</th>
                  <th>Aの勝率(95%信頼区間)</th>
                  <th>Aが先攻 / 後攻の時</th>
                  <th>先攻の勝率</th>
                  <th>平均ターン</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <StatsRow key={r.label} label={r.label} s={r.s} />
                ))}
              </tbody>
            </table>
            <button onClick={() => downloadText('batch.json', JSON.stringify(results, null, 2))}>JSONで保存</button>
          </div>
        )}
        {strength && (
          <div className="panel col">
            <h3>カード単体の強さ(1枚を何もしないカードに入れ替えた時の勝率差)</h3>
            <table>
              <thead>
                <tr>
                  <th>カード</th>
                  <th>枚数</th>
                  <th>勝率差</th>
                  <th>95%信頼区間</th>
                </tr>
              </thead>
              <tbody>
                {strength.map((c) => (
                  <tr key={c.defId}>
                    <td>{c.name}</td>
                    <td>{c.copies}</td>
                    <td style={{ color: c.delta > 0 ? 'var(--good)' : 'var(--bad)' }}>{(c.delta * 100).toFixed(1)}pt</td>
                    <td className="muted">
                      {(c.ci95[0] * 100).toFixed(1)} 〜 {(c.ci95[1] * 100).toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
