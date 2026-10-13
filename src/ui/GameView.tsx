// 対戦画面: 盤面・待機プール・因果ツリーのログ・入力ウィジェット・操作ボタン。
import { useEffect, useMemo, useRef, useState } from 'react';
import { costOf, effectsOnPerm, hasKeyword, powerOf, type KwName } from '../engine/derive';
import { entryLabel } from '../engine/procs';
import { mkCtx, permByPid } from '../engine/state';
import type { Action, GameState, PlayerId } from '../engine/types';
import { Board, selectedActions } from './Board';
import { CardView, civGradient } from './CardView';
import { buildLogTree, CIV_NAME, reg, type LogNode } from './format';
import { InputWidget } from './Widgets';
import { makeRecord, type GameSetup, type Session, useGame } from './useGame';
import { downloadText } from './util';

const STEP_LABEL: Record<string, string> = {
  start: 'ターン開始',
  draw: 'ドロー',
  mana: 'マナチャージ',
  main: 'メイン',
  attack: '攻撃',
  end: 'ターン終了',
};

export function CardDetail({ s, uid }: { s: GameState; uid: number | null }) {
  if (uid === null || !s.cards[uid] || s.cards[uid].defId === '?') {
    return <div className="muted">カードにマウスを乗せると、ここに全文が表示されます。</div>;
  }
  const c = s.cards[uid];
  const def = reg.defs[c.defId];
  return (
    <div className="col">
      <strong>{def.name}</strong>
      {def.faces.map((f, i) => (
        <div key={i} className="panel" style={{ padding: 6 }}>
          <div className="row" style={{ gap: 6 }}>
            <span className="tag">{f.type === 'spell' ? '呪文' : f.type === 'evolution' ? '進化' : f.type === 'smaxEvolution' ? 'S-MAX進化' : 'クリーチャー'}</span>
            <span className="tag">コスト {f.cost}</span>
            {f.power !== undefined && <span className="tag">パワー {f.power}</span>}
            <span style={{ width: 60, height: 8, background: civGradient(f.civs), borderRadius: 4, display: 'inline-block' }} title={f.civs.map((x) => CIV_NAME[x]).join('・')} />
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {f.civs.map((x) => CIV_NAME[x]).join('・')}
            {f.races?.length ? ` / ${f.races.join('・')}` : ''}
          </div>
        </div>
      ))}
      <div style={{ fontSize: 12.5 }}>{def.text}</div>
      <Derived s={s} uid={uid} />
    </div>
  );
}

const KW_LABEL: Record<string, string> = {
  blocker: 'ブロッカー',
  speedAttacker: 'スピードアタッカー',
  machFighter: 'マッハファイター',
  shieldTrigger: 'S・トリガー',
  justDiver: 'ジャストダイバー',
  exLife: 'EXライフ',
};
const EFFECT_LABEL: Record<string, string> = {
  cannotAttack: '攻撃できない',
  cannotBeChosen: '相手に選ばれない',
  cannotBeAttacked: '攻撃されない',
};

