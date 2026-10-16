import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DECK_PRESETS } from '../../src/cards';
import { allDecks, deleteDeck, findDeck, loadSavedDecks, saveDeck } from '../../src/ui/decks';
import { loadJson, saveJson } from '../../src/ui/util';

// Node 環境には localStorage がないので、最小のスタブを差し込む
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
}
const g = globalThis as any;
let saved: unknown;

beforeEach(() => {
  saved = g.localStorage;
  g.localStorage = new MemoryStorage();
});
afterEach(() => {
  if (saved === undefined) delete g.localStorage;
  else g.localStorage = saved;
});

describe('loadJson / saveJson', () => {
  it('保存した値を読み戻せる。無ければ既定値', () => {
    expect(loadJson('k', { a: 1 })).toEqual({ a: 1 });
    saveJson('k', { a: 2, b: [1, 2] });
    expect(loadJson('k', null)).toEqual({ a: 2, b: [1, 2] });
  });
  it('壊れたJSON・localStorage が使えない環境でも例外にならない', () => {
    g.localStorage.setItem('bad', '{oops');
    expect(loadJson('bad', 7)).toBe(7);
    delete g.localStorage;
    expect(loadJson('k', 'dflt')).toBe('dflt');
    expect(() => saveJson('k', 1)).not.toThrow();
  });
  it('setItem が失敗しても(容量超過など)例外にならない', () => {
    g.localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => saveJson('k', 1)).not.toThrow();
  });
});

describe('デッキの保存', () => {
  it('プリセットが先頭に並び、preset=true', () => {
    const d = allDecks();
    expect(d.slice(0, DECK_PRESETS.length).every((x) => x.preset)).toBe(true);
    expect(d.find((x) => x.id === 'maruru')!.cards).toHaveLength(40);
  });
  it('保存 → 一覧に出る → 同じ id なら上書き → 削除', () => {
    expect(loadSavedDecks()).toEqual([]);
    saveDeck({ id: 'u1', name: '自作', cards: ['dummy', 'dummy'] });
    expect(loadSavedDecks()).toEqual([{ id: 'u1', name: '自作', cards: ['dummy', 'dummy'], preset: false }]);
    saveDeck({ id: 'u1', name: '改名', cards: ['dummy'] });
    expect(loadSavedDecks()).toHaveLength(1);
    expect(findDeck('u1').name).toBe('改名');
    saveDeck({ id: 'u2', name: '別', cards: [] });
    expect(allDecks().length).toBe(DECK_PRESETS.length + 2);
    deleteDeck('u1');
    expect(loadSavedDecks().map((x) => x.id)).toEqual(['u2']);
  });
  it('壊れた保存(配列でない・形式の違う項目)があっても、画面が開けなくならない(読み飛ばす)', () => {
    g.localStorage.setItem('dmsim.decks', '{"oops":1}');
    expect(loadSavedDecks()).toEqual([]);
    expect(allDecks().length).toBe(DECK_PRESETS.length);
    g.localStorage.setItem(
      'dmsim.decks',
      JSON.stringify([null, 3, { id: 'a', name: 'ok', cards: ['dummy'] }, { id: 'b', name: 'x', cards: 'notarray' }, { id: 1, name: 'x', cards: [] }, { id: 'c', name: 'y', cards: [1] }]),
    );
    expect(loadSavedDecks()).toEqual([{ id: 'a', name: 'ok', cards: ['dummy'], preset: false }]);
  });
  it('findDeck: 未知の id は例外', () => {
    expect(() => findDeck('nope')).toThrow();
  });
  it('プリセットを削除しようとしても、プリセットは残る', () => {
    deleteDeck('maruru');
    expect(findDeck('maruru').preset).toBe(true);
  });
});
