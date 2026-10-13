import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../../src/cards';
import { createGame } from '../../src/engine/engine';
import { FAIR, FULL, INFO_PRESET_LABEL, kindsOf, toPlayerView, type InfoPolicy } from '../../src/engine/view';
import { Sim, mana, reg, defIdOf } from '../scenario';

const state = (seed = 4) => createGame(CARD_DB, { decks: [deckCards('maruru'), deckCards('zardy')], seed, first: 0 }).state;
const hidden = (v: ReturnType<typeof state>, uids: number[]) => uids.filter((u) => v.cards[u].defId === '?').length;

describe('kindsOf(カードの種類)', () => {
  const k = (name: string) => kindsOf(reg, defIdOf(name)).sort();
  it('クリーチャー・呪文・S・トリガー・ブロッカー・スピードアタッカー', () => {
    expect(k('ヨビニオン・マルル')).toEqual(['creature']);
    expect(k('フェアリー・ライフ')).toEqual(['shieldTrigger', 'spell']);
    expect(k('ティンパニ=シンバリー')).toEqual(['blocker', 'creature']);
    expect(k('漢気の2号 ボスカツ')).toEqual(['creature', 'speedAttacker']);
    expect(k('王道の革命 ドギラゴン')).toEqual(['blocker', 'creature', 'shieldTrigger', 'speedAttacker']);
  });
  it('ツインパクトは両方の面の種類を持つ', () => {
    expect(k('ワクムテラス')).toEqual(['creature', 'spell']);
    expect(k('修羅の死神フミシュナ')).toEqual(['blocker', 'creature', 'shieldTrigger', 'spell']);
  });
  it('未知のカードは空', () => {
    expect(kindsOf(reg, 'nope')).toEqual([]);
  });
});

