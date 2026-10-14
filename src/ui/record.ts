// 試合の記録(棋譜)の形・版・検証・ブラウザへの保存(design 10)。画面(React)に依存しない純関数。
import type { AgentSpec } from '../ai';
import { CARD_DB } from '../cards';
import type { Action, GameConfig, PlayerId } from '../engine/types';
import { loadJson, saveJson } from './util';
import { errorMessage } from '../engine/types';

/**
 * 棋譜・自動保存の版。エンジンの変更で「同じシード・同じ行動列」の意味が変わった時に上げる。
 * 1: カードの uid を、シャッフル前のデッキリストの順に振っていた
 * 2: シャッフルしてから uid を振る(隠れたカードを uid から割り出せないようにした)
 */
export const RECORD_VERSION = 2;

export interface RecordSeat {
  kind: 'human' | 'cpu';
  agent: AgentSpec;
}

/** 試合の記録(再生・保存用。design 10) */
export interface GameRecord {
  version: typeof RECORD_VERSION;
  seed: number;
  decks: [string[], string[]];
  deckNames: [string, string];
  first: PlayerId;
  cfg: Partial<GameConfig>;
  actions: Action[];
  seats?: [RecordSeat, RecordSeat];
}

export type RecordCheck = { ok: true; rec: GameRecord } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 読み込んだ値が、再生できる棋譜か(形・版・カードIDを検査する) */
export function validateRecord(x: unknown): RecordCheck {
  if (!isObj(x)) return { ok: false, error: '棋譜の形式ではありません(オブジェクトではありません)' };
  if (x.version !== RECORD_VERSION) {
    const v = x.version === undefined ? '不明' : String(x.version);
    return {
      ok: false,
      error: `棋譜の版が合いません(棋譜: ${v} / 現在: ${RECORD_VERSION})。エンジンの更新でカードの割り当てが変わったため、旧い棋譜は再生できません`,
    };
  }
  if (typeof x.seed !== 'number' || !Number.isFinite(x.seed)) return { ok: false, error: '棋譜に、数値のシード(seed)がありません' };
  const decks = x.decks;
  if (!Array.isArray(decks) || decks.length !== 2) return { ok: false, error: '棋譜に、2つのデッキ(decks)がありません' };
  for (let p = 0; p < 2; p++) {
    const d = decks[p];
    if (!Array.isArray(d) || d.length === 0 || !d.every((c) => typeof c === 'string')) {
      return { ok: false, error: `棋譜のデッキ ${p + 1} が、カードIDの配列ではありません` };
    }
    const bad = (d as string[]).find((c) => !CARD_DB[c]);
    if (bad !== undefined) return { ok: false, error: `棋譜のデッキ ${p + 1} に、未知のカードIDがあります: ${bad}` };
  }
  if (x.first !== 0 && x.first !== 1) return { ok: false, error: '棋譜の先攻(first)が 0 か 1 ではありません' };
  if (x.cfg !== undefined && !isObj(x.cfg)) return { ok: false, error: '棋譜の設定(cfg)の形式が正しくありません' };
  if (!Array.isArray(x.actions)) return { ok: false, error: '棋譜に、行動列(actions)がありません' };
  const i = x.actions.findIndex((a) => !isObj(a) || typeof a.type !== 'string');
  if (i >= 0) return { ok: false, error: `棋譜の ${i + 1} 手目が、行動の形式ではありません` };
  const names = x.deckNames;
  const deckNames: [string, string] =
    Array.isArray(names) && names.length === 2 && names.every((n) => typeof n === 'string') ? [names[0], names[1]] : ['デッキ1', 'デッキ2'];
  return {
    ok: true,
    rec: {
      version: RECORD_VERSION,
      seed: x.seed,
      decks: [decks[0] as string[], decks[1] as string[]],
      deckNames,
      first: x.first,
      cfg: (x.cfg ?? {}) as Partial<GameConfig>,
      actions: x.actions as Action[],
      seats: x.seats as GameRecord['seats'],
    },
  };
}

/** JSON 文字列から、棋譜を読む(JSON として不正でも、エラーとして返す) */
export function parseRecord(text: string): RecordCheck {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: 'JSON を読み込めません: ' + errorMessage(e) };
  }
  return validateRecord(v);
}

// ───────────────────────── ブラウザへの保存 ─────────────────────────

const RECORDS_KEY = 'dmsim.records';
export const MAX_SAVED_RECORDS = 20;

export interface SavedRecord {
  at: number;
  rec: GameRecord;
}

/** 保存した棋譜(読めない・版が合わないものは除く。新しい順ではなく保存順) */
export function loadSavedRecords(): SavedRecord[] {
  const raw = loadJson<unknown>(RECORDS_KEY, []);
  if (!Array.isArray(raw)) return [];
  const out: SavedRecord[] = [];
  for (const e of raw) {
    if (!isObj(e) || typeof e.at !== 'number') continue;
    const c = validateRecord(e.rec);
    if (c.ok) out.push({ at: e.at, rec: c.rec });
  }
  return out;
}

/** 棋譜を保存する(最新の MAX_SAVED_RECORDS 件まで。保存できない環境では何もしない) */
export function saveRecord(rec: GameRecord, at = Date.now()): void {
  const cur = loadSavedRecords();
  cur.push({ at, rec });
  saveJson(RECORDS_KEY, cur.slice(-MAX_SAVED_RECORDS));
}
