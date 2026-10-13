// ソリティア調査画面: 条件ビルダー → 実行(Worker・進捗・キャンセル)→ 結果(確率・グラフ・パターン)→ 再生 → 出力。
import { useMemo, useRef, useState } from 'react';
import { CARD_DB } from '../cards';
import { patternsToCsv, probToCsv, pct } from '../sim/export';
import { describeGoal, GOAL_PRESETS, type Goal } from '../sim/goal';
import {
  replayPattern,
  type Pattern,
  type PatternGranularity,
  type PatternResult,
  type ProbResult,
  type SolitaireParams,
} from '../sim/solitaire';
import { GoalBuilder } from './GoalBuilder';
import { ReplayViewer } from './ReplayViewer';
import { allDecks, findDeck } from './decks';
import { reg } from './format';
import { runSimJob, type RunningJob } from './simClient';
import { downloadText, loadJson, saveJson } from './util';
import type { Ev, GameState } from '../engine/types';

type Mode = 'prob' | 'patterns';

export function SimView() {
  const decks = allDecks();
  const saved = loadJson<any>('dmsim.sim', {});
  const [deckId, setDeckId] = useState<string>(saved.deckId ?? 'maruru');
  const [first, setFirst] = useState<0 | 1>(saved.first ?? 0);
  const [goal, setGoal] = useState<Goal>(saved.goal ?? GOAL_PRESETS[0].goal);
  const [trials, setTrials] = useState<number>(saved.trials ?? 200);
  const [seed, setSeed] = useState<number>(saved.seed ?? 1);
  const [maxNodes, setMaxNodes] = useState<number>(saved.maxNodes ?? 8000);
  const [agent, setAgent] = useState<'rule' | 'random'>(saved.agent ?? 'rule');
  const [mode, setMode] = useState<Mode>('prob');
  const [gran, setGran] = useState<PatternGranularity>('ordered');
  const [must, setMust] = useState<string>(saved.must ?? '');
  const [exclude, setExclude] = useState<string>(saved.exclude ?? '');
  const [topFixed, setTopFixed] = useState<string>(saved.topFixed ?? '');
  const [free, setFree] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [prob, setProb] = useState<ProbResult | null>(null);
  const [pats, setPats] = useState<PatternResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replay, setReplay] = useState<{ title: string; states: GameState[]; events: Ev[][] } | null>(null);
  const [filterIn, setFilterIn] = useState('');
  const [filterOut, setFilterOut] = useState('');
  const job = useRef<RunningJob<any> | null>(null);

  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const params = (): SolitaireParams => ({
    deck: findDeck(deckId).cards,
    first,
    goal,
    trials,
    seed,
    maxNodes: mode === 'prob' ? maxNodes : Math.max(maxNodes, 4000),
    agent: { kind: agent },
    initial: { mustHand: list(must), mustNotHand: list(exclude), topFixed: list(topFixed) },
    free,
  });

  const run = async () => {
    setError(null);
    setProb(null);
    setPats(null);
    setProgress([0, trials]);
    saveJson('dmsim.sim', { deckId, first, goal, trials, seed, maxNodes, agent, must, exclude, topFixed });
    try {
      const p = params();
      if (mode === 'prob') {
        job.current = runSimJob<ProbResult>({ type: 'prob', params: p }, (d, t) => setProgress([d, t]));
        setProb(await job.current.promise);
      } else {
        job.current = runSimJob<PatternResult>({ type: 'patterns', params: p, opts: { granularity: gran, maxHistoriesPerTrial: 24 } }, (d, t) =>
          setProgress([d, t]),
        );
        setPats(await job.current.promise);
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setProgress(null);
      job.current = null;
    }
  };

  const openReplay = (pat: Pattern) => {
    const r = replayPattern(CARD_DB, params(), pat.sampleSeed, pat.sampleActions);
    setReplay({ title: `履歴の再生: ${pat.key}`, states: r.states, events: r.events });
  };

  const shownPatterns = useMemo(() => {
    if (!pats) return [];
    const inc = list(filterIn);
    const exc = list(filterOut);
    return pats.patterns.filter((p) => {
      const text = p.key + ' ' + Object.keys(p.handFreq).join(' ');
      const playText = p.key;
      if (inc.some((n) => !playText.includes(n))) return false;
      if (exc.some((n) => text.includes(n) && playText.includes(n))) return false;
      return true;
    });
  }, [pats, filterIn, filterOut]);

  const deckNames = useMemo(() => {
    const names = new Set<string>();
    for (const id of findDeck(deckId).cards) names.add(reg.defs[id].name);
    return [...names];
  }, [deckId]);

  return (
    <div className="page">
      <div className="menu" style={{ maxWidth: 1100 }}>
        <h2>ソリティア調査(確率調査・パターン調査)</h2>
        <p className="muted">
          相手が何もしない1人回しで、カード効果を含めてゲームを進めます。「4ターン目にコスト7のカードを使う確率は?」「どう動けば達成できる?」を調べます。
        </p>
        <div className="grid2">
          <div className="panel col">
            <h3>デッキと先攻・後攻</h3>
            <label className="row">
              デッキ
              <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="row">
              <select value={first} onChange={(e) => setFirst(Number(e.target.value) as 0 | 1)}>
                <option value={0}>先攻(1ターン目はドローなし)</option>
                <option value={1}>後攻</option>
              </select>
            </label>
            <label className="row">
              <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} /> 自由モード(構築制限なし)
            </label>
            <h3>初期条件(任意)</h3>
            <label className="row">
              初手に必ず含める
              <input list="deck-names" style={{ minWidth: 220 }} value={must} onChange={(e) => setMust(e.target.value)} placeholder="カード名(カンマ区切り)" />
            </label>
            <label className="row">
              初手に含めない
              <input list="deck-names" style={{ minWidth: 220 }} value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="カード名" />
            </label>
            <label className="row">
              山札の上を固定
              <input list="deck-names" style={{ minWidth: 220 }} value={topFixed} onChange={(e) => setTopFixed(e.target.value)} placeholder="上から順に(カンマ区切り)" />
            </label>
            <datalist id="deck-names">
              {deckNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>
          <div className="panel col">
            <h3>実行設定</h3>
            <label className="row">
              調査の種類
              <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                <option value="prob">確率調査(達成できる確率)</option>
                <option value="patterns">パターン調査(達成する使用履歴)</option>
              </select>
            </label>
            <label className="row">
              試行回数(シャッフル数)
              <input type="number" min={1} max={100000} value={trials} onChange={(e) => setTrials(Math.max(1, Number(e.target.value)))} />
            </label>
            <label className="row">
              シード
              <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
            </label>
            <label className="row">
              探索の上限ノード数
              <input type="number" min={0} step={1000} value={maxNodes} onChange={(e) => setMaxNodes(Math.max(0, Number(e.target.value)))} />
              <span className="muted">0 で探索しない(上限値を出さない)</span>
            </label>
            {mode === 'prob' && (
              <label className="row">
                方針プレイのAI
                <select value={agent} onChange={(e) => setAgent(e.target.value as any)}>
                  <option value="rule">ルールベース(現実的な打ち方)</option>
                  <option value="random">ランダム</option>
                </select>
              </label>
            )}
            {mode === 'patterns' && (
              <label className="row">
                パターンの粗さ
                <select value={gran} onChange={(e) => setGran(e.target.value as PatternGranularity)}>
                  <option value="ordered">ターンごとのマナチャージ+使用(順序あり)</option>
                  <option value="set">ターンごとのマナチャージ+使用(順序なし)</option>
                  <option value="cards">使用カードの集合のみ</option>
                  <option value="choices">効果の選択も含める</option>
                </select>
              </label>
            )}
          </div>
        </div>

        <div className="panel col">
          <h3>目標</h3>
          <div className="row">
            <label className="row">
              プリセット
              <select
                value=""
                onChange={(e) => {
                  const p = GOAL_PRESETS.find((x) => x.id === e.target.value);
                  if (p) setGoal(p.goal);
                }}
              >
                <option value="">選んで読み込む…</option>
                {GOAL_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={() => downloadText('goal.json', JSON.stringify(goal, null, 2))}>目標をJSONで保存</button>
            <label className="small">
              <input
                type="file"
                accept="application/json"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    setGoal(JSON.parse(await f.text()));
                  } catch {
                    setError('目標のJSONを読み込めませんでした');
                  }
                }}
              />
            </label>
          </div>
          <GoalBuilder goal={goal} onChange={setGoal} />
        </div>

        <div className="row">
          {progress === null ? (
            <button className="primary" onClick={run}>
              実行
            </button>
          ) : (
            <>
              <button className="danger" onClick={() => job.current?.cancel()}>
                キャンセル
              </button>
              <div className="bar" style={{ flex: 1, minWidth: 200 }}>
                <span style={{ width: `${(progress[0] / Math.max(1, progress[1])) * 100}%` }} />
              </div>
              <span className="muted">
                {progress[0]} / {progress[1]}
              </span>
            </>
          )}
        </div>
        {error && <div className="panel" style={{ borderColor: 'var(--bad)' }}>{error}</div>}

        {prob && <ProbResultView r={prob} goal={goal} />}
        {pats && (
          <div className="panel col">
            <h3>パターン調査の結果</h3>
            <div>
              試行 {pats.trials} 回 / 目標を達成できた試行 {pats.achievedTrials}({pct(pats.achievedTrials / Math.max(1, pats.trials))}) / 未判定{' '}
              {pats.unknownTrials} / パターン {pats.patterns.length} 種 / {(pats.ms / 1000).toFixed(1)}秒
            </div>
            <div className="row">
              <label>
                絞り込み: 含む
                <input list="deck-names" value={filterIn} onChange={(e) => setFilterIn(e.target.value)} placeholder="カード名" />
              </label>
              <label>
                含まない
                <input list="deck-names" value={filterOut} onChange={(e) => setFilterOut(e.target.value)} placeholder="カード名" />
              </label>
              <button onClick={() => downloadText('patterns.json', JSON.stringify(pats, null, 2))}>JSON</button>
              <button onClick={() => downloadText('patterns.csv', patternsToCsv(pats))}>CSV</button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>履歴</th>
                  <th>出現割合</th>
                  <th>必要条件の要約(初手)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shownPatterns.slice(0, 40).map((p, i) => (
                  <tr key={p.key}>
                    <td>{i + 1}</td>
                    <td>
                      {p.turns.map((t) => (
                        <div key={t.turn}>
                          <span className="tag">{t.turn}T</span> マナ: {t.charge ?? '-'} / 使用: {t.plays.join(' → ') || '-'}
                          {t.choices.length > 0 && <span className="muted"> / {t.choices.join('; ')}</span>}
                        </div>
                      ))}
                    </td>
                    <td>
                      全試行の {pct(p.ratioAll)}
                      <br />
                      <span className="muted">達成した試行の {pct(p.ratioAchieved)}</span>
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {Object.entries(p.handFreq)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 4)
                        .map(([n, v]) => `${n} ${pct(v, 0)}`)
                        .join(' / ')}
                    </td>
                    <td>
                      <button className="small" onClick={() => openReplay(p)}>
                        再生
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pats.patterns.length === 0 && <div className="muted">達成する履歴は見つかりませんでした(探索の上限を上げてみてください)。</div>}
          </div>
        )}
      </div>
      {replay && <ReplayViewer title={replay.title} states={replay.states} events={replay.events} me={0} peek onClose={() => setReplay(null)} />}
    </div>
  );
}

