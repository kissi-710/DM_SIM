// 対戦の自動保存(localStorage)。行動列を保存して、メニューから再開する(UX-06)。画面(React)に依存しない。
import type { Action } from '../engine/types';
import { RECORD_VERSION } from './record';
import type { GameSetup } from './useGame';
import { loadJson, saveJson } from './util';

export const AUTOSAVE_KEY = 'dmsim.autosave';

/** このタブの識別子(ページを開くたびに変わる)。別のタブが書いた保存かどうかを見分ける */
export const TAB_ID: string = Math.random().toString(36).slice(2, 10);

/** 別のタブが、この時間(ms)以内に書いた保存は「いま進行中」とみなして、メニューで知らせる */
export const RECENT_OTHER_TAB_MS = 2 * 60 * 1000;

export interface Autosave {
  /** 保存した時のエンジンの版(RECORD_VERSION)。合わない保存は、再生しても同じ局面にならない */
  version: number;
  /** 書き込んだタブ(TAB_ID)。古い保存・他の版には無い */
  tab?: string;
  setup: GameSetup;
  actions: Action[];
  at: number;
}

/** 自動保存の結果。ok=保存した / failed=保存できなかった(容量・保存領域が使えない) / other-tab=別のタブの保存を上書きした */
export type SaveStatus = 'ok' | 'failed' | 'other-tab';

export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    // 保存できない環境では何もしない
  }
}

/** 進行中の対戦(保存されていない・版が合わない・形が壊れている時は null。合わないものは消す) */
export function loadAutosave(): Autosave | null {
  const a = loadJson<Autosave | null>(AUTOSAVE_KEY, null);
  if (!a) return null;
  if (a.version !== RECORD_VERSION) {
    clearAutosave();
    return null;
  }
  return Array.isArray(a.actions) && a.actions.length > 0 && a.setup?.decks ? a : null;
}

/** 別のタブが、いま進行中の対戦を保存している(メニューで、上書きになることを知らせる)ように見えるか */
export function isRecentOtherTab(a: Autosave, now = Date.now()): boolean {
  return !!a.tab && a.tab !== TAB_ID && now - a.at < RECENT_OTHER_TAB_MS;
}

/**
 * 自動保存を書き込む。lastWriteAt は、このタブが前回書いた時刻(まだ書いていなければ null)。
 * 前回の後に別のタブが書いていたら、そのタブの対戦を上書きすることになるので other-tab を返す(書き込みはする)。
 */
export function writeAutosave(setup: GameSetup, actions: Action[], lastWriteAt: number | null, now = Date.now()): { status: SaveStatus; at: number } {
  const cur = loadJson<Partial<Autosave> | null>(AUTOSAVE_KEY, null);
  const overwritesOther = !!cur && !!cur.tab && cur.tab !== TAB_ID && typeof cur.at === 'number' && lastWriteAt !== null && cur.at > lastWriteAt;
  const value: Autosave = { version: RECORD_VERSION, tab: TAB_ID, setup: { ...setup, resume: undefined }, actions, at: now };
  const ok = saveJson(AUTOSAVE_KEY, value);
  return { status: !ok ? 'failed' : overwritesOther ? 'other-tab' : 'ok', at: now };
}
