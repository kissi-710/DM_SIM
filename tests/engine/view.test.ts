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
  it('シールドを選ぶ場面(ジャオウガの「3枚残す」)でも、候補のシールドの中身は見えない', () => {
    const sim = new Sim({
      p0: { hand: ['CRYMAX ジャオウガ'], mana: mana(7, 'ロスト・Re:ソウル'), shield: ['アクアン', 'ロスト・Re:ソウル', 'フェアリー・ライフ', 'ドラゴンズ・サイン', 'ティンパニ=シンバリー'] },
      p1: { shield: ['フェアリー・ライフ', 'アクアン', 'ロスト・Re:ソウル', 'ドラゴンズ・サイン', 'ティンパニ=シンバリー'] },
    });
    sim.play('CRYMAX ジャオウガ');
    const inp: any = sim.pending.input;
    expect(inp.shape).toBe('pick');
    expect(inp.candidates).toHaveLength(5);
    // 選ぶ本人(p0)にも、自分のシールドは裏向きのまま。相手のシールドも見えない
    const v = toPlayerView(sim.s, 0, FAIR, reg);
    expect(hidden(v, inp.candidates)).toBe(5);
    expect(hidden(v, sim.s.players[1].shield)).toBe(5);
  });
  it('ブレイクされたシールドは、S・トリガーの宣言の場面で持ち主に見える', () => {
    const sim = new Sim({
      active: 1,
      p0: { shield: ['フェアリー・ライフ', 'フェアリー・ライフ', 'フェアリー・ライフ'] },
      p1: { battle: ['ヨビニオン・マルル'] },
    });
    sim.attack('ヨビニオン・マルル', 'player');
    expect(sim.pending.why).toBe('triggerDeclare');
    const inp: any = sim.pending.input;
    const v = toPlayerView(sim.s, 0, FAIR, reg);
    for (const u of inp.candidates as number[]) expect(v.cards[u].defId).toBe(sim.s.cards[u].defId);
    // 割られなかったシールドは、見えないまま
    const rest = sim.s.players[0].shield.filter((u) => !sim.s.breaking.includes(u));
    expect(hidden(v, rest)).toBe(rest.length);
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

describe('隠れたカードの正体を、uid と deckIds から割り出せない', () => {
  const deckA = deckCards('maruru');
  const deckB = deckCards('zardy');
  const states = [1, 2, 3, 4, 5].map((seed) => createGame(CARD_DB, { decks: [deckA, deckB], seed, first: (seed % 2) as 0 | 1 }).state);

  it('デッキリストの並びで uid を引いても、当たりは偶然の割合しかない', () => {
    let hiddenN = 0;
    let hit = 0;
    for (const s of states) {
      const v = toPlayerView(s, 0, FAIR, reg);
      for (let u = 0; u < v.cards.length; u++) {
        if (v.cards[u].defId !== '?') continue;
        hiddenN++;
        const owner = v.cards[u].owner;
        const offset = owner === 0 ? 0 : deckA.length;
        if (v.deckIds[owner][u - offset] === s.cards[u].defId) hit++;
      }
    }
    expect(hiddenN).toBeGreaterThan(300);
    // 以前は 100% 復元できた。偶然の一致(同名カードが並ぶ分)は1割に満たない
    expect(hit / hiddenN).toBeLessThan(0.2);
  });
  it('uid が隣り合うカードが同名とは限らない(同名が連続して振られない)', () => {
    let pairs = 0;
    let same = 0;
    for (const s of states) {
      for (let u = 0; u + 1 < s.cards.length; u++) {
        if (s.cards[u].owner !== s.cards[u + 1].owner) continue;
        pairs++;
        if (s.cards[u].defId === s.cards[u + 1].defId) same++;
      }
    }
    expect(same / pairs).toBeLessThan(0.2);
  });
  it('deckIds はソート済みの多重集合(デッキリストの並びを残さない)', () => {
    const s = states[0];
    expect(s.deckIds[0]).toEqual([...deckA].sort());
    expect(s.deckIds[1]).toEqual([...deckB].sort());
  });
});

describe('toPlayerView: 入れ子のイベント・待機プールから、隠れたカードが漏れない', () => {
  const setup = () => {
    const s = state();
    const opp = s.players[1].hand[0]; // 相手の手札(自分には見えない)
    const defId = s.cards[opp].defId;
    const ref = { defId, face: 0, idx: 0 };
    const snap = { uid: opp, defId, owner: 1 as const, face: 0, zone: 'hand' as const, civs: ['water' as const], cost: 3, power: 0, multicolor: false, pid: -1 };
    const moved = { id: 1, causedBy: null, type: 'moved', turn: 1, card: opp, lki: snap };
    s.turnLog.push({ id: 2, causedBy: 1, type: 'abilityTriggered', turn: 1, ability: ref, source: opp, controller: 1, cause: moved, entry: 9 });
    const entry = { id: 9, batch: 1, ability: ref, kind: 'ability' as const, source: { uid: opp, ep: 0 }, lki: snap, controller: 1 as const, event: moved, stLayer: false };
    s.pool.push(entry);
    return { s, opp, defId, entry };
  };
  it('turnLog: 誘発した能力の持ち主(見えないカード)の定義IDと、入れ子の lki が消える', () => {
    const { s, defId } = setup();
    const v = toPlayerView(s, 0, FAIR, reg);
    const e = v.turnLog.find((x) => x.type === 'abilityTriggered')!;
    expect(e.ability.defId).toBe('?');
    expect(e.cause.lki).toBeUndefined();
    expect(JSON.stringify(v.turnLog)).not.toContain(defId);
    // 元の状態は書き換えない(イベントは共有される)
    expect(s.turnLog.find((x) => x.type === 'abilityTriggered')!.ability.defId).toBe(defId);
  });
  it('待機プール: 見えない持ち主の、宣言していない「してもよい」の能力は、相手には出さない。宣言済み・S・トリガーは残す', () => {
    const { s, entry } = setup();
    expect(toPlayerView(s, 0, FAIR, reg).pool).toHaveLength(0);
    s.pool[0] = { ...entry, declared: true };
    expect(toPlayerView(s, 0, FAIR, reg).pool).toHaveLength(1);
    s.pool[0] = { ...entry, kind: 'shieldTrigger' };
    expect(toPlayerView(s, 0, FAIR, reg).pool).toHaveLength(1);
    // 自分の見える持ち主(自分の手札)の分は、そのまま
    const mine = s.players[0].hand[0];
    s.pool[0] = { ...entry, source: { uid: mine, ep: 0 } };
    expect(toPlayerView(s, 0, FAIR, reg).pool).toHaveLength(1);
  });
});
