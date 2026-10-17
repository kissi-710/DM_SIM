// 公開されて山札の下に戻った札(ヨビニオン)を、視点とAIの推論に使う
import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../../src/cards';
import { determinize } from '../../src/ai/determinize';
import { createGame } from '../../src/engine/engine';
import { mkCtx, cloneState } from '../../src/engine/state';
import { shuffleDeck } from '../../src/engine/ops';
import { FAIR, toPlayerView, type InfoPolicy } from '../../src/engine/view';
import { mulberry } from '../../src/sim/playGame';
import { reg, Sim, mana } from '../scenario';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const D = 'ロスト・Re:ソウル';
const A = 'dm24rp3-S10'; // ヨビニオン・マルル(推論の確認用に、数を数えやすい札として使う)

/** ヨビニオンが空振りして、公開した3枚(N, N, W)が山札の下に戻った局面 */
function whiffed() {
  const sim = new Sim({ p0: { hand: ['ヨビニオン・マルル'], mana: mana(4), deck: [N, N, W] } });
  sim.play('ヨビニオン・マルル');
  sim.yes();
  return sim;
}

describe('公開された山札の下の札を、状態と視点に残す', () => {
  it('ヨビニオンで公開して戻した札のまとまりが記録され、両者の視点に中身が渡る(並びは渡さない)', () => {
    const sim = whiffed();
    expect(sim.s.knownDeck?.[0]).toHaveLength(1);
    expect(sim.s.knownDeck?.[1]).toEqual([]);
    for (const viewer of [0, 1] as const) {
      const v = toPlayerView(sim.s, viewer, FAIR, reg);
      const g = v.hints?.deckKnown?.[0];
      expect(g).toHaveLength(1);
      expect(g![0].defIds).toEqual([...g![0].defIds].sort());
      expect(g![0].defIds).toHaveLength(3);
      expect([...g![0].defIds].sort()).toEqual([...sim.s.players[0].deck.map((u) => sim.s.cards[u].defId)].sort());
      expect(g![0].uids).toEqual([...sim.s.players[0].deck].sort((a, b) => a - b));
      // 山札のカードそのものは、相変わらず伏せたまま(順序を漏らさない)
      expect(g![0].uids.every((u) => v.cards[u].defId === '?')).toBe(true);
      expect(v.knownDeck).toBeUndefined();
      expect(v.hints?.deckKnown?.[1]).toEqual([]);
    }
  });
  it('inferRevealed=false なら、視点にヒントを渡さない(比較用)', () => {
    const v = toPlayerView(whiffed().s, 1, { ...FAIR, inferRevealed: false }, reg);
    expect(v.hints?.deckKnown).toBeUndefined();
  });
  it('公開した札が無い局面では、ヒントは付かない', () => {
    const sim = new Sim({ p0: { hand: [N], deck: 5 } });
    expect(toPlayerView(sim.s, 1, FAIR, reg).hints?.deckKnown).toBeUndefined();
  });
  it('まとまりの札が山札を離れたら、持ち主には残りが分かり、相手にはまとまりごと渡さない', () => {
    const sim = whiffed();
    const s = cloneState(sim.s);
    // 山札の一番上(まとまりの札)を引く
    const top = s.players[0].deck.shift()!;
    s.cards[top].zone = 'hand';
    s.cards[top].ep++;
    s.players[0].hand.push(top);
    const mine = toPlayerView(s, 0, FAIR, reg).hints?.deckKnown?.[0];
    expect(mine).toHaveLength(1);
    expect(mine![0].uids).toHaveLength(2);
    expect(toPlayerView(s, 1, FAIR, reg).hints?.deckKnown).toBeUndefined();
  });
  it('山札全体をシャッフルしたら、まとまりは消える', () => {
    const sim = whiffed();
    const s = cloneState(sim.s);
    shuffleDeck(mkCtx(s, reg), 0);
    expect(s.knownDeck?.[0]).toEqual([]);
    expect(toPlayerView(s, 1, FAIR, reg).hints?.deckKnown).toBeUndefined();
  });
  it('2回目のヨビニオンでも、別のまとまりとして積まれる', () => {
    const sim = new Sim({
      p0: { hand: ['ヨビニオン・トライブ', 'ヨビニオン・トライブ'], mana: mana(8), deck: [N, N, W, D, D, N] },
    });
    sim.play('ヨビニオン・トライブ');
    sim.yes();
    sim.play('ヨビニオン・トライブ');
    sim.yes();
    expect(sim.s.knownDeck![0].length).toBeGreaterThanOrEqual(1);
  });
});

