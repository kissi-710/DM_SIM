import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../src/cards';
import { createGame, legalActions } from '../src/engine/engine';
import { loadRegistry } from '../src/engine/registry';
import { toPlayerView, FAIR } from '../src/engine/view';
import { determinize } from '../src/ai/determinize';
import { runMatches } from '../src/sim/batch';
import { mulberry } from '../src/sim/playGame';
import { checkInvariants } from '../src/engine/invariants';

const reg = loadRegistry(CARD_DB);

describe('PlayerView と決定化', () => {
  it('公平な view では、相手の手札・シールド・山札と自分の山札・シールドが隠れる', () => {
    const { state } = createGame(CARD_DB, { decks: [deckCards('maruru'), deckCards('zardy')], seed: 4, first: 0 });
    const v = toPlayerView(state, 0, FAIR, reg);
    for (const u of state.players[1].hand) expect(v.cards[u].defId).toBe('?');
    for (const u of state.players[1].shield) expect(v.cards[u].defId).toBe('?');
    for (const u of state.players[0].shield) expect(v.cards[u].defId).toBe('?');
    for (const u of state.players[0].hand) expect(v.cards[u].defId).not.toBe('?');
    // 元の状態は変わらない
    expect(state.cards[state.players[1].hand[0]].defId).not.toBe('?');
  });
  it('全開示では相手の手札が見える', () => {
    const { state } = createGame(CARD_DB, { decks: [deckCards('maruru'), deckCards('zardy')], seed: 4, first: 0 });
    const v = toPlayerView(state, 0, { preset: 'full', knowOpponentDecklist: true }, reg);
    for (const u of state.players[1].hand) expect(v.cards[u].defId).not.toBe('?');
  });
  it('部分開示: 指定した枚数だけ相手の手札が見える', () => {
    const { state } = createGame(CARD_DB, { decks: [deckCards('maruru'), deckCards('zardy')], seed: 4, first: 0 });
    const v = toPlayerView(state, 0, { preset: 'partial', knowOpponentDecklist: true, reveal: { opponentHandCount: 2 } }, reg);
    const shown = state.players[1].hand.filter((u) => v.cards[u].defId !== '?').length;
    expect(shown).toBe(2);
  });
  it('決定化で隠れたカードが埋まり、デッキの構成と整合する', () => {
    const { state } = createGame(CARD_DB, { decks: [deckCards('maruru'), deckCards('zardy')], seed: 4, first: 0 });
    const v = toPlayerView(state, 0, FAIR, reg);
    const d = determinize(v, 0, { rand: mulberry(1), reg, policy: FAIR });
    expect(d.cards.every((c) => c.defId !== '?')).toBe(true);
    expect(checkInvariants(d)).toEqual([]);
    const count = (p: number) => d.cards.filter((c) => c.owner === p).map((c) => c.defId).sort().join(',');
    expect(count(0)).toBe([...deckCards('maruru')].sort().join(','));
    expect(count(1)).toBe([...deckCards('zardy')].sort().join(','));
    // 自分の手札は変わらない
    for (const u of state.players[0].hand) expect(d.cards[u].defId).toBe(state.cards[u].defId);
    expect(legalActions(d, reg).length).toBeGreaterThan(0);
  });
  it('決定化は相手の公開済みカードを引き算した母集団から割り当てる', () => {
    const { state } = createGame(CARD_DB, { decks: [deckCards('maruru'), deckCards('zardy')], seed: 9, first: 0 });
    // 相手の手札を1枚墓地に置いた状態(公開済み)
    const u = state.players[1].hand[0];
    state.players[1].hand.splice(0, 1);
    state.players[1].grave.push(u);
    state.cards[u].zone = 'grave';
    const v = toPlayerView(state, 0, FAIR, reg);
    const d = determinize(v, 0, { rand: mulberry(2), reg, policy: FAIR });
    const count = (p: number) => d.cards.filter((c) => c.owner === p).map((c) => c.defId).sort().join(',');
    expect(count(1)).toBe([...deckCards('zardy')].sort().join(','));
  });
});

describe('AI の強さ(回帰)', () => {
  it('ルールベースはランダムに勝ち越す(勝率60%以上)', () => {
    const s = runMatches(CARD_DB, {
      deckA: deckCards('maruru'),
      deckB: deckCards('zardy'),
      agentA: { kind: 'rule' },
      agentB: { kind: 'random' },
      games: 60,
      seed: 100,
      first: 'alternate',
    });
    expect(s.winRateA).toBeGreaterThanOrEqual(0.6);
  }, 120000);
  it('同じデッキ同士でも、ルールベースはランダムに勝ち越す', () => {
    const s = runMatches(CARD_DB, {
      deckA: deckCards('zardy'),
      deckB: deckCards('zardy'),
      agentA: { kind: 'rule' },
      agentB: { kind: 'random' },
      games: 60,
      seed: 500,
      first: 'alternate',
    });
    expect(s.winRateA).toBeGreaterThanOrEqual(0.6);
  }, 120000);
});
