// 対戦設定: 座席ごとの人間/CPU・強さ・情報条件・デッキ・先攻後攻・シード(spec 5.1)。
import { useState } from 'react';
import { AGENT_LABEL, type AgentKind } from '../ai';
import { checkDeck } from '../engine/engine';
import { CARD_DB } from '../cards';
import { INFO_PRESET_LABEL, type InfoPolicy, type InfoPreset } from '../engine/view';
import { allDecks, findDeck } from './decks';
import type { GameSetup, Seat } from './useGame';
import { loadJson, saveJson } from './util';

interface SeatForm {
  kind: 'human' | 'cpu';
  agent: AgentKind;
  info: InfoPreset;
  deck: string;
}

function policyOf(preset: InfoPreset): InfoPolicy {
  return {
    preset,
    knowOpponentDecklist: true,
    reveal: preset === 'partial' ? { opponentHandCount: 2, opponentHandKinds: ['shieldTrigger', 'blocker'] } : undefined,
    hypotheses: preset === 'hypothesis' ? [{ defId: 'dm24ex2-Cho033' }, { defId: 'dmrp17-029' }] : undefined,
    hypothesisWeight: 0.6,
  };
}

export function SetupScreen({ mode, onStart, onBack }: { mode: 'play' | 'watch'; onStart: (s: GameSetup) => void; onBack: () => void }) {
  const decks = allDecks();
  const saved = loadJson<{ seats: SeatForm[]; first: string; seed: string; autoOrder: boolean; undo: boolean; delay: number; think?: number } | null>('dmsim.setup.' + mode, null);
  const [seats, setSeats] = useState<SeatForm[]>(
    saved?.seats ??
      (mode === 'play'
        ? [
            { kind: 'human', agent: 'rule', info: 'fair', deck: 'maruru' },
            { kind: 'cpu', agent: 'rule', info: 'fair', deck: 'zardy' },
          ]
        : [
            { kind: 'cpu', agent: 'rule', info: 'fair', deck: 'maruru' },
            { kind: 'cpu', agent: 'rule', info: 'fair', deck: 'zardy' },
          ]),
  );
  const [first, setFirst] = useState(saved?.first ?? 'random');
  const [seed, setSeed] = useState(saved?.seed ?? '');
  const [autoOrder, setAutoOrder] = useState(saved?.autoOrder ?? false);
  const [undo, setUndo] = useState(saved?.undo ?? true);
  const [delay, setDelay] = useState(saved?.delay ?? (mode === 'watch' ? 600 : 500));
  // モンテカルロ探索の最大の思考時間。手の優劣がはっきりすれば、これより早く打ち切る
  const [think, setThink] = useState(saved?.think ?? 1200);
  const [strict, setStrict] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const setSeat = (i: number, patch: Partial<SeatForm>) => setSeats((cur) => cur.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const start = () => {
    try {
      const ds = seats.map((x) => findDeck(x.deck));
      for (const d of ds) {
        const chk = checkDeck(CARD_DB, d.cards, strict);
        if (!chk.ok) throw new Error(`${d.name}: ${chk.errors.join(' / ')}`);
      }
      const sd = seed.trim() === '' ? Math.floor(Math.random() * 1e9) : Number(seed) || 1;
      const mk = (f: SeatForm): Seat => ({
        kind: mode === 'watch' ? 'cpu' : f.kind,
        agent: { kind: f.agent, policy: policyOf(f.info), candidateDecks: decks.filter((d) => d.preset).map((d) => d.cards), ms: think },
      });
      saveJson('dmsim.setup.' + mode, { seats, first, seed, autoOrder, undo, delay, think });
      onStart({
        decks: [ds[0].cards, ds[1].cards],
        deckNames: [ds[0].name, ds[1].name],
        seats: [mk(seats[0]), mk(seats[1])],
        first: first === 'random' ? 'random' : first === '0' ? 0 : 1,
        seed: sd,
        autoOrder,
        allowUndo: undo,
        cpuDelayMs: delay,
        strict,
      });
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  };

  return (
    <div className="menu">
      <h2>{mode === 'play' ? '対戦の設定' : 'CPU同士の観戦'}</h2>
      <div className="grid2">
        {[0, 1].map((i) => (
          <div key={i} className="panel col">
            <h3>席{i + 1}{mode === 'play' && i === 0 ? '(あなた)' : ''}</h3>
            {mode === 'play' && (
              <label className="row">
                操作
                <select value={seats[i].kind} onChange={(e) => setSeat(i, { kind: e.target.value as any })}>
                  <option value="human">人間</option>
                  <option value="cpu">CPU</option>
                </select>
              </label>
            )}
            <label className="row">
              デッキ
              <select value={seats[i].deck} onChange={(e) => setSeat(i, { deck: e.target.value })}>
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            {(mode === 'watch' || seats[i].kind === 'cpu') && (
              <>
                <label className="row">
                  CPUの強さ
                  <select value={seats[i].agent} onChange={(e) => setSeat(i, { agent: e.target.value as AgentKind })}>
                    {(['random', 'rule', 'mcts'] as AgentKind[]).map((k) => (
                      <option key={k} value={k}>
                        {AGENT_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="row">
                  情報条件
                  <select value={seats[i].info} onChange={(e) => setSeat(i, { info: e.target.value as InfoPreset })}>
                    {(Object.keys(INFO_PRESET_LABEL) as InfoPreset[]).map((k) => (
                      <option key={k} value={k}>
                        {INFO_PRESET_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="muted">既定は「公平」(相手の手札・シールド・山札の並びは見えません)。弱い時だけ部分開示・決め打ちで調整します。</span>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="panel col">
        <label className="row">
          先攻・後攻
          <select value={first} onChange={(e) => setFirst(e.target.value)}>
            <option value="random">ランダム</option>
            <option value="0">席1が先攻</option>
            <option value="1">席2が先攻</option>
          </select>
        </label>
        <label className="row">
          シード(空欄で自動)
          <input type="text" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="例: 12345" />
        </label>
        <label className="row">
          モンテカルロの最大思考時間(ms)
          <input type="number" value={think} min={50} max={20000} step={100} onChange={(e) => setThink(Math.max(50, Number(e.target.value) || 1200))} />
        </label>
        <span className="muted">1手ごとの上限です。手の優劣がはっきりすれば、早めに打ち切ります。長いほど強くなります。</span>
        <label className="row">
          CPUの手の間隔(ms)
          <input type="number" value={delay} min={0} max={3000} step={100} onChange={(e) => setDelay(Number(e.target.value))} />
        </label>
        {mode === 'play' && (
        <>
        <label className="row">
          <input type="checkbox" checked={autoOrder} onChange={(e) => setAutoOrder(e.target.checked)} />
          同時に誘発した自分の能力の順序を自動にする(左から)
        </label>
        <label className="row">
          <input type="checkbox" checked={undo} onChange={(e) => setUndo(e.target.checked)} />
          「1手戻す」を許可する(練習用)
        </label>
        </>
        )}
        <label className="row">
          <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
          構築制限(40枚・同名4枚まで)を検査する
        </label>
      </div>
      {err && <div className="panel" style={{ borderColor: 'var(--bad)' }}>{err}</div>}
      <div className="row">
        <button onClick={onBack}>戻る</button>
        <button className="primary" onClick={start}>
          {mode === 'play' ? '対戦開始' : '観戦開始'}
        </button>
      </div>
    </div>
  );
}
