import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../../src/cards';
import { randomAgent } from '../../src/ai/random';
import type { Agent } from '../../src/ai/types';
import { checkInvariants } from '../../src/engine/invariants';
import { mulberry, playGame, playGameSync } from '../../src/sim/playGame';

const decks = (): [string[], string[]] => [deckCards('maruru'), deckCards('zardy')];

describe('mulberry', () => {
  it('同じシードなら同じ列、0以上1未満', () => {
    const a = mulberry(42);
    const b = mulberry(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
  it('シードが違えば別の列', () => {
    expect(mulberry(1)()).not.toBe(mulberry(2)());
  });
});

describe('playGameSync', () => {
  it('勝者・理由・ターン数・行動列を返し、最終状態の不変条件を満たす', () => {
    const r = playGameSync(CARD_DB, [randomAgent, randomAgent], { decks: decks(), seed: 3 });
    expect(r.winner).not.toBeNull();
    expect(r.turns).toBe(r.state.turn);
    expect(r.steps).toBe(r.actions.length);
    expect(r.steps).toBeGreaterThan(0);
    expect(checkInvariants(r.state)).toEqual([]);
    if (r.winner !== 'draw') expect(r.reason).toBeTruthy();
  });
  it('onStep は全ての手のあとに、行動とイベントつきで呼ばれる', () => {
    let n = 0;
    let evs = 0;
    const r = playGameSync(CARD_DB, [randomAgent, randomAgent], {
      decks: decks(),
      seed: 4,
      onStep: (_s, a, e) => {
        n++;
        evs += e.length;
        expect(a.type).toBeTruthy();
      },
    });
    expect(n).toBe(r.steps);
    expect(evs).toBeGreaterThan(0);
  });
  it('maxSteps で打ち切られる(勝者なし)', () => {
    const r = playGameSync(CARD_DB, [randomAgent, randomAgent], { decks: decks(), seed: 3, maxSteps: 5 });
    expect(r.steps).toBe(5);
    expect(r.winner).toBeNull();
  });
  it('first を指定すると、その席が先攻になる', () => {
    for (const first of [0, 1] as const) {
      const r = playGameSync(CARD_DB, [randomAgent, randomAgent], { decks: decks(), seed: 3, first, maxSteps: 1 });
      expect(r.state.first).toBe(first);
    }
  });
  it('構築制限(strict): 40枚でなければ例外', () => {
    const bad: [string[], string[]] = [deckCards('maruru').slice(0, 30), deckCards('zardy')];
    expect(() => playGameSync(CARD_DB, [randomAgent, randomAgent], { decks: bad, seed: 1, strict: true })).toThrow();
  });
  it('非同期のAIは例外(同期実行では使えない)', () => {
    const slow: Agent = { name: 'slow', chooseAction: async (_v, legal) => legal[0] };
    expect(() => playGameSync(CARD_DB, [slow, randomAgent], { decks: decks(), seed: 1 })).toThrow(/非同期/);
  });
  it('エージェントには相手の手札が見えない(needsView 既定)', () => {
    let leaked = false;
    const spy: Agent = {
      name: 'spy',
      chooseAction(view, legal) {
        const me = view.pending!.player;
        for (const u of view.players[1 - me].hand) if (view.cards[u].defId !== '?') leaked = true;
        return legal[0];
      },
    };
    playGameSync(CARD_DB, [spy, randomAgent], { decks: decks(), seed: 6, maxSteps: 60 });
    expect(leaked).toBe(false);
  });
  it('needsView=false のエージェントにはマスクしていない状態が渡る', () => {
    let seen = false;
    const peek: Agent = {
      name: 'peek',
      needsView: false,
      chooseAction(view, legal) {
        const me = view.pending!.player;
        if (view.players[1 - me].hand.some((u) => view.cards[u].defId !== '?')) seen = true;
        return legal[0];
      },
    };
    playGameSync(CARD_DB, [peek, randomAgent], { decks: decks(), seed: 6, maxSteps: 10 });
    expect(seen).toBe(true);
  });
  it('エージェントが合法でない手を返したら例外', () => {
    const bad: Agent = { name: 'bad', needsView: false, chooseAction: () => ({ type: 'END_MAIN' }) };
    expect(() => playGameSync(CARD_DB, [bad, bad], { decks: decks(), seed: 1 })).toThrow();
  });
});

describe('playGame(非同期)', () => {
  it('同期版と同じ行動列・最終状態になる', async () => {
    const opts = { decks: decks(), seed: 21 };
    const a = playGameSync(CARD_DB, [randomAgent, randomAgent], opts);
    const b = await playGame(CARD_DB, [randomAgent, randomAgent], opts);
    expect(b.actions).toEqual(a.actions);
    expect(b.winner).toBe(a.winner);
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
  });
  it('非同期のAIを使える', async () => {
    const slow: Agent = { name: 'slow', needsView: false, chooseAction: async (_v, legal, ctx) => legal[Math.floor(ctx.rand() * legal.length)] };
    const r = await playGame(CARD_DB, [slow, slow], { decks: decks(), seed: 8 });
    expect(r.winner).not.toBeNull();
  });
  it('maxSteps で打ち切られる', async () => {
    const r = await playGame(CARD_DB, [randomAgent, randomAgent], { decks: decks(), seed: 8, maxSteps: 7 });
    expect(r.steps).toBe(7);
    expect(r.winner).toBeNull();
  });
});
