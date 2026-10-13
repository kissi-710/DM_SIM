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

export function loadSavedDecks(): DeckEntry[] {
  return loadJson<{ id: string; name: string; cards: string[] }[]>(KEY, []).map((d) => ({ ...d, preset: false }));
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
