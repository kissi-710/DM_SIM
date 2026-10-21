// CPU の「割るシールドの選択」: 表向きのシールド(G城)・EXライフ・裏向きのシールドを見分けて選ぶ(src/ai/shieldPick.ts)。
import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../../src/cards';
import { chooseShieldPick, shieldBreakScore } from '../../src/ai/shieldPick';
import { shieldClasses, shieldPickChoices } from '../../src/engine/procs';
import { loadRegistry } from '../../src/engine/registry';
import type { CardDB, CardDef } from '../../src/engine/types';
import { BATTLE_TEST_CARDS } from '../fixtures/battle-cards';
import { Sim } from '../scenario';

// 離れる時に誘発する能力を持つ城(蘇生など。割ると持ち主が得をする)
const LEAVE_CASTLE = {
  id: 'tc-castle-leave',
  name: 'T城・離',
  faces: [
    {
      name: 'T城・離',
      type: 'castle',
      cost: 3,
      civs: ['nature'],
      abilities: [
        {
          kind: 'trigger',
          label: 'T:城が離れた時',
          spec: { on: { type: 'moved', from: 'shield' }, subject: 'self', watch: ['shield'] },
          steps: [{ op: 'act', act: { moveTop: { n: 1, to: 'mana', cause: 'boost', tapped: true } } }],
        },
      ],
    },
  ],
} as unknown as CardDef;

const DB: CardDB = { ...CARD_DB, ...Object.fromEntries([...BATTLE_TEST_CARDS, LEAVE_CASTLE].map((c) => [c.id, c])) };
const R = loadRegistry(DB);

const ZARDI = '龍風混成 ザーディクリカ'; // W・ブレイカー・EXライフ
const SMALL = 'T小型'; // 攻撃役(ブレイカーなし = 1枚)
/** 裏向きのシールド n 枚(中身はなんでもよい) */
const plain = (n: number) => Array.from({ length: n }, () => SMALL);

/** シールドゾーンの、名前のカードを表向きにする */
function faceUp(sim: Sim, p: 0 | 1, name: string) {
  for (const u of sim.s.players[p].shield) if (R.defs[sim.s.cards[u].defId].name === name) sim.s.cards[u].up = true;
}

const answerUids = (sim: Sim) => {
  const a = chooseShieldPick(sim.s, sim.legal(), R);
  return a.type === 'ANSWER' ? (a.value as number[]) : [];
};

describe('割るシールドの選択(表向きのシールド)', () => {
  it('表向きのシールドは、裏向きのシールドとは別の組になる(同じ札はまとまる)', () => {
    const sim = new Sim({ p0: { battle: [{ c: SMALL, sick: false }] }, p1: { shield: ['T城', 'T城', 'T城・離', ...plain(3)] } }, R);
    faceUp(sim, 1, 'T城');
    faceUp(sim, 1, 'T城・離');
    const sh = sim.s.players[1].shield;
    expect(shieldClasses(sim.s, sh).map((g) => g.length).sort()).toEqual([1, 2, 3]);
    // 1枚を割る: 裏向き / T城 / T城・離 の3通り
    expect(shieldPickChoices(sim.s, sh, 1)).toHaveLength(3);
  });

  it('表向きのシールドがあり、全部は割れない時は、攻撃側に質問する', () => {
    const sim = new Sim({ p0: { battle: [{ c: SMALL, sick: false }] }, p1: { shield: ['T城', ...plain(4)] } }, R);
    faceUp(sim, 1, 'T城');
    sim.attack(SMALL, 'player');
    expect(sim.pending.why).toBe('pickShield');
    expect(sim.pending.player).toBe(0);
  });

  it('CPU は、表向きのシールド(G城)を先に割る(手札に加わらず、相手の手札が増えない)', () => {
    const sim = new Sim({ p0: { battle: [{ c: SMALL, sick: false }] }, p1: { shield: ['T城', ...plain(4)], hand: [] } }, R);
    faceUp(sim, 1, 'T城');
    sim.attack(SMALL, 'player');
    const castle = sim.uid(1, 'shield', 'T城');
    expect(answerUids(sim)).toEqual([castle]);
    sim.answer([castle]);
    sim.drain();
    expect(sim.count(1, 'hand')).toBe(0);
    expect(sim.has(1, 'grave', 'T城')).toBe(true);
    expect(sim.count(1, 'shield')).toBe(4);
  });

  it('割る枚数が複数でも、表向きのシールドを含めて選ぶ(残りは裏向き)', () => {
    const W = '終末縫合王 ザ=キラー・キーナリー'; // T・ブレイカー
    const sim = new Sim({ p0: { battle: [{ c: W, sick: false }] }, p1: { shield: ['T城', ...plain(5)] } }, R);
    faceUp(sim, 1, 'T城');
    sim.attack(W, 'player');
    const castle = sim.uid(1, 'shield', 'T城');
    const ans = answerUids(sim);
    expect(ans).toHaveLength(3);
    expect(ans).toContain(castle);
  });

  it('表向きのシールドは、相手の召喚以外の出現を止める能力を持つので、持たない城より優先する', () => {
    const sim = new Sim({ p0: { battle: [{ c: SMALL, sick: false }] }, p1: { shield: ['T城', 'T城・離', ...plain(3)] } }, R);
    faceUp(sim, 1, 'T城');
    faceUp(sim, 1, 'T城・離');
    const t = sim.uid(1, 'shield', 'T城');
    const l = sim.uid(1, 'shield', 'T城・離');
    expect(shieldBreakScore(sim.s, R, 1, t)).toBeGreaterThan(shieldBreakScore(sim.s, R, 1, l));
  });

  it('離れる時に誘発する能力を持つ城は、割ると持ち主が得をするので、点が引かれる(能力のない裏向きと同じ 0 点)', () => {
    const sim = new Sim({ p0: { battle: [{ c: SMALL, sick: false }] }, p1: { shield: ['T城・離', ...plain(3)] } }, R);
    faceUp(sim, 1, 'T城・離');
    const l = sim.uid(1, 'shield', 'T城・離');
    const flat = sim.s.players[1].shield.find((u) => !sim.s.cards[u].up)!;
    expect(shieldBreakScore(sim.s, R, 1, l)).toBe(0);
    expect(shieldBreakScore(sim.s, R, 1, flat)).toBe(0);
  });

  it('表向きのシールドと EXライフが両方ある時は、表向きを先に割る', () => {
    const sim = new Sim({ p0: { battle: [{ c: SMALL, sick: false }] }, p1: { battle: [{ c: ZARDI, ex: true }], shield: ['T城', ...plain(3)] } }, R);
    faceUp(sim, 1, 'T城');
    sim.attack(SMALL, 'player');
    expect(answerUids(sim)).toEqual([sim.uid(1, 'shield', 'T城')]);
  });

  it('見分けのつかない裏向きのシールドだけなら、質問しない(従来どおり無作為)', () => {
    const sim = new Sim({ p0: { battle: [{ c: SMALL, sick: false }] }, p1: { shield: 5 } }, R);
    sim.attack(SMALL, 'player');
    expect(sim.s.pending?.why).not.toBe('pickShield');
  });
});
