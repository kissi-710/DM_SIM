// G城(城カード): 実行すると表向きのシールドになる / 表向きのシールドが離れる時は墓地へ / 表向きでシールドに置かれた時の誘発 /
// 表向きの間、相手の召喚以外の出現をマナゾーンへ置換 / 表向きのシールドは両者に見える。テスト用の城(T城)で固定する。
import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../../src/cards';
import { mkCC, selectCards } from '../../src/engine/cond';
import { loadRegistry } from '../../src/engine/registry';
import { mkCtx } from '../../src/engine/state';
import type { CardDB } from '../../src/engine/types';
import { FAIR, toPlayerView } from '../../src/engine/view';
import { BATTLE_TEST_CARDS } from '../fixtures/battle-cards';
import { Sim, mana } from '../scenario';

const DB: CardDB = { ...CARD_DB, ...Object.fromEntries(BATTLE_TEST_CARDS.map((c) => [c.id, c])) };
const R = loadRegistry(DB);

/** シールドゾーンの城を、表向きにする */
function faceUp(sim: Sim, p: 0 | 1, name = 'T城') {
  for (const u of sim.s.players[p].shield) if (R.defs[sim.s.cards[u].defId].name === name) sim.s.cards[u].up = true;
}

describe('G城の実行', () => {
  it('コストを払って実行すると、表向きのシールドになる(呪文を唱えたことにはならない)', () => {
    const sim = new Sim({ p0: { hand: ['T城'], mana: mana(3), shield: 5, deck: 10 } }, R);
    expect(sim.canPlay('T城')).toBe(true);
    sim.play('T城');
    sim.drain();
    expect(sim.count(0, 'shield')).toBe(6);
    expect(sim.count(0, 'hand')).toBe(0);
    const castle = sim.uid(0, 'shield', 'T城');
    expect(sim.s.cards[castle].up).toBe(true);
    expect(sim.evs('executed')).toHaveLength(1);
    expect(sim.evs('cast')).toHaveLength(0); // 「呪文を唱えた」ではない
    expect(sim.tappedMana(0)).toBeGreaterThanOrEqual(3);
  });
  it('表向きでシールドに置かれた時、山札の上1枚をタップしてマナゾーンに置く', () => {
    const sim = new Sim({ p0: { hand: ['T城'], mana: mana(3), deck: 10 } }, R);
    sim.play('T城');
    sim.drain();
    expect(sim.count(0, 'mana')).toBe(4);
    expect(sim.count(0, 'deck')).toBe(9);
    expect(sim.tappedMana(0)).toBe(4); // 支払った3枚と、タップして置かれた1枚
  });
  it('呪文を唱えられない状態でも、実行できる', () => {
    const sim = new Sim({ p0: { hand: ['T城'], mana: mana(3) } }, R);
    sim.s.effects.push({ id: 99, pid: -1, mod: { kind: 'cannotCast' }, until: { kind: 'endOfTurn', turn: sim.s.turn }, controller: 1 });
    expect(sim.canPlay('T城')).toBe(true);
  });
  it('コストが足りなければ実行できない', () => {
    const sim = new Sim({ p0: { hand: ['T城'], mana: mana(2) } }, R);
    expect(sim.canPlay('T城')).toBe(false);
  });
  it('クリーチャーでも呪文でもない(セレクタの type に合わない)', () => {
    const sim = new Sim({ p0: { hand: ['T城'] } }, R);
    const cc = mkCC(mkCtx(sim.s, R), 0);
    expect(selectCards(cc, { zone: 'hand', owner: 'self', type: 'spell' })).toHaveLength(0);
    expect(selectCards(cc, { zone: 'hand', owner: 'self', type: 'creature' })).toHaveLength(0);
    expect(selectCards(cc, { zone: 'hand', owner: 'self', type: 'card' })).toHaveLength(1);
  });
});

