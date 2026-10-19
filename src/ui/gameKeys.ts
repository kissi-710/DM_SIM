// 対戦画面のショートカットキー(キーの意味と割り当ては keymap.ts)。
// GameView の状態・操作を GameKeyCtx にまとめて受け取る(描画のたびに作り直す)。キーごとの分岐は、上から優先順に並んでいる。
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Action, GameState, Pending, PlayerId } from '../engine/types';
import type { Drop } from './dropMap';
import { digitOf, KEY, keyToken } from './keymap';
import type { useGame } from './useGame';

/** 質問が出てからこの間は、肯定のキー(Enter・Space・Y)を受け付けない(前の Enter の持ち越しで「はい」にならないように) */
export const ASK_GUARD_MS = 250;

type Setter<T> = Dispatch<SetStateAction<T>>;

export interface GameKeyCtx {
  s: GameState;
  pend: Pending | null;
  /** 画面を見ている側(対 CPU なら自分。観戦・2人用は手番の人間) */
  viewer: PlayerId;
  /** 自分の手番で、ターン中の行動を選べる */
  interactive: boolean;
  /** 入力パネル(選ぶ・答える)が出ている */
  showHuman: boolean;
  cpuOnly: boolean;
  humanTurn: boolean;
  allowUndo: boolean;
  /** 選択中のカードのキー(`hand:12` など) */
  selected: string | null;
  selActs: Drop[];
  stepActs: { skipMana?: Action; endMain?: Action; endTurn?: Action };
  /** ← → ↑ ↓ で選べるカードの並び(列ごと) */
  cycleRows: string[][];
  menuOpen: boolean;
  pickCursor: number | null;
  confirmQuit: boolean;
  g: ReturnType<typeof useGame>;
  askedAt: MutableRefObject<number>;
  endAfterSkip: MutableRefObject<boolean>;
  act: (a: Action) => void;
  /** ターン終了の確認を出して止めたなら true */
  holdEnd: () => boolean;
  rec: () => string;
  toggleConfirm: () => void;
  onExit: () => void;
  onRematch: () => void;
  setSelected: Setter<string | null>;
  setMenuOpen: Setter<boolean>;
  setHelpOpen: Setter<boolean>;
  setSideOpen: Setter<boolean>;
  setRecText: Setter<string | null>;
  setPeek: Setter<boolean>;
  setAskPay: Setter<boolean>;
  setShowOpp: Setter<boolean>;
  setListReq: Setter<{ p: PlayerId; zone: 'mana' | 'grave' | 'shield'; n: number } | null>;
  setPickCursor: Setter<number | null>;
  setConfirmQuit: Setter<boolean>;
}

const clickNth = (sel: string, n: number) => {
  const el = document.querySelectorAll<HTMLElement>(sel)[n];
  if (!el || (el as HTMLButtonElement).disabled) return false;
  el.click();
  return true;
};

/** keydown を処理する(処理したら preventDefault する) */
export function handleGameKey(e: KeyboardEvent, x: GameKeyCtx): void {
  const {
    s,
    pend,
    viewer,
    interactive,
    showHuman,
    cpuOnly,
    humanTurn,
    allowUndo,
    selected,
    selActs,
    stepActs,
    cycleRows,
    menuOpen,
    pickCursor,
    confirmQuit,
    g,
    askedAt,
    endAfterSkip,
    act,
    holdEnd,
    rec,
    toggleConfirm,
    onExit,
    onRematch,
    setSelected,
    setMenuOpen,
    setHelpOpen,
    setSideOpen,
    setRecText,
    setPeek,
    setAskPay,
    setShowOpp,
    setListReq,
    setPickCursor,
    setConfirmQuit,
  } = x;
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
  if (k === KEY.undo && allowUndo && g.canUndo && humanTurn) {
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
}
