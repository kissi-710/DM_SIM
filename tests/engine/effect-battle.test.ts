// 効果によるバトル(battle)・バトル時の無限パワー・踏み倒しの検出・タップして出る・召喚封じ・「パワーが自身より小さい」条件
// (革命5cザーディのカードに要る原始操作)を、テスト用のカードで固定する。
import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../../src/cards';
import { charsOf } from '../../src/engine/derive';
import { loadRegistry } from '../../src/engine/registry';
import { mkCtx } from '../../src/engine/state';
import type { CardDB } from '../../src/engine/types';
import { BATTLE_TEST_CARDS } from '../fixtures/battle-cards';
import { Sim, mana } from '../scenario';

const DB: CardDB = { ...CARD_DB, ...Object.fromEntries(BATTLE_TEST_CARDS.map((c) => [c.id, c])) };
const R = loadRegistry(DB);

describe('効果によるバトル(battle)', () => {
  it('パワーの大きい方が勝ち、小さい方は破壊される', () => {
    const sim = new Sim({ p0: { hand: ['Tバトラー'], mana: mana(1) }, p1: { battle: ['T小型'] } }, R);
    sim.play('Tバトラー');
    sim.drain();
    expect(sim.has(1, 'grave', 'T小型')).toBe(true);
    expect(sim.has(0, 'battle', 'Tバトラー')).toBe(true);
    expect(sim.evs('battleEnded')).toHaveLength(1);
  });
  it('負ければ、自分が破壊される', () => {
    const sim = new Sim({ p0: { hand: ['Tバトラー'], mana: mana(1) }, p1: { battle: ['T大型'] } }, R);
    sim.play('Tバトラー');
    sim.drain();
    expect(sim.has(0, 'grave', 'Tバトラー')).toBe(true);
    expect(sim.has(1, 'battle', 'T大型')).toBe(true);
  });
  it('同じパワーなら、両方破壊される', () => {
    // 相手の場に、同じパワー(3000)の Tバトラーを置く(場に置くだけなので、出た時は誘発しない)
    const sim = new Sim({ p0: { hand: ['Tバトラー'], mana: mana(1) }, p1: { battle: ['Tバトラー'] } }, R);
    sim.play('Tバトラー');
    sim.drain();
    expect(sim.has(0, 'grave', 'Tバトラー')).toBe(true);
    expect(sim.has(1, 'grave', 'Tバトラー')).toBe(true);
  });
  it('スレイヤーは、バトルに負けても相手を破壊する', () => {
    const sim = new Sim({ p0: { hand: ['Tバトラー'], mana: mana(1) }, p1: { battle: ['Tスレイヤー'] } }, R);
    sim.play('Tバトラー');
    sim.drain();
    expect(sim.has(1, 'grave', 'Tスレイヤー')).toBe(true);
    expect(sim.has(0, 'grave', 'Tバトラー')).toBe(true);
  });
  it('相手がいなければ、選べず何も起きない', () => {
    const sim = new Sim({ p0: { hand: ['Tバトラー'], mana: mana(1) } }, R);
    sim.play('Tバトラー');
    sim.drain();
    expect(sim.evs('battleEnded')).toHaveLength(0);
    expect(sim.has(0, 'battle', 'Tバトラー')).toBe(true);
  });
});

describe('バトル時の無限パワー(infinitePowerInBattle)', () => {
  it('攻撃のバトルで、パワーが無限として扱われる(普段のパワーは変わらない)', () => {
    const sim = new Sim({ p0: { battle: [{ c: 'T無限', sick: false }] }, p1: { battle: [{ c: 'T大型', tapped: true }] } }, R);
    const ctx = mkCtx(sim.s, R);
    expect(charsOf(ctx, sim.uid(0, 'battle', 'T無限')).power).toBe(1000);
    sim.attack('T無限', 'T大型');
    sim.drain();
    expect(sim.has(1, 'grave', 'T大型')).toBe(true);
    expect(sim.has(0, 'battle', 'T無限')).toBe(true);
  });
  it('無限どうしのバトルは引き分け(両方破壊される)', () => {
    const sim = new Sim({ p0: { battle: [{ c: 'T無限', sick: false }] }, p1: { battle: [{ c: 'T無限', tapped: true }] } }, R);
    sim.attack('T無限', 'T無限');
    sim.drain();
    expect(sim.has(0, 'grave', 'T無限')).toBe(true);
    expect(sim.has(1, 'grave', 'T無限')).toBe(true);
  });
});