function ProbResultView({ r, goal }: { r: ProbResult; goal: Goal }) {
  const max = Math.max(0.0001, ...r.policy.byTurn);
  return (
    <div className="panel col">
      <h3>確率調査の結果</h3>
      <div className="muted">目標: {describeGoal(goal)}</div>
      <div className="grid2">
        <div className="panel">
          <div className="muted">方針プレイ(現実的な打ち方)</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{pct(r.policy.rate)}</div>
          <div className="muted">
            95%信頼区間 {pct(r.policy.ci95[0])} 〜 {pct(r.policy.ci95[1])}({r.policy.achieved} / {r.trials})
          </div>
        </div>
        {r.search && (
          <div className="panel">
            <div className="muted">探索による上限(山札の並びを知っていた場合)</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>
              {pct(r.search.achieved / Math.max(1, r.trials))}
              {r.search.unknown > 0 && <span className="muted" style={{ fontSize: 16 }}> 〜 {pct(r.search.maxRate)}</span>}
            </div>
            <div className="muted">
              到達できると確認 {r.search.achieved} 回 / 未判定 {r.search.unknown} 回(ノード上限)/ 判定できた中の割合 {pct(r.search.rate)}
            </div>
          </div>
        )}
      </div>
      {r.exact && (
        <div className="panel">
          超幾何分布の厳密値: <strong>{pct(r.exact.value, 2)}</strong> <span className="muted">({r.exact.note})</span>
        </div>
      )}
      <div>
        <div className="muted">ターンまでの達成率(累積・方針プレイ)</div>
        <div className="chart">
          {r.policy.byTurn.map((v, t) =>
            t === 0 ? null : (
              <div className="col-bar" key={t}>
                <span>{pct(v)}</span>
                <div style={{ height: `${(v / max) * 100}%` }} />
                <span className="muted">{t}T</span>
              </div>
            ),
          )}
        </div>
      </div>
      <div className="row">
        <button onClick={() => downloadText('probability.json', JSON.stringify(r, null, 2))}>JSON</button>
        <button onClick={() => downloadText('probability.csv', probToCsv(r))}>CSV</button>
        <span className="muted">{(r.ms / 1000).toFixed(1)}秒</span>
      </div>
    </div>
  );
}
