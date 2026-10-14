// 対戦画面: 盤面・待機プール・因果ツリーのログ・入力ウィジェット・操作ボタン。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { costOf, effectsOnPerm, hasKeyword, powerOf, type KwName } from '../engine/derive';
import { entryLabel, payChoice, planPlay } from '../engine/procs';
import { mkCtx, permByPid } from '../engine/state';
import type { Action, GameState, PlayerId } from '../engine/types';
import { Board, buildDropMap, selectedActions } from './Board';
import { CardView, civGradient } from './CardView';
import { buildLogTree, cardName, CIV_NAME, recentFeed, reg, type LogNode } from './format';
import { InputWidget, PaymentWidget } from './Widgets';
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

const SHORTCUTS: Array<[string, string]> = [
  ['← →', '自分の動かせるカードを順に選ぶ'],
  ['1 〜 9', '操作パネル・選択肢・候補カードの上から N 番目を選ぶ'],
  ['Enter', '操作が1つならそれを実行 / 入力パネルの「確定」「はい」'],
  ['M', 'マナチャージしない / メインを終える'],
  ['E', 'ターン終了'],
  ['Z', '1手戻す(練習用設定のとき)'],
  ['Y / N', 'はい / いいえ'],
  ['A', '自動で払う・自動で振る・すべて1回ずつ使う'],
  ['N / R / C', '選ばない / やり直す / キャンセル(ダイアログ内)'],
  ['Esc', '選択やダイアログを閉じる'],
  ['L', 'ログ・詳細の表示/非表示'],
  ['O', '表示設定を開く'],
  ['Space', '観戦: 一時停止 / 再開'],
  ['N', '観戦: 一時停止中に1手進める'],
  ['R', '勝敗が出たら「もう一度」'],
  ['? / H', 'このヘルプ'],
];

const TIPS = [
  'カードをクリックすると、できる操作が右下のパネルに出ます。ドラッグしても同じ操作ができます。',
  '← → キーで手札やクリーチャーを順に選べます。数字キーで操作パネルの上から選べます。',
  '「E」キーでターン終了、「M」キーでマナチャージを飛ばす・メインを終える。',
  'カードにマウスを乗せると、右の「ログ・詳細」に現在のコストやパワーが出ます。',
  '手札やマナが増えたら、横にスクロールできます(トラックパッドや Shift+ホイール)。',
  'マナの払い方に選択があるときだけ、タップするマナを聞かれます。「⚙ 表示」で常に自動にもできます。',
  '練習用設定なら「↶ 1手戻す」(または Z)でやり直せます。',
  'ログの「自動」「手動」タグで、効果の自動解決とプレイヤーの操作を見分けられます。',
];

