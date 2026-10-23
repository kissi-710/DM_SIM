// カード効果の再監査(docs/card-audit.md M13-24)で見つけた、既存のカード(A・B・インターステラなど)の誤りを固定するテスト。
import { describe, expect, it } from 'vitest';
import { battlePower, charsOf, costOf, powerOf } from '../../src/engine/derive';
import { mkCtx } from '../../src/engine/state';
import { Sim, mana, reg } from '../scenario';

const N = 'フェアリー・ライフ';
const W = 'アクアン';

describe('王道の革命 ドギラゴン: 革命0 は「バトル中」だけパワー+10000', () => {
  it('シールドが0なら、バトルの時のパワーは+10000。ふだんのパワーは変わらない', () => {
    const sim = new Sim({ p0: { battle: [{ c: '王道の革命 ドギラゴン' }], shield: 0 } });
    const perm = sim.s.players[0].battle[0];
    const c = mkCtx(sim.s, reg);
    expect(powerOf(c, perm)).toBe(5000);
    expect(battlePower(c, perm)).toBe(15000);
  });
  it('シールドがあれば、バトルの時も 5000', () => {
    const sim = new Sim({ p0: { battle: [{ c: '王道の革命 ドギラゴン' }], shield: 3 } });
    const perm = sim.s.players[0].battle[0];
    expect(battlePower(mkCtx(sim.s, reg), perm)).toBe(5000);
  });
});

describe('九番龍 ジゴクバンカー: シンパシーのコストは0以下にならない', () => {
  it('マナが多くても、コストは1(0にはならない)。マナが0枚なら軽減されず12', () => {
    const many = new Sim({ p0: { hand: ['九番龍 ジゴクバンカー Par459'], mana: mana(14, N) } });
    expect(costOf(mkCtx(many.s, reg), many.uid(0, 'hand', '九番龍 ジゴクバンカー Par459'), 0)).toBe(1);
    const none = new Sim({ p0: { hand: ['九番龍 ジゴクバンカー Par459'], mana: [] } });
    expect(costOf(mkCtx(none.s, reg), none.uid(0, 'hand', '九番龍 ジゴクバンカー Par459'), 0)).toBe(12);
  });
});

describe('SSS級天災 デッドダムド: 墓地に置くのは破壊ではない', () => {
  it('重なった時、「墓地に置く」を選ぶと、相手のクリーチャーは墓地に置かれる(cause が destroy ではない)', () => {
    const sim = new Sim({
      p0: { battle: [{ c: '天災 デドダム' }], hand: ['SSS級天災 デッドダムド'], mana: mana(8, W) },
      p1: { battle: [{ c: W }] },
    });
    sim.attack('天災 デドダム', 'player');
    sim.yes(); // 侵略
    sim.option(0); // 墓地に置く
    sim.drain();
    expect(sim.has(1, 'grave', W)).toBe(true);
    expect(sim.evs('moved').some((e) => e.cause === 'destroy' && sim.s.cards[e.card].owner === 1)).toBe(false);
  });
});

describe('V頂神話 カツムゲン: 山札で表向きになっている間、パワーは∞', () => {
  it('山札にある時のパワーは∞(「パワー〇〇以下」を満たさない)。手札では 13000', () => {
    const sim = new Sim({ p0: { hand: ['V頂神話 カツムゲン'], deck: ['V頂神話 カツムゲン', N] } });
    const c = mkCtx(sim.s, reg);
    expect(charsOf(c, sim.uid(0, 'deck', 'V頂神話 カツムゲン')).power).toBeGreaterThan(900000000);
    expect(charsOf(c, sim.uid(0, 'hand', 'V頂神話 カツムゲン')).power).toBe(13000);
  });
});
