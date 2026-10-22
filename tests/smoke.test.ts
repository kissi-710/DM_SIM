import { describe, expect, it } from 'vitest';
import { CARD_DB, CARD_LIST, DECK_PRESETS, deckCards } from '../src/cards';
import { checkDeck, createGame, legalActions, loadRegistryFor, step } from './helpers';
import { loadRegistry, validateCardDb } from '../src/engine/registry';
import type { CardDB } from '../src/engine/types';

describe('スモーク', () => {
  it('全デッキが40枚で、全カードが読み込める', () => {
    for (const id of ['maruru', 'zardy', 'lost-maruru', 'interstellar-maruru', 'zardy-rev5c']) {
      const d = deckCards(id);
      expect(d.length).toBe(40);
      expect(checkDeck(CARD_DB, d, true).ok).toBe(true);
    }
    // 41種+ダミー+25の王道の新規カード(CARD_LIST)。レジストリはこれに、無能力カード(カード単体の強さの差し替え先)と不明カード('?')が加わる
    expect(CARD_LIST.length).toBeGreaterThanOrEqual(42);
    expect(Object.keys(loadRegistryFor().defs).length).toBe(Object.keys(CARD_DB).length + 1);
  });

  it('デッキに含まれる異なるカードは41種', () => {
    const ids = new Set<string>();
    for (const p of DECK_PRESETS.filter((d) => !d.id.startsWith('sd1-'))) for (const [id] of p.list) ids.add(id);
    expect(ids.size).toBe(41);
    for (const id of ids) expect(CARD_DB[id]).toBeDefined();
  });

  it('ゲームを開始して数手進められる', () => {
    const { state } = createGame(CARD_DB, { decks: [deckCards('maruru'), deckCards('zardy')], seed: 1, first: 0 });
    expect(state.pending?.why).toBe('turnAction');
    const la = legalActions(state, loadRegistryFor());
    expect(la.length).toBeGreaterThan(0);
    const r = step(state, la[0], CARD_DB);
    expect(r.state.turn).toBe(1);
  });
});

describe('カードデータの検証(spec 4.3)', () => {
  const base = (): CardDB => JSON.parse(JSON.stringify(CARD_DB));
  it('正しいデータはエラーなし', () => {
    expect(validateCardDb(CARD_DB)).toEqual([]);
    expect(CARD_LIST.length).toBeGreaterThanOrEqual(42);
  });
  it('未知の原始操作・未知のキーワード・必須項目の不足はエラーになる', () => {
    const a = base();
    (a['dmrp01-093'].faces[0].abilities[1] as any).steps[0].act = { fooBar: 1 };
    expect(validateCardDb(a).join('\n')).toContain("未対応の原始操作 'fooBar'");
    expect(() => loadRegistry(a)).toThrow();
    const b = base();
    (b['dmrp01-093'].faces[0].abilities[0] as any).name = 'unknownKeyword';
    expect(validateCardDb(b).join('\n')).toContain('未知のキーワード');
    const c = base();
    delete (c['dmrp01-093'].faces[0] as any).cost;
    expect(validateCardDb(c).join('\n')).toContain('cost');
    const d = base();
    (d['dm23bd3-001'].faces[0] as any).evolveFrom = undefined;
    expect(validateCardDb(d).join('\n')).toContain('evolveFrom');
  });
  it('存在しないカードIDのデッキは作れない', () => {
    expect(() => createGame(CARD_DB, { decks: [Array(40).fill('nope'), deckCards('zardy')], seed: 1 })).toThrow();
  });
});
