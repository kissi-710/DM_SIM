// バッチ対戦画面(spec 7): AI同士の対戦を Worker で実行し、勝率・先攻後攻別・情報条件の比較・カードの強さを出す。
import { useRef, useState } from 'react';
import { AGENT_LABEL, type AgentKind, type AgentSpec } from '../ai';
import { checkHypotheses, hypothesisProblems, makePolicy } from '../ai/policy';
import { CARD_DB } from '../cards';
import { INFO_PRESET_LABEL, type InfoPreset } from '../engine/view';
import { pct } from '../sim/export';
import type { FirstMode, MatchStats } from '../sim/batch';
import type { CardStrength } from '../sim/strength';
import { allDecks, findDeck } from './decks';
import { runSimJob, type RunningJob } from './simClient';
import { downloadText } from './util';

/** シード欄が空なら、実行のたびにランダムに決める(結果に表示するので、同じ値を入れれば再現できる) */
function resolveSeed(raw: string): number {
  const t = raw.trim();
  if (t === '') return Math.floor(Math.random() * 0x7fffffff);
  return Math.floor(Number(t));
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
  const [kindA, setKindA] = useState<AgentKind>('mcts');
  const [kindB, setKindB] = useState<AgentKind>('mcts');
  const [infoA, setInfoA] = useState<InfoPreset>('fair');
  const [infoB, setInfoB] = useState<InfoPreset>('fair');
  // 決め打ち(hypothesis)の仮説: 相手が手札に持っていそうなカード名(カンマ区切り)
  const [hypoA, setHypoA] = useState('');
  const [hypoB, setHypoB] = useState('');
  const [games, setGames] = useState(500);
  const [seedText, setSeedText] = useState('');
  const [iterations, setIterations] = useState(40);
  const [first, setFirst] = useState<FirstMode>('alternate');
  const [compare, setCompare] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [results, setResults] = useState<{ label: string; seed: number; s: MatchStats }[] | null>(null);
  const [strength, setStrength] = useState<{ seed: number; rows: CardStrength[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const job = useRef<RunningJob<any> | null>(null);

  const spec = (k: AgentKind, i: InfoPreset, hypothesisIds: string[] = []): AgentSpec => ({ kind: k, policy: makePolicy(i, { hypotheses: hypothesisIds }), iterations });

  /** 決め打ちの仮説(カード名)を解決して検査する。問題があれば、エラーを出して null を返す */
  const takeHypotheses = (compareMode: boolean): { a: string[]; b: string[] } | null => {
    const problems: string[] = [];
    const pick = (info: InfoPreset, text: string, opponentDeck: string[], label: string): string[] => {
      if (info !== 'hypothesis') return [];
      const c = checkHypotheses(CARD_DB, text.split(/[,、]/), opponentDeck);
      problems.push(...hypothesisProblems(c, label));
      return c.ids;
    };
    const a = pick(compareMode ? 'fair' : infoA, hypoA, findDeck(deckB).cards, 'Aの決め打ち');
    const b = pick(infoB, hypoB, findDeck(deckA).cards, 'Bの決め打ち');
    if (problems.length) {
      setError(problems.join(' / '));
      return null;
    }
    return { a, b };
  };

  /** 入力のシードを数にする。空欄ならランダム。数でなければエラーにして null を返す */
  const takeSeed = (): number | null => {
    const v = resolveSeed(seedText);
    if (!Number.isFinite(v)) {
      setError('シードは整数で入力してください(空欄ならランダムになります)');
      return null;
    }
    return v;
  };

  const run = async () => {
    setError(null);
    const seed = takeSeed();
    if (seed === null) return;
    const hy = takeHypotheses(compare);
    if (hy === null) return;
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
          opts: variants.map((v) => ({ deckA: a, deckB: b, agentA: spec(kindA, v.info, hy.a), agentB: spec(kindB, infoB, hy.b), games, seed, first })),
        },
        (d, t) => setProgress([d, t]),
      );
      const r: MatchStats[] = await job.current.promise;
      setResults(r.map((s, i) => ({ label: variants[i].label, seed, s })));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setProgress(null);
    }
  };

  const runStrength = async () => {
    setError(null);
    const seed = takeSeed();
    if (seed === null) return;
    const hy = takeHypotheses(false);
    if (hy === null) return;
    setStrength(null);
    setProgress([0, 1]);
    try {
      job.current = runSimJob<CardStrength[]>(
        { type: 'strength', deck: findDeck(deckA).cards, opponent: findDeck(deckB).cards, agent: spec(kindA, infoA, hy.a), games, seed },
        (d, t) => setProgress([d, t]),
      );
      setStrength({ seed, rows: await job.current.promise });
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
            { k: 'A', deck: deckA, setDeck: setDeckA, kind: kindA, setKind: setKindA, info: infoA, setInfo: setInfoA, hypo: hypoA, setHypo: setHypoA },
            { k: 'B', deck: deckB, setDeck: setDeckB, kind: kindB, setKind: setKindB, info: infoB, setInfo: setInfoB, hypo: hypoB, setHypo: setHypoB },
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
              {x.info === 'hypothesis' && (
                <label className="row">
                  仮説のカード
                  <input
                    style={{ minWidth: 240 }}
                    value={x.hypo}
                    onChange={(e) => x.setHypo(e.target.value)}
                    placeholder="相手が手札に持っていそうなカード(カンマ区切り)"
                  />
                </label>
              )}
            </div>
          ))}
        </div>
        <div className="panel row">
          <label>
            試合数 <input type="number" min={1} value={games} onChange={(e) => setGames(Math.max(1, Math.floor(Number(e.target.value)) || 1))} />
          </label>
          <label title="モンテカルロ探索の1手あたりの反復回数。多いほど強く、遅くなります">
            探索の反復回数{' '}
            <input type="number" min={1} value={iterations} onChange={(e) => setIterations(Math.max(1, Math.floor(Number(e.target.value)) || 1))} />
          </label>
          <label>
            シード <input type="number" placeholder="空欄ならランダム" value={seedText} onChange={(e) => setSeedText(e.target.value)} />
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
              <button onClick={runStrength} title="デッキの各カードを1枚抜いた時の勝率差(Aのデッキ vs Bのデッキ。両者ともAのAI・情報条件で対戦)。カードの種類数+1通りぶん対戦するので、時間がかかります">
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
            <p className="muted">シード {results[0].seed}(同じ値を入れると同じ結果になります)</p>
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
            <p className="muted">
              シード {strength.seed} / {AGENT_LABEL[kindA]}同士・各 {games} 試合
            </p>
            <table>
              <thead>
                <tr>
                  <th>カード</th>
                  <th>枚数</th>
                  <th>勝率差</th>
                  <th>95%信頼区間</th>
                  <th title="全カードを同時に比べるための区間(全体で95%)。順位を読む時はこちらを見る">同時比較の区間</th>
                </tr>
              </thead>
              <tbody>
                {strength.rows.map((c) => (
                  <tr key={c.defId}>
                    <td>{c.name}</td>
                    <td>{c.copies}</td>
                    <td style={{ color: c.delta > 0 ? 'var(--good)' : 'var(--bad)' }}>{(c.delta * 100).toFixed(1)}pt</td>
                    <td className="muted">
                      {(c.ci95[0] * 100).toFixed(1)} 〜 {(c.ci95[1] * 100).toFixed(1)}
                    </td>
                    <td className="muted">
                      {(c.ciFamily[0] * 100).toFixed(1)} 〜 {(c.ciFamily[1] * 100).toFixed(1)}
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