describe('決定化: 公開された山札の下の札を使った推論', () => {
  // 40枚のデッキ = A が4枚 + 他。相手(1)の山札の下の3枚を A にして、その3枚を公開済みにする
  const deckOf = (n: number): string[] => [...Array(n).fill(A), ...Array(40 - n).fill('dummy')];
  function setup() {
    const state = createGame(CARD_DB, { decks: [deckOf(0), deckOf(4)], seed: 3, first: 0 }).state;
    for (const u of state.cards.keys()) if (state.cards[u].owner === 1) state.cards[u].defId = 'dummy';
    const deck = state.players[1].deck;
    const bottom = deck.slice(-4);
    for (const u of bottom) state.cards[u].defId = A;
    state.knownDeck = [[], [bottom.slice(1).map((u) => ({ uid: u, ep: state.cards[u].ep }))]];
    return { state, known: bottom.slice(1), fourth: bottom[0] };
  }
  const dets = (policy: InfoPolicy, n: number) => {
    const { state, known } = setup();
    const view = toPlayerView(state, 0, policy, reg);
    return { state, known, out: Array.from({ length: n }, (_, i) => determinize(view, 0, { rand: mulberry(i + 1), reg, policy })) };
  };

  it('公開された枠には、公開された中身が入り、デッキの内訳は変わらない', () => {
    const { state, known, out } = dets(FAIR, 20);
    for (const d of out) {
      for (const u of known) expect(d.cards[u].defId).toBe(A);
      expect(d.cards.every((c) => c.defId !== '?')).toBe(true);
      expect(d.cards.filter((c) => c.owner === 1 && c.defId === A)).toHaveLength(4);
      expect(d.players[1].deck).toEqual(state.players[1].deck);
    }
  });
  it('下に3枚あると分かっていれば、残りの1枚が相手の手札にある見込みは小さくなる(山札の下を未知のままにした場合より)', () => {
    const handA = (policy: InfoPolicy) => {
      const { out } = dets(policy, 300);
      let n = 0;
      for (const d of out) n += d.players[1].hand.filter((u) => d.cards[u].defId === A).length;
      return n / out.length;
    };
    const withHint = handA(FAIR);
    const without = handA({ ...FAIR, inferRevealed: false });
    // ヒントあり: 残り1枚が手札5枠に入る確率 5/37 ≒ 0.14。なし: 4枚が40枠にばらける → 期待 0.5
    expect(withHint).toBeLessThan(0.3);
    expect(without).toBeGreaterThan(0.35);
  });
  it('公開された札は、シールドにも手札にも置かれない(山札の枠にだけ入る)', () => {
    const { known, out } = dets(FAIR, 50);
    for (const d of out) for (const u of known) expect(d.cards[u].zone).toBe('deck');
  });
  it('個数が合わないヒントは無視する(壊れた入力で落ちない)', () => {
    const { state } = setup();
    const view = toPlayerView(state, 0, FAIR, reg);
    view.hints!.deckKnown![1][0].defIds.pop();
    const d = determinize(view, 0, { rand: mulberry(1), reg, policy: FAIR });
    expect(d.cards.every((c) => c.defId !== '?')).toBe(true);
  });
  it('自分の山札の下の公開札も、同じように割り当てる', () => {
    const sim = whiffed();
    const s = sim.s;
    s.deckIds = [[...s.cards.filter((c) => c.owner === 0).map((c) => c.defId)], [...s.cards.filter((c) => c.owner === 1).map((c) => c.defId)]];
    const view = toPlayerView(s, 0, FAIR, reg);
    const d = determinize(view, 0, { rand: mulberry(9), reg, policy: FAIR });
    expect([...s.players[0].deck.map((u) => d.cards[u].defId)].sort()).toEqual([...s.players[0].deck.map((u) => s.cards[u].defId)].sort());
  });
});
