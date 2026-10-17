// 棋譜の形・版・検証・ブラウザへの保存(src/ui/record.ts)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deckCards } from '../../src/cards';
import { loadSavedRecords, MAX_SAVED_RECORDS, parseRecord, RECORD_VERSION, saveRecord, validateRecord, type GameRecord } from '../../src/ui/record';

const base = (): GameRecord => ({
  version: RECORD_VERSION,
  seed: 7,
  decks: [deckCards('maruru'), deckCards('zardy')],
  deckNames: ['マルル', '5cザーディ'],
  first: 0,
  cfg: {},
  actions: [{ type: 'SKIP_MANA' }, { type: 'END_TURN' }],
});

describe('validateRecord', () => {
  it('正しい棋譜は、そのまま受け付ける', () => {
    const c = validateRecord(base());
    expect(c.ok).toBe(true);
    if (c.ok) {
      expect(c.rec.seed).toBe(7);
      expect(c.rec.actions).toHaveLength(2);
    }
  });
  it('JSON の文字列からも読める', () => {
    expect(parseRecord(JSON.stringify(base())).ok).toBe(true);
  });
  it('JSON として壊れていれば、エラーを返す(例外を投げない)', () => {
    const c = parseRecord('{ not json');
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error).toContain('JSON');
  });
  it('旧い版の棋譜は、版が合わないことを説明して断る', () => {
    const c = validateRecord({ ...base(), version: 1 });
    expect(c.ok).toBe(false);
    if (!c.ok) {
      expect(c.error).toContain('版');
      expect(c.error).toContain('1');
    }
  });
  it('版がない棋譜も断る', () => {
    const { version: _v, ...rest } = base();
    void _v;
    expect(validateRecord(rest).ok).toBe(false);
  });
  it('オブジェクトでないものは断る', () => {
    for (const v of [null, 3, 'x', [], undefined]) expect(validateRecord(v).ok).toBe(false);
  });
  it("プロトタイプのキー('constructor' など)も、未知のカードIDとして断る", () => {
    const r = base();
    r.decks[0] = [...r.decks[0].slice(1), 'constructor'];
    const c = validateRecord(r);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error).toContain('constructor');
  });
  it('未知のカードIDがあれば、どのデッキかを示して断る', () => {
    const r = base();
    r.decks[1] = [...r.decks[1].slice(1), 'nope-000'];
    const c = validateRecord(r);
    expect(c.ok).toBe(false);
    if (!c.ok) {
      expect(c.error).toContain('デッキ 2');
      expect(c.error).toContain('nope-000');
    }
  });
  it('シード・先攻・行動列の形を検査する', () => {
    expect(validateRecord({ ...base(), seed: 'a' }).ok).toBe(false);
    expect(validateRecord({ ...base(), seed: NaN }).ok).toBe(false);
    expect(validateRecord({ ...base(), first: 2 }).ok).toBe(false);
    expect(validateRecord({ ...base(), actions: 'x' }).ok).toBe(false);
    const c = validateRecord({ ...base(), actions: [{ type: 'END_TURN' }, { uid: 1 }] });
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error).toContain('2 手目');
  });
  it('デッキ名がなければ、既定の名前にする', () => {
    const { deckNames: _d, ...rest } = base();
    void _d;
    const c = validateRecord(rest);
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.rec.deckNames).toEqual(['デッキ1', 'デッキ2']);
  });
});

describe('ブラウザへの保存', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as any).localStorage;
  });

  it('保存した棋譜を読み出せる', () => {
    saveRecord(base(), 1000);
    const l = loadSavedRecords();
    expect(l).toHaveLength(1);
    expect(l[0].at).toBe(1000);
    expect(l[0].rec.seed).toBe(7);
  });
  it('最新の 20 件までを残す', () => {
    for (let i = 0; i < MAX_SAVED_RECORDS + 5; i++) saveRecord({ ...base(), seed: i }, i);
    const l = loadSavedRecords();
    expect(l).toHaveLength(MAX_SAVED_RECORDS);
    expect(l[0].rec.seed).toBe(5);
    expect(l[l.length - 1].rec.seed).toBe(MAX_SAVED_RECORDS + 4);
  });
  it('版が合わない・壊れた保存は読み飛ばす', () => {
    store.set('dmsim.records', JSON.stringify([{ at: 1, rec: { ...base(), version: 1 } }, { at: 2, rec: base() }, { at: 'x', rec: base() }, 7, null]));
    const l = loadSavedRecords();
    expect(l).toHaveLength(1);
    expect(l[0].at).toBe(2);
  });
  it('保存の中身が配列でなければ、空として扱う', () => {
    store.set('dmsim.records', '{"a":1}');
    expect(loadSavedRecords()).toEqual([]);
  });
  it('localStorage が使えない環境でも、例外を投げない', () => {
    delete (globalThis as any).localStorage;
    expect(loadSavedRecords()).toEqual([]);
    expect(() => saveRecord(base())).not.toThrow();
  });
});

describe('自動保存の版', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as any).localStorage;
  });
  const save = (version: number | undefined) =>
    store.set(
      'dmsim.autosave',
      JSON.stringify({ version, setup: { decks: [deckCards('maruru'), deckCards('zardy')] }, actions: [{ type: 'SKIP_MANA' }], at: 1 }),
    );

  it('版が合う保存は、そのまま読める', async () => {
    const { loadAutosave } = await import('../../src/ui/useGame');
    save(RECORD_VERSION);
    expect(loadAutosave()?.actions).toHaveLength(1);
  });
  it('版が合わない・版がない保存は、読まずに消す(違う局面から再開しない)', async () => {
    const { loadAutosave } = await import('../../src/ui/useGame');
    for (const v of [1, undefined, RECORD_VERSION + 1]) {
      save(v);
      expect(loadAutosave()).toBeNull();
      expect(store.has('dmsim.autosave')).toBe(false);
    }
  });
});