describe('toPlayerView', () => {
  it('公平: 自分のシールド・山札、相手の手札・シールド・山札が隠れ、自分の手札・墓地・場は見える', () => {
    const s = state();
    const v = toPlayerView(s, 0, FAIR, reg);
    const me = s.players[0];
    const op = s.players[1];
    expect(hidden(v, me.deck)).toBe(me.deck.length);
    expect(hidden(v, me.shield)).toBe(me.shield.length);
    expect(hidden(v, me.hand)).toBe(0);
    expect(hidden(v, op.hand)).toBe(op.hand.length);
    expect(hidden(v, op.shield)).toBe(op.shield.length);
    expect(hidden(v, op.deck)).toBe(op.deck.length);
  });
  it('後攻(席1)視点でも対称に隠れる', () => {
    const s = state();
    const v = toPlayerView(s, 1, FAIR, reg);
    expect(hidden(v, s.players[1].hand)).toBe(0);
    expect(hidden(v, s.players[0].hand)).toBe(5);
  });
  it('公開されている領域(マナ・墓地・バトルゾーン)は、相手のものも見える', () => {
    const sim = new Sim({ p0: { mana: mana(2), grave: ['天災 デドダム'], battle: ['ヨビニオン・マルル'] }, p1: { mana: mana(3), grave: ['アクアン'], battle: ['ティンパニ=シンバリー'] } });
    const v = toPlayerView(sim.s, 0, FAIR, reg);
    for (const p of [0, 1] as const) {
      for (const u of [...sim.s.players[p].mana, ...sim.s.players[p].grave, ...sim.s.players[p].battle.flatMap((x) => x.cards)]) {
        expect(v.cards[u].defId).not.toBe('?');
      }
    }
  });
  it('元の状態を書き換えない', () => {
    const s = state();
    const before = JSON.stringify(s);
    toPlayerView(s, 0, FAIR, reg);
    expect(JSON.stringify(s)).toBe(before);
  });
  it('全開示: 何も隠さず、knowOppDeck の hint が付く', () => {
    const s = state();
    const v = toPlayerView(s, 0, FULL, reg);
    expect(v.cards.every((c, i) => c.defId === s.cards[i].defId)).toBe(true);
    expect(v.hints).toEqual({ knowOppDeck: true });
  });
  it('部分開示(枚数): 手札の先頭から指定枚数だけ中身が見える', () => {
    const s = state();
    for (const n of [0, 1, 3, 5]) {
      const p: InfoPolicy = { preset: 'partial', knowOpponentDecklist: true, reveal: { opponentHandCount: n } };
      const v = toPlayerView(s, 0, p, reg);
      expect(s.players[1].hand.filter((u) => v.cards[u].defId !== '?').length).toBe(n);
      // 相手のシールド・山札は開示されない
      expect(hidden(v, s.players[1].shield)).toBe(5);
    }
  });
  it('部分開示(種類): 手札のうち、その種類のカードの枚数だけが hints に入る', () => {
    const sim = new Sim({ p1: { hand: ['フェアリー・ライフ', 'ティンパニ=シンバリー', 'ヨビニオン・マルル', 'ドラゴンズ・サイン'] } });
    const p: InfoPolicy = { preset: 'partial', knowOpponentDecklist: true, reveal: { opponentHandKinds: ['shieldTrigger', 'blocker', 'spell', 'speedAttacker'] } };
    const v = toPlayerView(sim.s, 0, p, reg);
    expect(v.hints?.oppHandKinds).toEqual({ shieldTrigger: 2, blocker: 1, spell: 2, speedAttacker: 0 });
    // 中身そのものは見えない
    expect(hidden(v, sim.s.players[1].hand)).toBe(4);
  });
  it('決め打ち(hypothesis)でも、手札の中身は隠れたまま(割り当ては決定化で行う)', () => {
    const s = state();
    const p: InfoPolicy = { preset: 'hypothesis', knowOpponentDecklist: true, hypotheses: [{ defId: 'dmrp17-s07' }] };
    const v = toPlayerView(s, 0, p, reg);
    expect(hidden(v, s.players[1].hand)).toBe(5);
  });
  it('デッキリストが未知なら、相手の deckIds を空にする(自分のは残す)', () => {
    const s = state();
    const v0 = toPlayerView(s, 0, { preset: 'fair', knowOpponentDecklist: false }, reg);
    expect(v0.deckIds[0]).toHaveLength(40);
    expect(v0.deckIds[1]).toEqual([]);
    const v1 = toPlayerView(s, 1, { preset: 'fair', knowOpponentDecklist: false }, reg);
    expect(v1.deckIds[0]).toEqual([]);
    expect(v1.deckIds[1]).toHaveLength(40);
    expect(toPlayerView(s, 0, FAIR, reg).deckIds[1]).toHaveLength(40);
  });
  it('乱数の状態は漏らさない(固定値にする)', () => {
    const v = toPlayerView(state(), 0, FAIR, reg);
    expect(v.rng).toBe(1);
  });
  it('選択の場面では、提示されたカード(候補)だけが、選ぶ本人に見える', () => {
    const sim = new Sim({
      p0: { hand: ['天災 デドダム'], mana: ['アクアン', 'ロスト・Re:ソウル', 'フェアリー・ライフ'], deck: ['フェアリー・ライフ', 'ティンパニ=シンバリー', 'ジ・ウォッチ', 'ダミー', 'ダミー'] },
    });
    sim.play('天災 デドダム');
    // デドダムは山札の上3枚を見て振り分ける(assign)
    expect(sim.pending.input?.shape).toBe('assign');
    const cands = (sim.pending.input as any).items as number[];
    expect(cands.length).toBeGreaterThan(0);
    const v = toPlayerView(sim.s, 0, FAIR, reg);
    for (const u of cands) expect(v.cards[u].defId).toBe(sim.s.cards[u].defId);
    // 候補でない山札のカードは見えない
    const rest = sim.s.players[0].deck.filter((u) => !cands.includes(u));
    expect(hidden(v, rest)).toBe(rest.length);
    // 相手視点では、候補も見えない
    const ov = toPlayerView(sim.s, 1, FAIR, reg);
    for (const u of cands) expect(ov.cards[u].defId).toBe('?');
  });
  it('ログに残るイベントの lki(離れる前の情報)は、見える側にも含めない', () => {
    const sim = new Sim({ p0: { battle: ['終末縫合王 ザ=キラー・キーナリー'] }, p1: { shield: ['アクアン'] } });
    sim.s.turnLog.push({ id: 99, causedBy: null, type: 'moved', turn: 5, lki: { defId: 'dm23bd1-007' } } as any);
    const v = toPlayerView(sim.s, 0, FAIR, reg);
    expect(v.turnLog.every((e) => !('lki' in e))).toBe(true);
    // 元の状態のログには残る
    expect(sim.s.turnLog.some((e) => 'lki' in e)).toBe(true);
  });
});

describe('情報条件の表示名', () => {
  it('すべてのプリセットにラベルがある', () => {
    for (const k of ['fair', 'partial', 'hypothesis', 'full'] as const) expect(INFO_PRESET_LABEL[k].length).toBeGreaterThan(0);
  });
});