/** 現在のコスト・パワー・付与された能力(画像なしなので、全文と一緒に派生値を出す) */
function Derived({ s, uid }: { s: GameState; uid: number }) {
  const c = mkCtx(s, reg);
  const card = s.cards[uid];
  const lines: string[] = [];
  if (card.zone === 'battle') {
    const pm = permByPid(s, card.pid);
    if (pm && pm.perm.cards[0] === uid) {
      lines.push(`現在のパワー: ${powerOf(c, pm.perm)}`);
      const kws = (['blocker', 'speedAttacker', 'machFighter', 'shieldTrigger', 'justDiver', 'exLife'] as KwName[]).filter((k) => hasKeyword(c, pm.perm, k));
      if (kws.length) lines.push('持っている能力: ' + kws.map((k) => KW_LABEL[k]).join('、'));
      for (const e of effectsOnPerm(c, pm.perm.pid)) {
        if (e.mod.kind === 'powerAdd') lines.push(`パワー ${e.mod.n > 0 ? '+' : ''}${e.mod.n}(${e.until.kind === 'endOfTurn' ? 'このターン中' : '次の自分のターンのはじめまで'})`);
        else if (e.mod.kind === 'grant') lines.push(`${KW_LABEL[e.mod.keyword] ?? e.mod.keyword} を得ている`);
        else lines.push(EFFECT_LABEL[e.mod.kind] ?? e.mod.kind);
      }
      lines.push(`${pm.perm.tapped ? 'タップ' : 'アンタップ'}状態${pm.perm.sick ? '(召喚酔い)' : ''}${pm.perm.cards.length > 1 ? ' / 進化元 ' + (pm.perm.cards.length - 1) + '枚' : ''}`);
    }
  } else if (card.zone === 'hand' || card.zone === 'mana' || card.zone === 'grave') {
    const def = reg.defs[card.defId];
    def.faces.forEach((f, i) => {
      const now = costOf(c, uid, i, {});
      lines.push(`${def.faces.length > 1 ? f.name + ': ' : ''}現在のコスト ${now}${now !== f.cost ? `(表記 ${f.cost})` : ''}`);
    });
  }
  if (lines.length === 0) return null;
  return (
    <div className="panel" style={{ padding: 6, fontSize: 12.5 }}>
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}

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

export function GameView({ setup, onExit, onRematch }: { setup: GameSetup; onExit: () => void; onRematch: () => void }) {
  const g = useGame(setup);
  const { session } = g;
  const s = session.state;
  const [hover, setHover] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [peek, setPeek] = useState(false);
  const [showOpp, setShowOpp] = useState(g.me === null);
  const [recText, setRecText] = useState<string | null>(null);
  const [manualPay, setManualPay] = useState(false);
  // 直近の1手で動いたカードを強調する(イベントの再生。design 9)
  const flash = useMemo(() => {
    const set = new Set<number>();
    for (const e of session.last) {
      if (['moved', 'entered', 'cast', 'attackDeclared', 'evolved', 'blocked'].includes(e.type) && typeof e.card === 'number') set.add(e.card);
    }
    return set;
  }, [session.last]);

  const pend = s.pending;
  const viewer: PlayerId = g.me ?? (pend && setup.seats[pend.player].kind === 'human' ? pend.player : 0);
  const humanTurn = !!pend && s.winner === null && setup.seats[pend.player].kind === 'human';
  const turnAction = humanTurn && pend!.why === 'turnAction';
  const interactive = turnAction && pend!.player === viewer;
  const legal = g.legal;

  useEffect(() => {
    setSelected(null);
  }, [pend?.id]);

  const act = (a: Action) => {
    setSelected(null);
    g.perform(a);
  };

  const selActs = selectedActions(s, legal, selected);
  const stepActs = {
    skipMana: legal.find((a) => a.type === 'SKIP_MANA'),
    endMain: legal.find((a) => a.type === 'END_MAIN'),
    endTurn: legal.find((a) => a.type === 'END_TURN'),
  };

  const activeLabel = pend
    ? setup.seats[pend.player].kind === 'human'
      ? g.me === null
        ? `プレイヤー${pend.player + 1}`
        : 'あなた'
      : g.me === null
        ? `CPU${pend.player + 1}`
        : '相手(CPU)'
    : '';

  const rec = () => JSON.stringify(makeRecord(setup, session), null, 1);

  return (
    <div className="game">
      <div className="game-head">
        <button onClick={onExit}>← メニュー</button>
        <span className="status-chip">
          {Math.ceil(s.turn / 2)}ターン目({s.active === (g.me ?? 0) ? (g.me === null ? 'プレイヤー1' : 'あなた') : g.me === null ? 'プレイヤー2' : '相手'})
        </span>
        <span className="status-chip">{STEP_LABEL[s.step] ?? s.step}</span>
        {pend && s.winner === null && (
          <span className={'status-chip ' + (setup.seats[pend.player].kind === 'human' ? 'me' : 'cpu')}>
            {activeLabel}の{pend.why === 'turnAction' ? '行動' : '入力'}待ち
            {session.thinking && <span className="thinking" />}
          </span>
        )}
        <span className="muted">シード {setup.seed}</span>
        <span style={{ flex: 1 }} />
        {setup.allowUndo && (
          <button disabled={!g.canUndo || !humanTurn} onClick={g.undo} title="1手戻す(練習用。情報が公開された後は戻せません)">
            ↶ 1手戻す
          </button>
        )}
        {g.me !== null && (
          <label>
            <input type="checkbox" checked={peek} onChange={(e) => setPeek(e.target.checked)} /> 自分のシールドを見る
          </label>
        )}
        {g.me !== null && (
          <label>
            <input type="checkbox" checked={manualPay} onChange={(e) => setManualPay(e.target.checked)} /> マナを手動で選ぶ
          </label>
        )}
        <label>
          <input type="checkbox" checked={showOpp} onChange={(e) => setShowOpp(e.target.checked)} /> 相手の手札を見る
        </label>
        {setup.seats.every((x) => x.kind === 'cpu') && (
          <>
            <button onClick={() => g.setPaused(!g.paused)}>{g.paused ? '▶ 再開' : '⏸ 一時停止'}</button>
            <button disabled={!g.paused} onClick={g.stepOnce}>
              ⏭ 1手進める
            </button>
            <label>
              速度
              <input type="range" min={0} max={1500} step={50} value={1500 - g.speed} onChange={(e) => g.setSpeed(1500 - Number(e.target.value))} />
            </label>
          </>
        )}
        <button onClick={() => setRecText(rec())}>棋譜</button>
      </div>

      <Board
        s={s}
        me={g.me}
        legal={legal}
        interactive={interactive}
        onAction={act}
        onHover={setHover}
        peek={peek}
        showOppHand={showOpp}
        selected={selected}
        onSelect={setSelected}
        flash={flash}
        manualPay={manualPay}
      />

      <div className="side">
        <div className="box">
          <h3>カードの詳細</h3>
          <CardDetail s={s} uid={hover} />
        </div>
        <PoolPanel s={s} />
        <LogPanel s={s} log={session.log} me={g.me} />
      </div>

      <div className="footer">
        {session.error && <div className="toast">{session.error}</div>}
        {s.winner !== null ? (
          <div className="row">
            <strong style={{ fontSize: 16 }}>
              {s.winner === 'draw'
                ? '引き分け'
                : g.me === null
                  ? `プレイヤー${(s.winner as number) + 1}の勝ち`
                  : s.winner === g.me
                    ? 'あなたの勝ち!'
                    : 'あなたの負け…'}
            </strong>
            <span className="muted">({s.loseReason})</span>
            <button className="primary" onClick={onRematch}>
              もう一度
            </button>
            <button onClick={() => setRecText(rec())}>棋譜を保存</button>
            <button onClick={onExit}>メニューへ</button>
          </div>
        ) : humanTurn && pend!.why !== 'turnAction' ? (
          <InputWidget s={s} pending={pend!} me={g.me} onHover={setHover} onAnswer={(value) => g.perform({ type: 'ANSWER', id: pend!.id, value })} />
        ) : interactive ? (
          <div className="row">
            <span className="muted">
              {s.step === 'mana'
                ? '手札を1枚マナゾーンにドラッグ(またはクリックして行き先を選ぶ)してマナチャージ。'
                : s.step === 'main'
                  ? '手札をバトルゾーンにドラッグして召喚・唱える。クリーチャーを相手のクリーチャー/シールドにドラッグして攻撃。'
                  : 'クリーチャーをドラッグして攻撃。'}
            </span>
            {selActs.map((d, i) => (
              <button key={i} className="choice on" onClick={() => act(d.action)}>
                {d.label}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            {stepActs.skipMana && <button onClick={() => act(stepActs.skipMana!)}>マナチャージしない</button>}
            {stepActs.endMain && <button onClick={() => act(stepActs.endMain!)}>メインを終える</button>}
            {stepActs.endTurn && (
              <button className="primary" onClick={() => act(stepActs.endTurn!)}>
                ターン終了
              </button>
            )}
          </div>
        ) : (
          <div className="muted">
            {pend ? `${activeLabel}が考えています…` : ''}
            {session.thinking && <span className="thinking" />}
          </div>
        )}
      </div>

      {recText !== null && (
        <div className="modal-back" onClick={() => setRecText(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>棋譜(シード・デッキ・行動列)</h2>
            <p className="muted">この JSON を「棋譜の再生」で読み込むと、同じ試合を再現できます。</p>
            <textarea className="json" readOnly value={recText} onFocus={(e) => e.target.select()} />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="primary" onClick={() => downloadText(`dm-sim-record-${setup.seed}.json`, recText)}>
                ダウンロード
              </button>
              <button
                onClick={() => {
                  try {
                    const k = 'dmsim.records';
                    const cur = JSON.parse(localStorage.getItem(k) ?? '[]');
                    cur.push({ at: Date.now(), rec: JSON.parse(recText) });
                    localStorage.setItem(k, JSON.stringify(cur.slice(-20)));
                  } catch {}
                  setRecText(null);
                }}
              >
                ブラウザに保存
              </button>
              <button onClick={() => setRecText(null)}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { CardView };
