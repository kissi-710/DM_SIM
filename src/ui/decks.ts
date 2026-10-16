// デッキの一覧(プリセット + ブラウザに保存したもの)。
import { DECK_PRESETS, deckCards } from '../cards';
import { loadJson, saveJson } from './util';

export interface DeckEntry {
  id: string;
  name: string;
  cards: string[];
  preset: boolean;
}

const KEY = 'dmsim.decks';

/** ブラウザに保存したデッキ。壊れた保存(配列でない・形式の違う項目)は、読み飛ばす(画面が開けなくならないように) */
export function loadSavedDecks(): DeckEntry[] {
  const raw = loadJson<unknown>(KEY, []);
  if (!Array.isArray(raw)) return [];
  const out: DeckEntry[] = [];
  for (const d of raw) {
    if (!d || typeof d !== 'object') continue;
    const { id, name, cards } = d as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string' || !Array.isArray(cards) || !cards.every((c) => typeof c === 'string')) continue;
    out.push({ id, name, cards: cards as string[], preset: false });
  }
  return out;
}

export function saveDeck(d: { id: string; name: string; cards: string[] }): void {
  const cur = loadSavedDecks().filter((x) => x.id !== d.id);
  cur.push({ ...d, preset: false });
  saveJson(
    KEY,
    cur.map(({ id, name, cards }) => ({ id, name, cards })),
  );
}

export function deleteDeck(id: string): void {
  saveJson(
    KEY,
    loadSavedDecks()
      .filter((x) => x.id !== id)
      .map(({ id, name, cards }) => ({ id, name, cards })),
  );
}

export function allDecks(): DeckEntry[] {
  const presets: DeckEntry[] = DECK_PRESETS.map((p) => ({ id: p.id, name: p.name, cards: deckCards(p.id), preset: true }));
  return [...presets, ...loadSavedDecks()];
}

export function findDeck(id: string): DeckEntry {
  const d = allDecks().find((x) => x.id === id);
  if (!d) throw new Error('デッキが見つかりません: ' + id);
  return d;
}
