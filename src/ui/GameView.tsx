// 対戦画面: 盤面・待機プール・因果ツリーのログ・入力ウィジェット・操作ボタン。
// カード詳細(CardDetail)・待機中の能力/ログ(PoolPanel / LogPanel)は別ファイルに分けた。他の画面からは、従来どおりここから import できる。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { payChoice } from '../engine/procs';
import { mkCtx, permByPid } from '../engine/state';
import type { Action, Ev, PlayerId } from '../engine/types';
import { Board, buildDropMap, selectedActions } from './Board';
import { CardDetail } from './CardDetail';
import { CardView } from './CardView';
import { cardName, recentFeed, reg } from './format';
import { PayDialog, RecordDialog } from './GameDialogs';
import { HelpPanel, TIPS, WATCH_TIPS } from './HelpPanel';
import { LogPanel, PoolPanel } from './SidePanels';
import { endTurnWarning } from './endTurn';
import { whyUnplayable } from './unplayable';
import { Kbd } from './Kbd';
import { digitOf, KEY, keyToken } from './keymap';
import { InputWidget } from './Widgets';
import { makeRecord, type GameSetup, useGame } from './useGame';
import { loadJson, saveJson } from './util';
import { Splitter, ResizablePanel, useRailWidth } from './Resizable';
import { FxLayer } from './FxLayer';
import { FxAttack } from './FxAttack';
import { FxGhosts } from './FxGhosts';
import { useFxGate } from './useFxGate';
import { FxTicker } from './FxTicker';
import { cuesOf, drawCuesOf, FX_MODE_LABEL, FX_MODES, fxHoldMs, fxScale, loadFxMode, removalCuesOf, removalsOf, saveFxMode, STEP_LABEL, type FxMode } from './fx';

/** 質問が出てからこの間は、肯定のキー(Enter・Space・Y)を受け付けない(前の Enter の持ち越しで「はい」にならないように) */
const ASK_GUARD_MS = 250;

/** 直近の1手で動いたカードとして強調するイベント */
const FLASH_EVENTS = ['moved', 'entered', 'cast', 'attackDeclared', 'evolved', 'blocked'];

/** イベントのうち match に合うものの、カード(uid)の集合 */
function cardsOfEvents(events: Ev[], match: (e: Ev) => boolean): Set<number> {
  const set = new Set<number>();
  for (const e of events) if (match(e) && typeof e.card === 'number') set.add(e.card);
  return set;
}

