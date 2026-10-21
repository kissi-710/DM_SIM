// 25の王道(DM26-SD1)の全デッキ: docs/data/dm26sd1-decks.json(取得したデッキリスト)と、実装したデッキ定義が一致すること、
// 全カードの能力が読み込めること、ランダム・ルールベースで最後まで対局できることを確かめる。
import { describe, expect, it } from 'vitest';
import { CARD_DB, DECK_PRESETS, deckCards } from '../../src/cards';
import { makeAgent } from '../../src/ai';
import { playGameSync } from '../../src/sim/playGame';
import { checkInvariants } from '../../src/engine/invariants';
import { checkDeck } from '../../src/engine/engine';
import { loadRegistry } from '../../src/engine/registry';
import listJson from '../../docs/data/dm26sd1-decks.json';

const reg = loadRegistry(CARD_DB);
const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').replace(/[「」《》"“”‘’']/g, '').replace(/[〜~]/g, '~').replace(/[!！]/g, '!').replace(/[?？]/g, '?').replace(/♪/g, '');

type DeckList = { name: string; short: string; implemented?: boolean; list: [string, number][] };
const official = listJson.decks as unknown as Record<string, DeckList>;

/** デッキID(sd1-c など)→ 文字(C など) */
const letterOf = (id: string) => id.replace('sd1-', '').toUpperCase();
const sd1Presets = DECK_PRESETS.filter((p) => p.id.startsWith('sd1-'));

/** カード定義の名前(ツインパクトは全面の名前)の正規化した一覧 */
function namesOf(defId: string): string[] {
  const d = reg.defs[defId];
  return [d.name, ...d.faces.map((f) => f.name)].map(norm);
}

describe('25の王道: デッキリストと実装の一致', () => {
  it('実装済みのデッキは、取得したデッキリストと同じ構成(カード名と枚数)', () => {
    expect(sd1Presets.length).toBeGreaterThan(0);
    for (const p of sd1Presets) {
      const want = official[letterOf(p.id)];
      expect(want, p.id).toBeDefined();
      const total = p.list.reduce((t, [, n]) => t + n, 0);
      expect(total, p.id).toBe(40);
      // 取得したリストの各カードが、デッキ定義のどれかのカードに対応し、枚数が一致する
      const have = new Map<string, number>();
      for (const [id, n] of p.list) {
        const key = norm(reg.defs[id].name);
        have.set(key, (have.get(key) ?? 0) + n);
      }
      for (const [name, n] of want.list) {
        const key = norm(name);
        const hit = [...have.entries()].find(([k]) => k === key || namesOf(p.list.find(([id]) => norm(reg.defs[id].name) === k)![0]).includes(key));
        expect(hit, `${p.id}: ${name} が実装されていません`).toBeDefined();
        expect(hit![1], `${p.id}: ${name} の枚数`).toBe(n);
      }
      expect(p.list.length, `${p.id}: カードの種類数`).toBe(want.list.length);
    }
  });

  it('各デッキは40枚・同名4枚まで(ハチ公など例外を除く)で、全カードが読み込める', () => {
    for (const p of sd1Presets) {
      const deck = deckCards(p.id);
      expect(deck.length).toBe(40);
      const r = checkDeck(CARD_DB, deck, true);
      // 特攻の忠剣ハチ公は何枚でも入れられる
      const errs = r.errors.filter((e) => !e.includes('特攻の忠剣ハチ公'));
      expect(errs, p.id).toEqual([]);
    }
  });
});

describe('25の王道: 対局', () => {
  const opp = deckCards('maruru');
  for (const p of sd1Presets) {
    it(`${p.short}: ランダム同士・ルールベース同士で、最後まで(またはターン上限まで)進み、不変条件が保たれる`, () => {
      for (const kind of ['random', 'rule'] as const) {
        for (let seed = 1; seed <= 2; seed++) {
          const r = playGameSync(reg, [makeAgent({ kind }), makeAgent({ kind })], {
            decks: seed === 1 ? [deckCards(p.id), opp] : [opp, deckCards(p.id)],
            seed: 100 * seed + (kind === 'rule' ? 7 : 3),
            strict: false,
            onStep: (s) => {
              const errs = checkInvariants(s);
              if (errs.length) throw new Error(`不変条件違反 ${p.id} ${kind} seed=${seed}: ${errs.join(' / ')}`);
            },
          });
          expect(r.state.winner !== null || r.reason !== undefined).toBe(true);
        }
      }
    });
  }
});