describe('踏み倒しの検出(entered + paid: 0)と、出たクリーチャーとのバトル($eventCard)', () => {
  it('相手がコストを支払わずに出した時、バトルしてもよい。パワーで勝てば破壊する', () => {
    const sim = new Sim(
      {
        p0: { hand: ['ドラゴンズ・サイン', '龍風混成 ザーディクリカ'], mana: mana(5, 'ドラゴンズ・サイン') },
        p1: { battle: ['T踏み倒し監視'] },
      },
      R,
    );
    sim.play('ドラゴンズ・サイン');
    // 呪文の対象選択(自明なら質問なし)→ 相手の任意の誘発(使う)
    for (let i = 0; i < 6 && sim.s.pending && sim.s.pending.why !== 'turnAction'; i++) {
      if (sim.s.pending.player === 1) sim.use();
      else sim.drain(1);
    }
    // 9000 が 6000 に勝つ(ザーディクリカは EXライフのシールドを身代わりに、場に残る)
    const ended = sim.evs('battleEnded');
    expect(ended).toHaveLength(1);
    expect(ended[0].winnerCard).toBe(sim.uid(1, 'battle', 'T踏み倒し監視'));
    expect(sim.evs('moved').some((e) => e.cause === 'exLifeSwap')).toBe(true);
  });
  it('コストを支払って召喚した場合は誘発しない', () => {
    const sim = new Sim({ p0: { hand: ['アクアン'], mana: mana(5, 'アクアン') }, p1: { battle: ['T踏み倒し監視'] } }, R);
    sim.play('アクアン');
    sim.drain();
    expect(sim.s.pending?.why).toBe('turnAction');
    expect(sim.evs('battleEnded')).toHaveLength(0);
  });
});

describe('自分の多色クリーチャーが出た時(各ターン1回)', () => {
  it('多色のクリーチャーが出た時に誘発し、同じターンの2回目は誘発しない。単色では誘発しない', () => {
    const sim = new Sim(
      { p0: { battle: ['T多色監視'], hand: ['T二色', 'T二色', 'T小型'], mana: ['T火', 'T火', 'T火', ...mana(5)] } },
      R,
    );
    const n = () => sim.evs('resolve').filter((e) => String(e.label).includes('多色が出た')).length;
    sim.play('T小型');
    sim.drain();
    expect(n()).toBe(0);
    sim.play('T二色');
    sim.drain();
    expect(n()).toBe(1);
    sim.play('T二色');
    sim.drain();
    expect(n()).toBe(1); // 増えない
  });
});

describe('タップして出る(entersTapped)', () => {
  it('相手の、自分のマナの枚数よりコストが小さいクリーチャーはタップして出る。それ以外は影響を受けない', () => {
    const sim = new Sim(
      {
        p0: { battle: ['Tタップイン'], mana: mana(5) },
        p1: { hand: ['T小型', 'T大型'], mana: mana(8) },
        active: 1,
      },
      R,
    );
    sim.play('T小型');
    sim.play('T大型');
    const tapped = (n: string) => sim.s.players[1].battle.find((p) => sim.s.cards[p.cards[0]].defId === 'tb-' + n)!.tapped;
    expect(tapped('small')).toBe(true); // コスト1 < マナ5
    expect(tapped('big')).toBe(false); // コスト7 ≥ 5
  });
  it('持ち主の自分のクリーチャーは、タップして出ない', () => {
    const sim = new Sim({ p0: { battle: ['Tタップイン'], hand: ['T小型'], mana: mana(5) } }, R);
    sim.play('T小型');
    expect(sim.s.players[0].battle.find((p) => sim.s.cards[p.cards[0]].defId === 'tb-small')!.tapped).toBe(false);
  });
});

describe('召喚封じ(cannotSummon / 次の、相手のターンの終わりまで)', () => {
  it('次の相手のターンの終わりまで、コストが上限以下のクリーチャーを召喚できず、その後は解ける', () => {
    const sim = new Sim({ p0: { hand: ['T召喚封じ'], mana: mana(1) }, p1: { hand: ['アクアン', 'T中型'], mana: mana(10) } }, R);
    sim.play('T召喚封じ');
    sim.drain();
    expect(sim.s.effects).toHaveLength(1);
    sim.endTurn();
    sim.skipMana();
    expect(sim.canPlay('アクアン')).toBe(false); // コスト4 ≤ 4
    expect(sim.canPlay('T中型')).toBe(true); // コスト5
    sim.endTurn();
    expect(sim.s.effects).toHaveLength(0);
  });
});

describe('「パワーが自身より小さい」(powerLtSelf)', () => {
  it('自身よりパワーが小さいクリーチャーを、持ち主のマナゾーンに置く(自身と大きいものは残る)', () => {
    const sim = new Sim(
      {
        p0: { hand: ['T一掃'], battle: ['T小型'], mana: mana(1) },
        p1: { battle: ['T大型', 'T中型', 'T小型'] },
      },
      R,
    );
    sim.play('T一掃');
    sim.drain();
    expect(sim.names(1, 'battle')).toEqual(['T大型']);
    expect(sim.count(1, 'mana', 'T中型')).toBe(1);
    expect(sim.count(1, 'mana', 'T小型')).toBe(1);
    expect(sim.count(0, 'mana', 'T小型')).toBe(1);
    expect(sim.names(0, 'battle')).toEqual(['T一掃']);
  });
});