export function GameView({ setup, onExit, onRematch }: { setup: GameSetup; onExit: () => void; onRematch: () => void }) {
  // 演出(通常・高速・オフ。オフにすると、オーバーレイ・アニメーション・演出のための CPU の待ち時間のすべてが無効になる)
  const [fxMode, setFxMode] = useState<FxMode>(loadFxMode);
  const fxOn = fxMode !== 'off';
  const scale = fxScale(fxMode);
  const g = useGame(setup, fxMode);
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
  // ログ・待機中の能力は、盤面の右の欄(rail)の中に出す(別の欄も、浮かぶパネルも作らない)。観戦(CPU 同士)では、ログが主な情報なので既定で開く
  const [sideOpen, setSideOpen] = useState(() => setup.seats.every((x) => x.kind === 'cpu'));
  const [railW, setRailW] = useRailWidth();
  const stageRef = useRef<HTMLDivElement>(null);
  // 直近の1手で動いたカードを強調する(イベントの再生。design 9)
  const flash = useMemo(() => cardsOfEvents(session.last, (e) => FLASH_EVENTS.includes(e.type)), [session.last]);

  // 演出: 直近の1手のイベントから作る(開始直後は、最初のターンの開始を見せる)。「一気に進める」中は出さない
  const fxActive = fxOn && !g.fast;
  const fxEvents = session.actions.length === 0 ? session.log : session.last;
  const fxCues = useMemo(() => (fxActive ? cuesOf(s, fxEvents, g.me, scale) : []), [fxActive, fxEvents, scale]);
  // 軽いチップ(ドロー・離れたカード)。ステップの切り替わりは FxTicker が状態の差分から作る
  const lightCues = useMemo(() => (fxActive ? [...drawCuesOf(fxEvents, g.me, scale), ...removalCuesOf(s, fxEvents, g.me, scale)] : []), [fxActive, fxEvents, scale]);
  const removals = useMemo(() => (fxActive ? removalsOf(fxEvents) : []), [fxActive, fxEvents]);
  // 勝敗のパネルは、最後の一撃の演出(ダイレクトアタックなど)が終わってから出す。演出が無効なら、すぐ出す
  const [resultShown, setResultShown] = useState(() => s.winner !== null);
  useEffect(() => {
    if (s.winner === null) return setResultShown(false);
    if (!fxActive) return setResultShown(true);
    const t = setTimeout(() => setResultShown(true), fxHoldMs(s, session.last, g.me, scale));
    return () => clearTimeout(t);
  }, [s.winner, fxActive]);
  // 質問(選択・確認の入力パネル)は、直前の手の演出が終わってから出す。演出の途中に選択画面が割り込まないように。
  // 演出が無効なら待たない。待つのは表示だけで、質問そのもの(状態)は変わらない
  const inputHold = useMemo(() => (fxActive ? fxHoldMs(s, session.last, g.me, scale) : 0), [fxActive, session.last, scale]);
  const inputReady = useFxGate(inputHold, session.last);
  const trumps = useMemo(
    () => (fxActive ? cardsOfEvents(session.last, (e) => (e.type === 'entered' && e.via === 'revolutionChange') || (e.type === 'evolved' && e.via === 'invade')) : new Set<number>()),
    [fxActive, session.last],
  );
  const blockers = useMemo(() => (fxActive ? cardsOfEvents(session.last, (e) => e.type === 'blocked') : new Set<number>()), [fxActive, session.last]);
  const attackers = useMemo(() => (fxActive ? cardsOfEvents(session.last, (e) => e.type === 'attackDeclared') : new Set<number>()), [fxActive, session.last]);
  const shieldHit = useMemo(() => {
    const set = new Set<PlayerId>();
    if (fxActive) for (const e of session.last) if (e.type === 'shieldBroken') set.add(e.owner as PlayerId);
    return set;
  }, [fxActive, session.last]);

  // 手番の色: 自分(観戦は1P)は青、相手(2P)は赤。盤面の外・ヘッダーをこの色に染めて、どちらの番かを一目で分かるようにする
  const turnColor = (g.me === null ? s.active === 0 : s.active === g.me) ? 'mine' : 'theirs';

  // 盤面の下に出す「直近の出来事」(CPU の手を目で追えるように)
  const feed = useMemo(() => recentFeed(s, session.log.slice(-80), g.me, 3), [s, session.log, g.me]);

  const pend = s.pending;
  const viewer: PlayerId = g.me ?? (pend && setup.seats[pend.player].kind === 'human' ? pend.player : 0);
  const humanTurn = !!pend && s.winner === null && setup.seats[pend.player].kind === 'human';
  const turnAction = humanTurn && pend!.why === 'turnAction';
  const interactive = turnAction && pend!.player === viewer;
  const legal = g.legal;

  // ターン終了の確認: まだ出せる・チャージできるカードがあるまま終えようとした時の1回目は止める
  // ターン終了の確認(endTurn.ts): 理由の文言が入っている間は「もう一度押せば終了」。設定で消せる
  const [endWarn, setEndWarn] = useState<string | null>(null);
  // 質問の候補の上のカーソル(← → で動かし、右レールに詳細を出す。Enter で選ぶ)
  const [pickCursor, setPickCursor] = useState<number | null>(null);
  useEffect(() => {
    if (pickCursor === null) return;
    const uid = document.querySelectorAll<HTMLElement>('.input-panel .cards .card')[pickCursor]?.getAttribute('data-uid');
    if (uid) setHover(Number(uid));
  }, [pickCursor]);
  // 使えないカードをクリックした時の理由(数秒で消える。選択・手番の変化でも消える)
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (notice === null) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  const [confirmOn, setConfirmOn] = useState(() => loadJson<unknown>('dmsim.confirmEnd', true) !== false);
  const toggleConfirm = () =>
    setConfirmOn((v) => {
      saveJson('dmsim.confirmEnd', !v);
      return !v;
    });
  /** 確認を出して止めたなら true */
  const holdEnd = (): boolean => {
    if (!confirmOn || endWarn !== null) return false;
    const w = endTurnWarning(s, legal, viewer);
    if (w === null) return false;
    setEndWarn(w);
    return true;
  };
  useEffect(() => {
    setSelected(null);
    setEndWarn(null);
    setNotice(null);
    setPickCursor(null);
  }, [pend?.id]);

  // 支払い: 払い方に選択があるときだけ、タップするマナを選ばせる(自明なら聞かずに自動で払う)
  const [payFor, setPayFor] = useState<{ action: Extract<Action, { type: 'PLAY_CARD' }>; auto: number[] } | null>(null);
  const [payErr, setPayErr] = useState<string | null>(null);
  const act = (a: Action) => {
    setSelected(null);
    if (a.type === 'END_TURN' && holdEnd()) return;
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
  const askHuman = humanTurn && pend!.why !== 'turnAction';
  const showHuman = askHuman && inputReady;
  /** 質問が出ているが、演出が終わるのを待っている間(「考え中」は出さない) */
  const waitingInput = askHuman && !inputReady;

  // ── ショートカットキー ──(キーの意味と割り当ては keymap.ts)
  // 選べるカードの並び。列ごとに持つ(画面の上から: バトル・マナ・墓地・手札)。← → は列の中、↑ ↓ は列の移動
  const cycleRows = useMemo(() => {
    if (!interactive) return [] as string[][];
    const dm = buildDropMap(s, legal);
    const p = s.players[viewer];
    return [
      p.battle.map((x) => `pile:${x.pid}`),
      p.mana.map((u) => `mana:${u}`),
      p.grave.map((u) => `grave:${u}`),
      p.hand.map((u) => `hand:${u}`),
    ]
      .map((row) => row.filter((k) => dm.has(k)))
      .filter((row) => row.length > 0);
  }, [interactive, s, legal, viewer]);

  // 前の質問に答えた Enter が次の質問に持ち越されて、意図せず「はい」にならないよう、質問が出た直後の肯定キーは受け付けない
  const askedAt = useRef(0);
  useEffect(() => {
    askedAt.current = Date.now();
  }, [pend?.id]);

  // マナステップから E を押した時: マナチャージを飛ばしてメインに入ったら、続けてターンを終える
  const endAfterSkip = useRef(false);
  useEffect(() => {
    if (!endAfterSkip.current) return;
    endAfterSkip.current = false;
    if (interactive && stepActs.endTurn) g.perform(stepActs.endTurn);
  }, [pend?.id]);

  // Q キー(メニューへ戻る)は、もう一度押して確定する(押し間違いで対戦を離れないように)
  const [confirmQuit, setConfirmQuit] = useState(false);
  useEffect(() => {
    if (!confirmQuit) return;
    const t = setTimeout(() => setConfirmQuit(false), 3000);
    return () => clearTimeout(t);
  }, [confirmQuit]);

  // 一覧(墓地・マナ・シールド)のキーボードからの表示要求
  const [listReq, setListReq] = useState<{ p: PlayerId; zone: 'mana' | 'grave' | 'shield'; n: number } | null>(null);

  useEffect(() => {
    const clickNth = (sel: string, n: number) => {
      const el = document.querySelectorAll<HTMLElement>(sel)[n];
      if (!el || (el as HTMLButtonElement).disabled) return false;
      el.click();
      return true;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = keyToken(e);
      if (k === null) return;
      const arrow = k.startsWith('Arrow');
      // 押しっぱなし(キーリピート)は無視する。確認つきの操作(ターン終了)や、次の質問への「はい」が連続して通らないように。矢印だけは続けて動かせる
      if (e.repeat && !arrow) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const inType = tag === 'INPUT' ? (t as HTMLInputElement).type : '';
      const back = document.querySelector<HTMLElement>('.modal-back');
      // 入力欄の中ではショートカットを使わない(ダイアログを閉じる Esc だけは通す)
      if ((tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && inType !== 'checkbox' && inType !== 'range')) && !(k === 'Escape' && back)) return;
      // スライダー・チェックボックスの操作(矢印・Space)は、その部品に任せる
      if ((inType === 'range' || inType === 'checkbox') && (arrow || k === ' ')) return;
      const digit = digitOf(k);
      const done = () => e.preventDefault();

      // 盤面のダイアログ(行き先の選択・マナの支払い・一覧・棋譜・ヘルプ)が開いているとき
      if (back) {
        if (k === 'Escape') {
          back.click();
          return done();
        }
        if (/^[a-z]$/.test(k) && clickNth(`.modal-back [data-key="${k}"]`, 0)) return done();
        if (digit >= 0 && clickNth('.modal-back .choice, .modal-back .card.selectable', digit)) return done();
        if ((k === 'Enter' || k === ' ') && clickNth('.modal-back button.primary', 0)) return done();
        return;
      }
      // Esc: 開いているものを閉じる → 選択を外す → 質問に「いいえ・選ばない・やり直す」と答える
      if (k === 'Escape') {
        if (menuOpen) {
          setMenuOpen(false);
          return done();
        }
        if (selected) {
          setSelected(null);
          return done();
        }
        if (showHuman && s.winner === null && clickNth('.input-panel [data-key="n"], .input-panel [data-key="r"]', 0)) return done();
        return;
      }
      // 入力パネル(選ぶ・答える)。この中のキー(Q W E など)は、画面全体のキーより先に使う
      if (showHuman && s.winner === null) {
        const shape = (pend!.input as { shape: string } | null)?.shape;
        const affirm = k === 'Enter' || k === ' ' || k === KEY.yes;
        if (affirm && Date.now() - askedAt.current < ASK_GUARD_MS) return done();
        // 候補のカード(pick・割り振りの札・マナの支払い)の上のカーソル: 詳細を読んでから Enter で選ぶ
        if (shape === 'pick' || shape === 'assign' || shape === 'payment') {
          const cardSel = shape === 'assign' ? '.input-panel .cards.items .card' : '.input-panel .cards .card';
          const n = document.querySelectorAll(cardSel).length;
          if (n > 0 && (k === 'ArrowLeft' || k === 'ArrowRight')) {
            setPickCursor((cur) => (cur === null ? (k === 'ArrowRight' ? 0 : n - 1) : (cur + (k === 'ArrowRight' ? 1 : n - 1)) % n));
            return done();
          }
          if (k === 'Enter' && pickCursor !== null && pickCursor < n && clickNth(cardSel, pickCursor)) return done();
        }
        if (/^[a-z]$/.test(k) && clickNth(`.input-panel [data-key="${k}"]`, 0)) return done();
        if (digit >= 0) {
          const sel = shape === 'option' || shape === 'order' ? '.input-panel .choice' : shape === 'assign' ? '.input-panel .cards.items .card' : '.input-panel .cards .card';
          if (clickNth(sel, digit)) return done();
        }
        if ((k === 'Enter' || k === ' ') && clickNth('.input-panel button.primary', 0)) return done();
      }
      // 画面全体のキー
      if (k === '?' || k === KEY.help) {
        setHelpOpen(true);
        return done();
      }
      if (k === KEY.log) {
        setSideOpen((v) => !v);
        return done();
      }
      if (k === KEY.options) {
        setMenuOpen((v) => !v);
        return done();
      }
      if (k === KEY.record) {
        setRecText(rec());
        return done();
      }
      if (k === KEY.quit) {
        if (confirmQuit) onExit();
        else setConfirmQuit(true);
        return done();
      }
      if (k === KEY.fast && g.me !== null) {
        g.setFast(!g.fast);
        return done();
      }
      if (g.me !== null && k === KEY.peek) {
        setPeek((v) => !v);
        return done();
      }
      if (g.me !== null && k === KEY.askPay) {
        setAskPay((v) => !v);
        return done();
      }
      if (k === KEY.confirmEnd) {
        toggleConfirm();
        return done();
      }
      if (k === KEY.oppHand && g.me !== null) {
        setShowOpp((v) => !v);
        return done();
      }
      if (k === KEY.grave || k === KEY.manaList) {
        // Shift を押すと相手の一覧
        const who: PlayerId = e.shiftKey ? (viewer === 0 ? 1 : 0) : viewer;
        setListReq((cur) => ({ p: who, zone: k === KEY.grave ? 'grave' : 'mana', n: (cur?.n ?? 0) + 1 }));
        return done();
      }
      if (showHuman && s.winner === null) return;
      if (s.winner !== null) {
        if (k === 'Enter' && Date.now() - askedAt.current < ASK_GUARD_MS) return done();
        if (k === 'Enter' || k === KEY.redo) {
          onRematch();
          return done();
        }
        return;
      }
      // CPU 同士の観戦
      if (cpuOnly) {
        if (k === ' ') {
          g.setPaused(!g.paused);
          return done();
        }
        if (k === 'ArrowRight' && g.paused) {
          g.stepOnce();
          return done();
        }
        return;
      }
      if (k === KEY.undo && setup.allowUndo && g.canUndo && humanTurn) {
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
      if (arrow) {
        if (cycleRows.length === 0) return;
        const r = selected ? cycleRows.findIndex((row) => row.includes(selected)) : -1;
        if (r < 0) {
          // 何も選んでいない時: 手札の列から始める(← ↑ は末尾、→ ↓ は先頭)
          const hand = cycleRows.findIndex((row) => row[0].startsWith('hand:'));
          const row = cycleRows[hand >= 0 ? hand : cycleRows.length - 1];
          setSelected(k === 'ArrowLeft' || k === 'ArrowUp' ? row[row.length - 1] : row[0]);
          return done();
        }
        const row = cycleRows[r];
        const i = row.indexOf(selected!);
        if (k === 'ArrowLeft' || k === 'ArrowRight') {
          setSelected(row[(i + (k === 'ArrowRight' ? 1 : row.length - 1)) % row.length]);
        } else {
          const to = cycleRows[r + (k === 'ArrowDown' ? 1 : -1)];
          if (to) setSelected(to[Math.min(i, to.length - 1)]);
        }
        return done();
      }
      if (k === KEY.skipMana && (stepActs.skipMana || stepActs.endMain)) {
        act((stepActs.skipMana ?? stepActs.endMain)!);
        return done();
      }
      if (k === KEY.endTurn) {
        if (stepActs.endTurn) {
          act(stepActs.endTurn);
          return done();
        }
        // マナステップ: マナチャージを飛ばして、そのままターンを終える(出せる・チャージできるカードがあれば、1回目は確認)
        if (stepActs.skipMana) {
          if (!holdEnd()) {
            endAfterSkip.current = true;
            g.perform(stepActs.skipMana);
          }
          return done();
        }
      }
    };
    // ボタンをクリックしたあとにフォーカスが残ると、Enter/Space でそのボタンが再度押されてしまう
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      const b = el?.closest('button');
      // マウスで押した時だけ外す(キーボードで押した時に外すと、フォーカスの流れが途切れる)
      if (b && e.detail > 0) setTimeout(() => b.blur(), 0);
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
                {i < 9 && <Kbd k={String(i + 1)} />} {d.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="muted">{selUid !== null ? whyUnplayable(s, viewer, selUid) : 'できる操作がありません'}</div>
        )}
      </div>
  );

  const tips = cpuOnly ? WATCH_TIPS : TIPS;
  const tip = tips[Math.floor(s.turn / 2) % tips.length];

  return (
    <div data-turn={s.winner === null ? turnColor : undefined} className={'game' + (fxActive ? ' fx' : '') + (fxActive && fxMode === 'fast' ? ' fx-fast' : '')} style={fxActive ? ({ '--fx-scale': scale } as React.CSSProperties) : undefined}>
      <div className="game-head">
        <button className={confirmQuit ? 'on' : ''} onClick={onExit} title="メニューへ戻る(対戦は自動保存。Q を2回)">
          {confirmQuit ? 'もう一度 Q でメニューへ' : '← メニュー'} <Kbd k={KEY.quit} />
        </button>
        <span className={'status-chip ' + (setup.seats[s.active].kind === 'human' ? 'me' : 'cpu')}>
          {Math.ceil(s.turn / 2)}ターン目 ・ {s.active === (g.me ?? 0) ? (g.me === null ? 'プレイヤー1' : 'あなた') : g.me === null ? 'プレイヤー2' : '相手'} ・{' '}
          {STEP_LABEL[s.step] ?? s.step}
          {session.thinking && <span className="thinking" />}
        </span>
        <span style={{ flex: 1 }} />
        {cpuOnly && (
          <>
            <button onClick={() => g.setPaused(!g.paused)}>
              {g.paused ? '▶ 再開' : '⏸ 一時停止'} <Kbd k=" " />
            </button>
            <button disabled={!g.paused} onClick={g.stepOnce}>
              ⏭ 1手進める <Kbd k="ArrowRight" />
            </button>
            <label className="speed" title="演出が有効な間は、演出の長さより速くならない(さらに速くするには、設定の「演出」をなしにする)">
              速度
              <input type="range" min={0} max={1500} step={50} value={1500 - g.speed} onChange={(e) => g.setSpeed(1500 - Number(e.target.value))} />
            </label>
          </>
        )}
        {/* CPU の手番だけ出し入れすると、ヘッダーのレイアウトが揺れる。常に出して、効くのは CPU の手番(人間の番にも切り替えておける) */}
        {g.me !== null && (
          <button className={g.fast ? 'on' : ''} aria-pressed={g.fast} onClick={() => g.setFast(!g.fast)} title="CPU の待ち時間をなくす(CPU の手番から有効)">
            ⏩ 一気に進める <Kbd k={KEY.fast} />
          </button>
        )}
        {setup.allowUndo && (
          <button disabled={!g.canUndo || !humanTurn} onClick={g.undo} title={
              !humanTurn
                ? '1手戻す: 自分の番で使えます'
                : !g.canUndo
                  ? '戻せる手がありません(CPU の手番後、シールドブレイク・公開の後は戻せない)'
                  : '1手戻す(Z)'
            }>
            ↶ 1手戻す <Kbd k={KEY.undo} />
          </button>
        )}
        <div className="pop-anchor">
          <button className={menuOpen ? 'on' : ''} onClick={() => setMenuOpen((v) => !v)}>
            ⚙ 表示 <Kbd k={KEY.options} />
          </button>
          {menuOpen && (
            <div className="popover">
              {g.me !== null && (
                <label className="check">
                  <input type="checkbox" checked={peek} onChange={(e) => setPeek(e.target.checked)} /> 自分のシールドを見る <Kbd k={KEY.peek} />
                </label>
              )}
              {g.me !== null && (
                <label className="check" title="オフで常に自動払い">
                  <input type="checkbox" checked={askPay} onChange={(e) => setAskPay(e.target.checked)} /> 選べるときはタップするマナを選ぶ <Kbd k={KEY.askPay} />
                </label>
              )}
              <label className="check" title="高速は約2倍の速さ。オフは演出なし(従来の表示)">
                演出{' '}
                <select
                  value={fxMode}
                  onChange={(e) => {
                    const m = e.target.value as FxMode;
                    setFxMode(m);
                    saveFxMode(m);
                  }}
                >
                  {FX_MODES.map((m) => (
                    <option key={m} value={m}>
                      {FX_MODE_LABEL[m]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check" title="出せるカードを残したまま終える時に確認">
                <input type="checkbox" checked={confirmOn} onChange={toggleConfirm} /> ターン終了の確認を出す <Kbd k={KEY.confirmEnd} />
              </label>
              <label className="check">
                <input type="checkbox" checked={showOpp} onChange={(e) => setShowOpp(e.target.checked)} /> 相手の手札を見る{' '}
                {g.me !== null && <Kbd k={KEY.oppHand} />}
              </label>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setRecText(rec());
                }}
              >
                棋譜を見る・保存 <Kbd k={KEY.record} />
              </button>
              <div className="muted" style={{ fontSize: 12 }}>
                シード {setup.seed}
              </div>
            </div>
          )}
        </div>
        <button onClick={() => setHelpOpen(true)} title="ヘルプ(?)">
          ? ヘルプ <Kbd k={KEY.help} />
        </button>
        <button className={sideOpen ? 'on' : ''} onClick={() => setSideOpen((v) => !v)} title="カードの詳細・待機中の能力・ログ(L)">
          ログ <Kbd k={KEY.log} />
        </button>
      </div>

      <div className="stage" ref={stageRef} style={{ '--rail-w': railW + 'px' } as React.CSSProperties}>
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
          onSelect={(k) => {
            setNotice(null);
            setSelected(k);
          }}
          onExplain={(u) => {
            setSelected(null);
            setNotice(`${cardName(s, u)}: ${whyUnplayable(s, viewer, u)}`);
          }}
          flash={flash}
          hit={shieldHit}
          attackers={attackers}
          blockers={blockers}
          trumps={trumps}
          listReq={listReq}
        />
        <FxLayer cues={fxCues} token={session.last} enabled={fxActive} />
        <FxGhosts s={s} removals={removals} token={session.last} enabled={fxActive} scale={scale} />
        <FxAttack events={fxEvents} token={session.last} enabled={fxActive} scale={scale} />
        <FxTicker
          scale={scale}
          draws={lightCues}
          drawToken={session.last}
          step={{ key: `${s.turn}:${s.active}:${s.step}`, step: s.step, active: s.active, me: g.me }}
          enabled={fxActive}
        />

        {/* CPU が考えている間の表示 */}
        {!interactive && !showHuman && !waitingInput && s.winner === null && pend && (
          <div className="thinking-pill">
            {activeLabel}が考え中…
            {session.thinking && <span className="thinking" />}
            <div className="tip">💡 {tip}</div>
          </div>
        )}

        {/* 入力(選ぶ・答える)は盤面の中央にパネルで出す */}
        {showHuman && s.winner === null && (
          <div className="input-layer">
            <ResizablePanel boxKey="dmsim.inputBox" className="input-panel input-box" title="入力" label="入力パネル" minW={280} minH={120}>
              <InputWidget s={s} pending={pend!} me={g.me} onHover={setHover} cursor={pickCursor} onAnswer={(value) => g.perform({ type: 'ANSWER', id: pend!.id, value })} />
            </ResizablePanel>
          </div>
        )}

        {/* 勝敗 */}
        {s.winner !== null && resultShown && (
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
                  もう一度 <Kbd k="Enter" />
                </button>
                <button onClick={() => setRecText(rec())}>
                  棋譜を保存 <Kbd k={KEY.record} />
                </button>
                <button onClick={onExit}>
                  メニューへ <Kbd k={KEY.quit} />
                </button>
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

        {/* 盤面と右の欄の境界(つまんで動かせる) */}
        <Splitter width={railW} onChange={setRailW} stageRef={stageRef} />

        {/* 盤面の右(中央右): カードの詳細・選んだカードの操作・ターン操作を、カードの近くにまとめる */}
        <div className="rail">
          {/* カードの詳細は、ホバー中のカード、なければ選択中のカードを出す(タッチ操作でも読める) */}
          <div className="rail-hover">
            <CardDetail s={s} uid={hover ?? selUid} reveal={peek && (hover ?? selUid) !== null && s.cards[(hover ?? selUid) as number]?.owner === viewer} />
          </div>
          {!sideOpen && s.pool.length > 0 && <PoolPanel s={s} />}
          {interactive && (
            <div className="rail-action">
              {selected ? (
                !popover ? actionPanel : <div className="rail-hint">操作は選んだカードの隣に表示</div>
              ) : (
                <div className={'rail-hint' + (notice ? ' warn' : '')} role="status">
                  {notice ?? 'カードを選ぶと操作を表示'}
                </div>
              )}
            </div>
          )}
          {interactive && (
            <div className="dock">
              {stepActs.skipMana && (
                <button onClick={() => act(stepActs.skipMana!)}>
                  マナチャージしない <Kbd k={KEY.skipMana} />
                </button>
              )}
              {stepActs.endMain && (
                <button onClick={() => act(stepActs.endMain!)}>
                  メインを終える <Kbd k={KEY.skipMana} />
                </button>
              )}
              {stepActs.endTurn && (
                <button className="primary" onClick={() => act(stepActs.endTurn!)}>
                  {endWarn !== null ? `${endWarn}。もう一度で終了` : 'ターン終了'} <Kbd k={KEY.endTurn} />
                </button>
              )}
              {/* マナステップからも、そのままターンを終えられる(マナチャージを飛ばして終了) */}
              {stepActs.skipMana && !stepActs.endTurn && (
                <button
                  className="primary"
                  onClick={() => {
                    if (!holdEnd()) {
                      endAfterSkip.current = true;
                      g.perform(stepActs.skipMana!);
                    }
                  }}
                >
                  {endWarn !== null ? `${endWarn}。もう一度で終了` : 'ターン終了'} <Kbd k={KEY.endTurn} />
                </button>
              )}
            </div>
          )}
          {interactive && <div className="rail-tip">💡 {tip}</div>}
          {/* ログと待機中の能力: 右の欄の中に出す。幅は仕切りで変えられる */}
          {sideOpen && (
            <section className="rail-log" aria-label="対戦ログ">
              <div className="rail-log-head">
                <strong>対戦ログ・待機中の能力</strong>
                <button className="small" onClick={() => setSideOpen(false)} aria-label="ログを閉じる" title="閉じる(L)">
                  ✕
                </button>
              </div>
              <PoolPanel s={s} />
              <LogPanel s={s} log={session.log} me={g.me} />
            </section>
          )}
        </div>

        {g.saveStatus !== 'ok' && (
          <div className="toast" role="status" style={{ bottom: session.error ? 96 : undefined }}>
            {g.saveStatus === 'failed'
              ? '⚠ 自動保存できません。画面を閉じると対戦を再開できません。'
              : '⚠ 別タブの自動保存を上書き中。'}
          </div>
        )}
        {session.error && (
          <div className="toast" role="alert">
            <div>{session.error}</div>
            {g.cpuTurn && (
              <div className="row" style={{ marginTop: 6 }}>
                <button onClick={g.retryCpu}>もう一度考えさせる</button>
                <button onClick={g.forceMove} title="先頭の合法手で進める(棋譜に残る)">
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
      {payFor && (
        <PayDialog
          s={s}
          me={g.me ?? 0}
          action={payFor.action}
          auto={payFor.auto}
          error={payErr}
          onHover={setHover}
          onError={setPayErr}
          onPay={(pay) => {
            setPayFor(null);
            g.perform({ ...payFor.action, extra: { ...(payFor.action.extra ?? {}), pay } });
          }}
          onAuto={() => {
            setPayFor(null);
            g.perform(payFor.action);
          }}
          onCancel={() => setPayFor(null)}
        />
      )}

      {recText !== null && <RecordDialog seed={setup.seed} text={recText} onClose={() => setRecText(null)} />}
    </div>
  );
}

export { CardDetail, CardView, LogPanel, PoolPanel };
