// 自動保存(src/ui/autosave.ts): 別のタブの上書きと、保存の失敗を見分ける
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deckCards } from '../../src/cards';
import { AUTOSAVE_KEY, RECENT_OTHER_TAB_MS, TAB_ID, isRecentOtherTab, loadAutosave, writeAutosave, type Autosave } from '../../src/ui/autosave';
import { RECORD_VERSION } from '../../src/ui/record';
import type { GameSetup } from '../../src/ui/useGame';

const setup = (): GameSetup => ({
  decks: [deckCards('maruru'), deckCards('zardy')],
  deckNames: ['マルル', 'ザーディ'],
  seats: [
    { kind: 'human', agent: { kind: 'rule' } },
    { kind: 'cpu', agent: { kind: 'rule' } },
  ],
  first: 0,
  seed: 1,
  autoOrder: false,
  allowUndo: true,
  cpuDelayMs: 0,
  strict: true,
  resume: [{ type: 'END_TURN' }],
});

const store = new Map<string, string>();
let failWrites = false;
beforeEach(() => {
  store.clear();
  failWrites = false;
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (failWrites) throw new Error('QuotaExceededError');
      store.set(k, v);
    },
    removeItem: (k: string) => void store.delete(k),
  };
});
afterEach(() => {
  delete (globalThis as any).localStorage;
});

const other = (at: number): Autosave => ({ version: RECORD_VERSION, tab: 'other-tab-id', setup: setup(), actions: [{ type: 'END_TURN' }], at });

describe('writeAutosave', () => {
  it('書き込んで ok を返し、版・タブ・時刻を付ける(再開用の resume は落とす)', () => {
    const r = writeAutosave(setup(), [{ type: 'SKIP_MANA' }], null, 1000);
    expect(r).toEqual({ status: 'ok', at: 1000 });
    const saved = JSON.parse(store.get(AUTOSAVE_KEY)!);
    expect(saved.version).toBe(RECORD_VERSION);
    expect(saved.tab).toBe(TAB_ID);
    expect(saved.at).toBe(1000);
    expect(saved.setup.resume).toBeUndefined();
    expect(saved.actions).toHaveLength(1);
  });
  it('自分のタブが続けて書くなら、いつも ok', () => {
    let at: number | null = null;
    for (let i = 0; i < 3; i++) {
      const r = writeAutosave(setup(), [], at, 1000 + i);
      expect(r.status).toBe('ok');
      at = r.at;
    }
  });
  it('保存できなければ failed を返す(例外を投げない)', () => {
    failWrites = true;
    expect(writeAutosave(setup(), [], null, 1)).toEqual({ status: 'failed', at: 1 });
  });
  it('前回の後に別のタブが書いていたら other-tab を返し、書き込みはする', () => {
    store.set(AUTOSAVE_KEY, JSON.stringify(other(5000)));
    const r = writeAutosave(setup(), [], 4000, 6000);
    expect(r.status).toBe('other-tab');
    expect(JSON.parse(store.get(AUTOSAVE_KEY)!).tab).toBe(TAB_ID);
  });
  it('別のタブの保存が、自分の前回より古ければ(自分が後に書いた)、ok', () => {
    store.set(AUTOSAVE_KEY, JSON.stringify(other(3000)));
    expect(writeAutosave(setup(), [], 4000, 6000).status).toBe('ok');
  });
  it('まだ書いていない(lastWriteAt が null)なら、別のタブの保存があっても ok(最初の保存)', () => {
    store.set(AUTOSAVE_KEY, JSON.stringify(other(5000)));
    expect(writeAutosave(setup(), [], null, 6000).status).toBe('ok');
  });
});

describe('isRecentOtherTab', () => {
  const a = (tab: string | undefined, at: number): Autosave => ({ ...other(at), tab });
  it('別のタブが直近に書いたものだけ true', () => {
    expect(isRecentOtherTab(a('x', 1000), 1000 + RECENT_OTHER_TAB_MS - 1)).toBe(true);
    expect(isRecentOtherTab(a('x', 1000), 1000 + RECENT_OTHER_TAB_MS)).toBe(false);
  });
  it('自分のタブ・タブの記録がない古い保存は false', () => {
    expect(isRecentOtherTab(a(TAB_ID, 1000), 1001)).toBe(false);
    expect(isRecentOtherTab(a(undefined, 1000), 1001)).toBe(false);
  });
});

describe('loadAutosave', () => {
  it('版が合えば読める。行動列が空・形が壊れていれば null', () => {
    store.set(AUTOSAVE_KEY, JSON.stringify(other(1)));
    expect(loadAutosave()?.tab).toBe('other-tab-id');
    store.set(AUTOSAVE_KEY, JSON.stringify({ ...other(1), actions: [] }));
    expect(loadAutosave()).toBeNull();
    store.set(AUTOSAVE_KEY, JSON.stringify({ ...other(1), setup: {} }));
    expect(loadAutosave()).toBeNull();
  });
  it('版が合わない保存は、読まずに消す', () => {
    store.set(AUTOSAVE_KEY, JSON.stringify({ ...other(1), version: RECORD_VERSION - 1 }));
    expect(loadAutosave()).toBeNull();
    expect(store.has(AUTOSAVE_KEY)).toBe(false);
  });
});