function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal help" onClick={(e) => e.stopPropagation()}>
        <h2>操作ヘルプ</h2>
        <div className="help-grid">
          <div>
            <h3>ショートカットキー</h3>
            <table>
              <tbody>
                {SHORTCUTS.map(([key, what]) => (
                  <tr key={key}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className="kbd">{key}</span>
                    </td>
                    <td>{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3>Tips</h3>
            <ul className="tips">
              {TIPS.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" onClick={onClose}>
            閉じる(Esc)
          </button>
        </div>
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
  const [askPay, setAskPay] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(() => window.innerWidth >= 1500);
  // 直近の1手で動いたカードを強調する(イベントの再生。design 9)
  const flash = useMemo(() => {
    const set = new Set<number>();
    for (const e of session.last) {
      if (['moved', 'entered', 'cast', 'attackDeclared', 'evolved', 'blocked'].includes(e.type) && typeof e.card === 'number') set.add(e.card);
    }
    return set;
  }, [session.last]);

  // 盤面の下に出す「直近の出来事」(CPU の手を目で追えるように)
  const feed = useMemo(() => recentFeed(s, session.log.slice(-80), g.me, 3), [s, session.log, g.me]);

  const pend = s.pending;
  const viewer: PlayerId = g.me ?? (pend && setup.seats[pend.player].kind === 'human' ? pend.player : 0);
  const humanTurn = !!pend && s.winner === null && setup.seats[pend.player].kind === 'human';
  const turnAction = humanTurn && pend!.why === 'turnAction';
  const interactive = turnAction && pend!.player === viewer;
  const legal = g.legal;

  // ターン終了の確認: まだ出せる・チャージできるカードがあるまま終えようとした時の1回目は止める
  const [confirmEnd, setConfirmEnd] = useState(false);
  useEffect(() => {
    setSelected(null);
    setConfirmEnd(false);
  }, [pend?.id]);

  // 支払い: 払い方に選択があるときだけ、タップするマナを選ばせる(自明なら聞かずに自動で払う)
  const [payFor, setPayFor] = useState<{ action: Extract<Action, { type: 'PLAY_CARD' }>; auto: number[] } | null>(null);
  const [payErr, setPayErr] = useState<string | null>(null);
  const act = (a: Action) => {
    setSelected(null);
    if (a.type === 'END_TURN' && !confirmEnd && legal.some((x) => x.type === 'PLAY_CARD' || x.type === 'CHARGE_MANA')) {
      setConfirmEnd(true);
      return;
    }
    if (askPay && a.type === 'PLAY_CARD' && g.me !== null && !a.extra?.pay) {
      const ch = payChoice(mkCtx(s, reg), g.me, a.uid, a.from ?? 'hand', a.face ?? 0, a.extra, false);
      if (ch.need > 0 && !ch.obvious && ch.auto.length === ch.need) {
        setPayErr(null);
        setPayFor({ action: a, auto: ch.auto });
        return;
      }
    }
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

  // 選択中のカード(パネルに名前と全文を出す)
  const selUid = useMemo(() => {
    if (!selected) return null;
    const [kind, id] = selected.split(':');
    if (kind === 'pile') return permByPid(s, Number(id))?.perm.cards[0] ?? null;
    return Number(id);
  }, [selected, s]);
  const selDef = selUid !== null && s.cards[selUid] ? reg.defs[s.cards[selUid].defId] : null;
  const cpuOnly = setup.seats.every((x) => x.kind === 'cpu');
  const showHuman = humanTurn && pend!.why !== 'turnAction';

  // ── ショートカットキー ──
  // 選べるカードの並び(←→で順に選ぶ)
  const cycleKeys = useMemo(() => {
    if (!interactive) return [] as string[];
    const dm = buildDropMap(s, legal);
    const p = s.players[viewer];
    const keys = [
      ...p.hand.map((u) => `hand:${u}`),
      ...p.mana.map((u) => `mana:${u}`),
      ...p.battle.map((x) => `pile:${x.pid}`),
      ...p.grave.map((u) => `grave:${u}`),
    ];
    return keys.filter((k) => dm.has(k));
  }, [interactive, s, legal, viewer]);

  useEffect(() => {
    const clickNth = (sel: string, n: number) => {
      const el = document.querySelectorAll<HTMLElement>(sel)[n];
      if (!el || (el as HTMLButtonElement).disabled) return false;
      el.click();
      return true;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['checkbox', 'range'].includes((t as HTMLInputElement).type)))) return;
      const k = e.key;
      const digit = /^[1-9]$/.test(k) ? Number(k) - 1 : -1;
      const done = () => e.preventDefault();

      // 盤面のダイアログ(行き先の選択・マナの支払い・一覧・棋譜・ヘルプ)が開いているとき
      const back = document.querySelector<HTMLElement>('.modal-back');
      if (back) {
        if (k === 'Escape') {
          back.click();
          return done();
        }
        if (/^[a-z]$/i.test(k) && clickNth(`.modal-back [data-key="${k.toLowerCase()}"]`, 0)) return done();
        if (digit >= 0 && clickNth('.modal-back .choice', digit)) return done();
        if (k === 'Enter' && clickNth('.modal-back button.primary', 0)) return done();
        return;
      }
      if (k === 'Escape') {
        if (menuOpen) setMenuOpen(false);
        else if (selected) setSelected(null);
        else return;
        return done();
      }
      if (k === '?' || (k === '/' && e.shiftKey) || k === 'h' || k === 'H') {
        setHelpOpen(true);
        return done();
      }
      if (k === 'l' || k === 'L') {
        setSideOpen((v) => !v);
        return done();
      }
      if (k === 'o' || k === 'O') {
        setMenuOpen((v) => !v);
        return done();
      }
      if (s.winner !== null) {
        if (k === 'r' || k === 'R') {
          onRematch();
          return done();
        }
        return;
      }
      // 入力パネル(選ぶ・答える)
      if (showHuman) {
        const shape = (pend!.input as { shape: string } | null)?.shape;
        if (shape === 'yesno' && (k === 'y' || k === 'Y' || k === 'Enter')) {
          g.perform({ type: 'ANSWER', id: pend!.id, value: true });
          return done();
        }
        if (shape === 'yesno' && (k === 'n' || k === 'N')) {
          g.perform({ type: 'ANSWER', id: pend!.id, value: false });
          return done();
        }
        if (/^[a-z]$/i.test(k) && clickNth(`.input-panel [data-key="${k.toLowerCase()}"]`, 0)) return done();
        if (digit >= 0) {
          const sel = shape === 'option' || shape === 'order' ? '.input-panel .choice' : '.input-panel .cards .card';
          if (clickNth(sel, digit)) return done();
        }
        if (k === 'Enter' || k === ' ') {
          if (clickNth('.input-panel button.primary', 0)) return done();
        }
        return;
      }
      // CPU 同士の観戦
      if (cpuOnly) {
        if (k === ' ') {
          g.setPaused(!g.paused);
          return done();
        }
        if ((k === 'n' || k === 'N' || k === 'ArrowRight') && g.paused) {
          g.stepOnce();
          return done();
        }
        return;
      }
      if ((k === 'z' || k === 'Z') && setup.allowUndo && g.canUndo && humanTurn) {
        g.undo();
        return done();
      }
      if (!interactive) return;
      // 自分の行動
      if (digit >= 0 && selActs[digit]) {
        act(selActs[digit].action);
        return done();
      }
      if (k === 'Enter' && selActs.length === 1) {
        act(selActs[0].action);
        return done();
      }
      if ((k === 'ArrowRight' || k === 'ArrowLeft') && cycleKeys.length > 0) {
        const i = selected ? cycleKeys.indexOf(selected) : -1;
        const n = cycleKeys.length;
        const next = i < 0 ? (k === 'ArrowRight' ? 0 : n - 1) : (i + (k === 'ArrowRight' ? 1 : n - 1)) % n;
        setSelected(cycleKeys[next]);
        return done();
      }
      if ((k === 'm' || k === 'M') && (stepActs.skipMana || stepActs.endMain)) {
        act((stepActs.skipMana ?? stepActs.endMain)!);
        return done();
      }
      if ((k === 'e' || k === 'E') && stepActs.endTurn) {
        act(stepActs.endTurn);
        return done();
      }
    };
    // ボタンをクリックしたあとにフォーカスが残ると、Enter/Space でそのボタンが再度押されてしまう
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      const b = el?.closest('button');
      if (b) setTimeout(() => b.blur(), 0);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
    };
  });

  // 選んだカードが横スクロールの外にあっても見える位置へ
  useEffect(() => {
    if (!selected) return;
    document.querySelector('.card.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected]);

  // 操作パネル: 画面が広い時は選んだカードの隣に出し、視線の往復を減らす。狭い時は右レールに出す
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!selected || !interactive) return setAnchor(null);
    const el = document.querySelector<HTMLElement>('.card.selected');
    setAnchor(el ? el.getBoundingClientRect() : null);
  }, [selected, interactive, s]);
  const popover = !!anchor && !!selected && interactive && window.innerWidth >= 1000;
  const actionPanel = (
      <div className="action-panel">
        <div className="ap-head">
          <strong>{selDef?.name ?? 'カード'}</strong>
          <button className="small" onClick={() => setSelected(null)} aria-label="閉じる" title="閉じる(Esc)">
            ✕
          </button>
        </div>
        {selDef && <div className="ap-text">{selDef.text}</div>}
        {selActs.length > 0 ? (
          <div className="ap-actions">
            {selActs.map((d, i) => (
              <button key={i} className="choice big" onClick={() => act(d.action)}>
                {i < 9 && <span className="kbd">{i + 1}</span>} {d.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="muted">このカードで今できる操作はありません。</div>
        )}
      </div>
  );

  const tip = TIPS[Math.floor(s.turn / 2) % TIPS.length];

  return (
    <div className={'game' + (sideOpen ? '' : ' side-closed')}>
      <div className="game-head">
        <button onClick={onExit}>← メニュー</button>
        <span className={'status-chip ' + (setup.seats[s.active].kind === 'human' ? 'me' : 'cpu')}>
          {Math.ceil(s.turn / 2)}ターン目 ・ {s.active === (g.me ?? 0) ? (g.me === null ? 'プレイヤー1' : 'あなた') : g.me === null ? 'プレイヤー2' : '相手'} ・{' '}
          {STEP_LABEL[s.step] ?? s.step}
          {session.thinking && <span className="thinking" />}
        </span>
        <span style={{ flex: 1 }} />
        {cpuOnly && (
          <>
            <button onClick={() => g.setPaused(!g.paused)}>{g.paused ? '▶ 再開' : '⏸ 一時停止'}</button>
            <button disabled={!g.paused} onClick={g.stepOnce}>
              ⏭ 1手進める
            </button>
            <label className="speed">
              速度
              <input type="range" min={0} max={1500} step={50} value={1500 - g.speed} onChange={(e) => g.setSpeed(1500 - Number(e.target.value))} />
            </label>
          </>
        )}
        {g.me !== null && g.cpuTurn && (
          <button className={g.fast ? 'on' : ''} onClick={() => g.setFast(!g.fast)} title="CPU の手の間隔をなくして、一気に進めます">
            ⏩ 一気に進める
          </button>
        )}
        {setup.allowUndo && (
          <button disabled={!g.canUndo || !humanTurn} onClick={g.undo} title={
              !humanTurn
                ? '1手戻す: あなたの番になってから使えます'
                : !g.canUndo
                  ? '戻せる手がありません(CPUに手番が移った後や、シールドのブレイク・公開などで情報が出た後は、それ以前に戻せません)'
                  : '1手戻す(Z)'
            }>
            ↶ 1手戻す
          </button>
        )}
        <div className="pop-anchor">
          <button className={menuOpen ? 'on' : ''} onClick={() => setMenuOpen((v) => !v)}>
            ⚙ 表示
          </button>
          {menuOpen && (
            <div className="popover">
              {g.me !== null && (
                <label className="check">
                  <input type="checkbox" checked={peek} onChange={(e) => setPeek(e.target.checked)} /> 自分のシールドを見る
                </label>
              )}
              {g.me !== null && (
                <label className="check" title="オフにすると、常に自動でタップするマナを決めます">
                  <input type="checkbox" checked={askPay} onChange={(e) => setAskPay(e.target.checked)} /> 選べるときはタップするマナを選ぶ
                </label>
              )}
              <label className="check">
                <input type="checkbox" checked={showOpp} onChange={(e) => setShowOpp(e.target.checked)} /> 相手の手札を見る
              </label>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setRecText(rec());
                }}
              >
                棋譜を見る・保存
              </button>
              <div className="muted" style={{ fontSize: 12 }}>
                シード {setup.seed}
              </div>
            </div>
          )}
        </div>
        <button onClick={() => setHelpOpen(true)} title="ショートカットキーと Tips(?)">
          ?
        </button>
        <button className={sideOpen ? 'on' : ''} onClick={() => setSideOpen((v) => !v)} title="カードの詳細・待機中の能力・ログ(L)">
          ログ
        </button>
      </div>

      <div className="stage">
        <div className="field">
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
                  />

        {/* CPU が考えている間の表示 */}
        {!interactive && !showHuman && s.winner === null && pend && (
          <div className="thinking-pill">
            {activeLabel}が考えています…
            {session.thinking && <span className="thinking" />}
            <div className="tip">💡 {tip}</div>
          </div>
        )}

        {/* 入力(選ぶ・答える)は盤面の中央にパネルで出す */}
        {showHuman && s.winner === null && (
          <div className="input-layer">
            <div className="input-panel">
              <InputWidget s={s} pending={pend!} me={g.me} onHover={setHover} onAnswer={(value) => g.perform({ type: 'ANSWER', id: pend!.id, value })} />
            </div>
          </div>
        )}

        {/* 勝敗 */}
        {s.winner !== null && (
          <div className="input-layer">
            <div className="input-panel result">
              <h2>
                {s.winner === 'draw'
                  ? '引き分け'
                  : g.me === null
                    ? `プレイヤー${(s.winner as number) + 1}の勝ち`
                    : s.winner === g.me
                      ? 'あなたの勝ち!'
                      : 'あなたの負け…'}
              </h2>
              <p className="muted">({s.loseReason})</p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="primary" onClick={onRematch}>
                  もう一度
                </button>
                <button onClick={() => setRecText(rec())}>棋譜を保存</button>
                <button onClick={onExit}>メニューへ</button>
              </div>
            </div>
          </div>
        )}

        {feed.length > 0 && (
          <div className="feed" aria-live="polite" aria-label="直近の出来事">
            {feed.map((f, i) => (
              <div key={f.id} className={'feed-line' + (i === feed.length - 1 ? ' latest' : '')}>
                {f.text}
              </div>
            ))}
          </div>
        )}
        </div>

        {/* 盤面の右(中央右): カードの詳細・選んだカードの操作・ターン操作を、カードの近くにまとめる */}
        <div className="rail">
          {/* カードの詳細は、ホバー中のカード、なければ選択中のカードを出す(タッチ操作でも読める) */}
          <div className="rail-hover">
            <CardDetail s={s} uid={hover ?? selUid} />
          </div>
          {!sideOpen && s.pool.length > 0 && <PoolPanel s={s} />}
          {interactive && (
            <div className="rail-action">
              {selected ? (
                !popover ? actionPanel : <div className="rail-hint">選んだカードの隣に、できる操作を出しています</div>
              ) : (
                <div className="rail-hint">カードを選ぶと、できる操作がここに出ます</div>
              )}
            </div>
          )}
          {interactive && (
            <div className="dock">
              {stepActs.skipMana && (
                <button onClick={() => act(stepActs.skipMana!)}>
                  マナチャージしない <span className="kbd">M</span>
                </button>
              )}
              {stepActs.endMain && (
                <button onClick={() => act(stepActs.endMain!)}>
                  メインを終える <span className="kbd">M</span>
                </button>
              )}
              {stepActs.endTurn && (
                <button className="primary" onClick={() => act(stepActs.endTurn!)}>
                  {confirmEnd ? 'まだ出せるカードがあります。もう一度で終了' : 'ターン終了'} <span className="kbd">E</span>
                </button>
              )}
            </div>
          )}
          {interactive && <div className="rail-tip">💡 {tip}</div>}
        </div>

        {session.error && (
          <div className="toast" role="alert">
            <div>{session.error}</div>
            {g.cpuTurn && (
              <div className="row" style={{ marginTop: 6 }}>
                <button onClick={g.retryCpu}>もう一度考えさせる</button>
                <button onClick={g.forceMove} title="合法手の先頭で進めます(棋譜に残ります)">
                  合法手で進める
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {popover && anchor && (
        <div
          className="action-pop"
          // 手札など下半分のカードは、隣のカードを隠さないよう真上に、上半分のカードは真下に出す
          style={{
            left: Math.max(8, Math.min(anchor.left, window.innerWidth - 300)),
            ...(anchor.top > window.innerHeight / 2 ? { bottom: window.innerHeight - anchor.top + 8 } : { top: anchor.bottom + 8 }),
          }}
        >
          {actionPanel}
        </div>
      )}
      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
      {payFor &&
        (() => {
          const a = payFor.action;
          const me = g.me ?? 0;
          const ctx = mkCtx(s, reg);
          const base = planPlay(ctx, me, a.uid, a.from ?? 'hand', a.face ?? 0, a.extra, false);
          const mana = s.players[me].mana.filter((u) => !s.cards[u].tapped && u !== a.uid);
          return (
            <div className="modal-back" onClick={() => setPayFor(null)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h2>タップするマナを選ぶ</h2>
                <p className="muted">
                  {cardName(s, a.uid)} — {base.need}枚({base.civs.map((x) => CIV_NAME[x]).join('・')}を含める)。自動の候補を選んであります。
                </p>
                <PaymentWidget
                  s={s}
                  pending={{ id: 0, player: me, why: 'ack', input: null }}
                  me={me}
                  spec={{ shape: 'payment', need: base.need, mana }}
                  initial={payFor.auto}
                  onHover={setHover}
                  onAnswer={(v) => {
                    const pay = v as number[];
                    const chk = planPlay(ctx, me, a.uid, a.from ?? 'hand', a.face ?? 0, { ...(a.extra ?? {}), pay }, false);
                    if (!chk.ok) {
                      setPayErr(chk.err ?? '支払えません');
                      return;
                    }
                    setPayFor(null);
                    g.perform({ ...a, extra: { ...(a.extra ?? {}), pay } });
                  }}
                />
                {payErr && <div style={{ color: 'var(--bad)' }}>{payErr}</div>}
                <div className="row" style={{ marginTop: 8 }}>
                  <button
                    data-key="a"
                    onClick={() => {
                      setPayFor(null);
                      g.perform(a);
                    }}
                  >
                    自動で払う <span className="kbd">A</span>
                  </button>
                  <button data-key="c" onClick={() => setPayFor(null)}>
                    キャンセル <span className="kbd">C</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {sideOpen && (
        <div className="side">
          <PoolPanel s={s} />
          <LogPanel s={s} log={session.log} me={g.me} />
        </div>
      )}

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
