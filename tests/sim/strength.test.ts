import { describe, expect, it } from 'vitest';
import { CARD_DB, CARD_LIST, deckCards } from '../../src/cards';
import { blankId } from '../../src/engine/blank';
import { measureCardStrength, strengthDecks, strengthVariants } from '../../src/sim/strength';

describe('strengthVariants(変種デッキ)', () => {
  const deck = deckCards('maruru');
  const { ids, one, all } = strengthVariants(deck, CARD_DB);

  it('デッキの種類ごとに、旧方式(1枚→dummy)と新方式(全枚数→無能力)の変種ができる', () => {
    expect(ids).toEqual([...new Set(deck)]);
    expect(one).toHaveLength(ids.length);
    expect(all).toHaveLength(ids.length);
    expect(strengthDecks(deck, CARD_DB)).toHaveLength(1 + 2 * ids.length);
    expect(strengthDecks(deck, CARD_DB)[0]).toEqual(deck);
  });
  it('旧方式: 最初の1枚だけが dummy になる。デッキは40枚のまま', () => {
    ids.forEach((id, k) => {
      expect(one[k]).toHaveLength(deck.length);
      expect(one[k].filter((x) => x === 'dummy')).toHaveLength(1);
      expect(one[k].indexOf('dummy')).toBe(deck.indexOf(id));
    });
  });
  it('新方式: そのカードの全コピーが、同コスト・文明の無能力カードになる。他のカードは変わらない', () => {
    ids.forEach((id, k) => {
      const copies = deck.filter((x) => x === id).length;
      const to = blankId(CARD_DB[id]);
      expect(CARD_DB[to]).toBeDefined(); // DB に登録されている
      expect(all[k]).toHaveLength(deck.length);
      expect(all[k].filter((x) => x === to)).toHaveLength(copies);
      expect(all[k].filter((x) => x === id)).toHaveLength(0);
      all[k].forEach((x, i) => {
        if (deck[i] !== id) expect(x).toBe(deck[i]);
      });
    });
  });
  it('登録のない DB では、無能力カードの代わりに dummy を使う', () => {
    const { all: a } = strengthVariants(['dmrp01-093', 'dmrp01-093', 'dm23bd1-014'], { 'dmrp01-093': CARD_DB['dmrp01-093'], 'dm23bd1-014': CARD_DB['dm23bd1-014'] });
    expect(a[0]).toEqual(['dummy', 'dummy', 'dm23bd1-014']);
  });
});

describe('measureCardStrength(カード単体の強さ)', () => {
  const deck = deckCards('maruru');
  const run = (o: Partial<Parameters<typeof measureCardStrength>[1]> = {}) =>
    measureCardStrength(CARD_DB, { deck, opponent: deckCards('zardy'), agent: { kind: 'random' }, games: 6, seed: 1, ...o });

  it('デッキに含まれる異なるカードごとに1行返り、枚数が一致する', () => {
    const r = run();
    const kinds = new Set(deck);
    expect(r).toHaveLength(kinds.size);
    for (const row of r) {
      expect(kinds.has(row.defId)).toBe(true);
      expect(row.copies).toBe(deck.filter((x) => x === row.defId).length);
      expect(row.name).toBe(CARD_DB[row.defId].name);
    }
  });
  it('どちらの方式も 勝率差 = 基準 − 差し替えた時 で、区間は差を含む。基準は全行で共通', () => {
    const r = run();
    for (const row of r) {
      expect(row.winRateBase).toBe(r[0].winRateBase);
      for (const e of [row.all, row.one]) {
        expect(e.delta).toBeCloseTo(row.winRateBase - e.winRateWithout, 12);
        expect(e.ci95[0]).toBeLessThanOrEqual(e.delta);
        expect(e.ci95[1]).toBeGreaterThanOrEqual(e.delta);
      }
    }
  });
  it('1枚あたり = 全枚数の差 ÷ 枚数(区間も同じ比)', () => {
    for (const row of run()) {
      expect(row.all.perCopy).toBeCloseTo(row.all.delta / row.copies, 12);
      expect(row.all.perCopyCi95[0]).toBeCloseTo(row.all.ci95[0] / row.copies, 12);
      expect(row.all.perCopyCi95[1]).toBeCloseTo(row.all.ci95[1] / row.copies, 12);
    }
  });
  it('1枚積みのカードは、1枚あたり = 全枚数の差(差し替える枚数が1枚で同じ)', () => {
    const singles = run().filter((r) => r.copies === 1);
    expect(singles.length).toBeGreaterThan(0);
    for (const row of singles) expect(row.all.perCopy).toBe(row.all.delta);
  });
  it('並びは、新方式(全枚数×無能力)の勝率差の降順', () => {
    const r = run();
    for (let i = 1; i < r.length; i++) expect(r[i - 1].all.delta).toBeGreaterThanOrEqual(r[i].all.delta);
  });
  it('同時比較の区間は、1つだけの区間より広く、差を含む(種類が複数ある時)', () => {
    const r = run();
    expect(r.length).toBeGreaterThan(1);
    for (const row of r) {
      for (const e of [row.all, row.one]) {
        const w95 = e.ci95[1] - e.ci95[0];
        const wFam = e.ciFamily[1] - e.ciFamily[0];
        expect(e.ciFamily[0]).toBeLessThanOrEqual(e.delta);
        expect(e.ciFamily[1]).toBeGreaterThanOrEqual(e.delta);
        // 両端は同じ中心(差)を挟んで、広がるだけ
        expect(wFam).toBeGreaterThan(w95);
        expect((e.ciFamily[0] + e.ciFamily[1]) / 2).toBeCloseTo((e.ci95[0] + e.ci95[1]) / 2, 12);
      }
    }
  });
  it('進捗は変種の数(種類数 × 2)だけ通知される', () => {
    const calls: [number, number][] = [];
    run({ onProgress: (d, t) => calls.push([d, t]) });
    const total = new Set(deck).size * 2;
    expect(calls).toHaveLength(total);
    expect(calls[calls.length - 1]).toEqual([total, total]);
  });
  it('同じシードなら同じ結果', () => {
    expect(run()).toEqual(run());
  });
  it('元のデッキ配列は書き換えない', () => {
    const copy = deck.slice();
    run();
    expect(deck).toEqual(copy);
  });
  it('無能力カードは CARD_LIST に出ない(一覧・デッキ構築には載らない)', () => {
    expect(CARD_LIST.some((c) => c.id.startsWith('blank-'))).toBe(false);
  });
});
