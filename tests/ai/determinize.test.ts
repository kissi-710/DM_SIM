import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../../src/cards';
import { determinize } from '../../src/ai/determinize';
import { createGame, legalActions } from '../../src/engine/engine';
import { checkInvariants } from '../../src/engine/invariants';
import { FAIR, kindsOf, toPlayerView, type InfoPolicy } from '../../src/engine/view';
import { mulberry } from '../../src/sim/playGame';
import { reg } from '../scenario';

const maruru = deckCards('maruru');
const zardy = deckCards('zardy');
const game = (seed = 4, first: 0 | 1 = 0) => createGame(CARD_DB, { decks: [maruru, zardy], seed, first }).state;
const sorted = (l: string[]) => [...l].sort().join(',');
const ownedBy = (s: ReturnType<typeof game>, p: number) => s.cards.filter((c) => c.owner === p).map((c) => c.defId);

describe('determinize(決定化)', () => {
  it('隠れたカードを埋め、双方のデッキ構成と一致する(後攻視点でも)', () => {
    for (const me of [0, 1] as const) {
      const state = game(8, 1);
      const view = toPlayerView(state, me, FAIR, reg);
      const d = determinize(view, me, { rand: mulberry(3), reg, policy: FAIR });
      expect(d.cards.every((c) => c.defId !== '?')).toBe(true);
      expect(sorted(ownedBy(d, 0))).toBe(sorted(maruru));
      expect(sorted(ownedBy(d, 1))).toBe(sorted(zardy));
      expect(checkInvariants(d)).toEqual([]);
    }
  });
  it('入力の view は書き換えない', () => {
    const view = toPlayerView(game(), 0, FAIR, reg);
    const before = JSON.stringify(view);
    determinize(view, 0, { rand: mulberry(1), reg, policy: FAIR });
    expect(JSON.stringify(view)).toBe(before);
  });
  it('見えていたカードは変わらない', () => {
    const state = game(6);
    const view = toPlayerView(state, 0, FAIR, reg);
    const d = determinize(view, 0, { rand: mulberry(5), reg, policy: FAIR });
    state.cards.forEach((_, u) => {
      if (view.cards[u].defId !== '?') expect(d.cards[u].defId).toBe(view.cards[u].defId);
    });
  });
  it('乱数が同じなら同じ割り当て、違えば(ほぼ確実に)別の割り当て', () => {
    const view = toPlayerView(game(), 0, FAIR, reg);
    const run = (seed: number) => determinize(view, 0, { rand: mulberry(seed), reg, policy: FAIR });
    expect(JSON.stringify(run(1))).toBe(JSON.stringify(run(1)));
    expect(JSON.stringify(run(1).cards)).not.toBe(JSON.stringify(run(2).cards));
  });
  it('状態の乱数が更新され、hints は消える。決定化した状態は実際に進められる', () => {
    const view = toPlayerView(game(), 0, FAIR, reg);
    const d = determinize(view, 0, { rand: mulberry(1), reg, policy: FAIR });
    expect(d.hints).toBeUndefined();
    expect(d.rng).not.toBe(view.rng);
    expect(legalActions(d, reg).length).toBeGreaterThan(0);
  });
  it('公開済みの墓地・バトルゾーンのカードは、母集団から引かれる', () => {
    const state = game(9);
    // 相手の手札2枚を墓地へ(公開された状態)
    for (let i = 0; i < 2; i++) {
      const u = state.players[1].hand.shift()!;
      state.cards[u].zone = 'grave';
      state.players[1].grave.push(u);
    }
    const view = toPlayerView(state, 0, FAIR, reg);
    const d = determinize(view, 0, { rand: mulberry(2), reg, policy: FAIR });
    expect(sorted(ownedBy(d, 1))).toBe(sorted(zardy));
  });

  describe('相手のデッキリストが未知', () => {
    const unknown: InfoPolicy = { preset: 'fair', knowOpponentDecklist: false };
    it('候補のデッキから割り当てる(相手の全カードがそのデッキの内訳になる)', () => {
      const state = game(5);
      const view = toPlayerView(state, 0, unknown, reg);
      expect(view.deckIds[1]).toEqual([]);
      const d = determinize(view, 0, { rand: mulberry(1), reg, policy: unknown, candidateDecks: [zardy] });
      expect(sorted(ownedBy(d, 1))).toBe(sorted(zardy));
      expect(d.cards.every((c) => c.defId !== '?')).toBe(true);
    });
    it('見えているカードと矛盾する候補は選ばれない', () => {
      const state = game(5);
      // 相手の墓地にザーディのカードが見えている → マルルのデッキ候補は不可
      const u = state.players[1].hand.shift()!;
      state.cards[u].zone = 'grave';
      state.players[1].grave.push(u);
      const view = toPlayerView(state, 0, unknown, reg);
      const seenId = view.cards[u].defId;
      const other = maruru.includes(seenId) ? zardy : maruru;
      const pool = [other, zardy];
      for (let seed = 1; seed <= 6; seed++) {
        const d = determinize(view, 0, { rand: mulberry(seed), reg, policy: unknown, candidateDecks: pool });
        // 見えているカードを含められるデッキだけが使われる
        const cand = pool.filter((dk) => dk.includes(seenId));
        const used = cand.some((dk) => {
          const left = [...dk];
          return ownedBy(d, 1).every((id) => {
            const i = left.indexOf(id);
            if (i < 0) return false;
            left.splice(i, 1);
            return true;
          });
        });
        expect(used).toBe(true);
      }
    });
    it('候補がなければ、自分のデッキを仮定してでも埋める(止まらない)', () => {
      const view = toPlayerView(game(5), 0, unknown, reg);
      const d = determinize(view, 0, { rand: mulberry(1), reg, policy: unknown });
      expect(d.cards.every((c) => c.defId !== '?')).toBe(true);
    });
  });

  describe('決め打ち(hypothesis)', () => {
    const hypo = (weight: number, defId = 'dmrp17-s07'): InfoPolicy => ({
      preset: 'hypothesis',
      knowOpponentDecklist: true,
      hypotheses: [{ defId }],
      hypothesisWeight: weight,
    });
    it('重み1なら、仮説のカードが相手の手札に置かれる', () => {
      let hit = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const state = game(seed);
        const p = hypo(1);
        const view = toPlayerView(state, 0, p, reg);
        const d = determinize(view, 0, { rand: mulberry(seed), reg, policy: p });
        if (d.players[1].hand.some((u) => d.cards[u].defId === 'dmrp17-s07')) hit++;
        expect(sorted(ownedBy(d, 1))).toBe(sorted(zardy));
      }
      expect(hit).toBe(10);
    });
    it('重み0なら、仮説は強制されない(通常の無作為な割り当て)', () => {
      let hit = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const p = hypo(0);
        const view = toPlayerView(game(seed), 0, p, reg);
        const d = determinize(view, 0, { rand: mulberry(seed), reg, policy: p });
        if (d.players[1].hand.some((u) => d.cards[u].defId === 'dmrp17-s07')) hit++;
      }
      // 手札5枚に4/35程度の確率で入る。全部に入ることはない
      expect(hit).toBeLessThan(20);
    });
    it('デッキにないカードの仮説は無視される(割り当ては崩れない)', () => {
      const p = hypo(1, 'dm24rp3-008'); // マルルのデッキのカード。相手(ザーディ)にはない
      const view = toPlayerView(game(2), 0, p, reg);
      const d = determinize(view, 0, { rand: mulberry(2), reg, policy: p });
      expect(sorted(ownedBy(d, 1))).toBe(sorted(zardy));
    });
  });

  describe('部分開示(手札の種類)', () => {
    it('開示された種類の枚数と、決定化後の手札の種類の枚数が(ほぼ)一致する', () => {
      const p: InfoPolicy = { preset: 'partial', knowOpponentDecklist: true, reveal: { opponentHandKinds: ['shieldTrigger'] } };
      let match = 0;
      const N = 12;
      for (let seed = 1; seed <= N; seed++) {
        const state = game(seed);
        const view = toPlayerView(state, 0, p, reg);
        const want = view.hints!.oppHandKinds!.shieldTrigger;
        const d = determinize(view, 0, { rand: mulberry(seed), reg, policy: p });
        const got = d.players[1].hand.filter((u) => kindsOf(reg, d.cards[u].defId).includes('shieldTrigger')).length;
        if (got === want) match++;
        expect(sorted(ownedBy(d, 1))).toBe(sorted(zardy));
      }
      expect(match).toBeGreaterThanOrEqual(Math.floor(N * 0.7));
    });
  });
});