describe('表向きのシールド(G城)が離れる時', () => {
  it('ブレイクされると、手札に加わらず墓地に置かれる(S・トリガー等は使えない)', () => {
    const sim = new Sim({ p0: { battle: [{ c: 'T小型', sick: false }] }, p1: { shield: ['T城'], hand: [] } }, R);
    faceUp(sim, 1);
    sim.attack('T小型', 'player');
    sim.drain();
    expect(sim.count(1, 'hand')).toBe(0);
    expect(sim.has(1, 'grave', 'T城')).toBe(true);
    expect(sim.count(1, 'shield')).toBe(0);
    expect(sim.s.cards[sim.uid(1, 'grave', 'T城')].up).toBeUndefined(); // 離れたら、表向きの印は消える
    expect(sim.s.winner).toBeNull(); // ブレイクしただけで、ダイレクトアタックにはならない
  });
  it('裏向きのシールドは、ふつうに手札に加わる', () => {
    const sim = new Sim({ p0: { battle: [{ c: 'T小型', sick: false }] }, p1: { shield: 1 } }, R);
    sim.attack('T小型', 'player');
    sim.drain();
    expect(sim.count(1, 'hand')).toBe(1);
  });
});

describe('表向きの間、相手のクリーチャーが召喚以外で出る時は、かわりにマナゾーンに置く', () => {
  it('効果で出す(踏み倒し)と、マナゾーンに置かれる', () => {
    const sim = new Sim(
      { p0: { hand: ['ドラゴンズ・サイン', '龍風混成 ザーディクリカ'], mana: mana(5, 'ドラゴンズ・サイン') }, p1: { shield: ['T城'] } },
      R,
    );
    faceUp(sim, 1);
    sim.play('ドラゴンズ・サイン');
    sim.drain();
    expect(sim.count(0, 'battle')).toBe(0);
    expect(sim.has(0, 'mana', '龍風混成 ザーディクリカ')).toBe(true);
    expect(sim.s.cards[sim.uid(0, 'mana', '龍風混成 ザーディクリカ')].tapped).toBe(true); // 多色はタップして置く
  });
  it('召喚は止められない(コストを払うものも、効果による召喚も)', () => {
    const sim = new Sim({ p0: { hand: ['アクアン'], mana: mana(5, 'アクアン') }, p1: { shield: ['T城'] } }, R);
    faceUp(sim, 1);
    sim.play('アクアン');
    sim.drain();
    expect(sim.has(0, 'battle', 'アクアン')).toBe(true);
  });
  it('裏向きの城(まだ表向きでない)は、置換しない', () => {
    const sim = new Sim(
      { p0: { hand: ['ドラゴンズ・サイン', '龍風混成 ザーディクリカ'], mana: mana(5, 'ドラゴンズ・サイン') }, p1: { shield: ['T城'] } },
      R,
    );
    sim.play('ドラゴンズ・サイン');
    sim.drain();
    expect(sim.has(0, 'battle', '龍風混成 ザーディクリカ')).toBe(true);
  });
  it('自分の城は、自分のクリーチャーの出現を置換しない', () => {
    const sim = new Sim(
      { p0: { hand: ['ドラゴンズ・サイン', '龍風混成 ザーディクリカ'], mana: mana(5, 'ドラゴンズ・サイン'), shield: ['T城'] } },
      R,
    );
    faceUp(sim, 0);
    sim.play('ドラゴンズ・サイン');
    sim.drain();
    expect(sim.has(0, 'battle', '龍風混成 ザーディクリカ')).toBe(true);
  });
});

describe('表向きのシールドは、両者に見える', () => {
  it('相手の視点でも、表向きの城の中身は見え、裏向きのシールドは見えない', () => {
    const sim = new Sim({ p0: { shield: 1 }, p1: { shield: ['T城', 'T城'] } }, R);
    sim.s.cards[sim.s.players[1].shield[0]].up = true;
    const v = toPlayerView(sim.s, 0, FAIR, R);
    expect(v.cards[v.players[1].shield[0]].defId).toBe('tc-castle');
    expect(v.cards[v.players[1].shield[1]].defId).toBe('?');
    expect(v.cards[v.players[0].shield[0]].defId).toBe('?'); // 自分の裏向きのシールドも見えない
  });
});
