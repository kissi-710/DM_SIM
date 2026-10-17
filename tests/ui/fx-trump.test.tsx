// @vitest-environment jsdom
// 切り札の演出(革命チェンジ・侵略・進化)と、選ばれない・攻撃されない状態(ジャストダイバー)の表示。実際のエンジンのイベントで確かめる
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CardView } from '../../src/ui/CardView';
import { CardDetail } from '../../src/ui/GameView';
import { attackFxOf, cuesOf, FX_MS, removalsOf } from '../../src/ui/fx';
import { untilLabel, wardOf } from '../../src/ui/format';
import { mana, Sim } from '../scenario';

afterEach(cleanup);

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const D = 'ロスト・Re:ソウル';

describe('革命チェンジの演出', () => {
  const run = () => {
    const sim = new Sim({
      p0: { hand: ['轟く革命 レッドギラゾーン'], battle: [{ c: '天災 デドダム', sick: false }] },
      p1: { shield: 5 },
    });
    sim.attack('天災 デドダム', 'player');
    sim.yes();
    return sim;
  };
  it('「革命チェンジ!」のバナーに、入れ替わりの名前(A → B)が入る。自分の分も出す', () => {
    const sim = run();
    const cues = cuesOf(sim.s, sim.events, 0).filter((c) => c.kind === 'revolution');
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ title: '革命チェンジ!', sub: '天災 デドダム → 轟く革命 レッドギラゾーン', side: 'me', ms: FX_MS.revolution });
    // 観戦でも出る
    expect(cuesOf(sim.s, sim.events, null).some((c) => c.kind === 'revolution' && c.side === 'p0')).toBe(true);
  });
  it('入れ替わりで手札に戻るクリーチャーはゴースト(手札に戻る)の対象になり、出てきた札の位置には金色の着弾が出る', () => {
    const sim = run();
    expect(removalsOf(sim.events).some((r) => r.label === '手札に戻る' && r.to === 'hand')).toBe(true);
    const burst = attackFxOf(sim.events).find((f) => f.kind === 'burst' && f.tone === 'trump');
    expect(burst).toMatchObject({ cur: true, delay: 0 });
    // 位置は出てきたレッドギラゾーン(今のバトルゾーンにいる札)
    const top = sim.s.players[0].battle[0].cards[0];
    expect(burst && burst.kind === 'burst' && burst.at).toBe(`uid:${top}`);
  });
});

describe('侵略の演出', () => {
  const run = () => {
    const sim = new Sim({
      p0: { battle: [{ c: '天災 デドダム', sick: false }], hand: ['SSS級天災 デッドダムド'] },
      p1: { battle: ['ヨビニオン・マルル'], shield: 5 },
    });
    sim.attack('天災 デドダム', 'player');
    sim.yes();
    return sim;
  };
  it('「侵略!」のバナーに、攻撃中のクリーチャーの上に重なる名前が入る。1回だけ出る', () => {
    const sim = run();
    const cues = cuesOf(sim.s, sim.events, 0).filter((c) => c.kind === 'invade');
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ title: '侵略!', side: 'me', ms: FX_MS.invade });
    expect(cues[0].sub).toContain('SSS級天災 デッドダムド');
    expect(cues[0].sub).toContain('天災 デドダム');
    // 進化の「進化!」は、侵略では重ねて出さない
    expect(cuesOf(sim.s, sim.events, 0).some((c) => c.kind === 'evolve')).toBe(false);
    expect(attackFxOf(sim.events).some((f) => f.kind === 'burst' && f.tone === 'trump')).toBe(true);
  });
  it('通常の進化は「進化!」(相手の分だけ。自分の分は本人が分かっているので出さない)', () => {
    const sim = new Sim({
      p0: { hand: ['SSS級天災 デッドダムド'], mana: [W, W, W, D, D, N, N, N], battle: ['天災 デドダム'] },
      p1: { battle: ['ヨビニオン・マルル'] },
    });
    sim.play('SSS級天災 デッドダムド', { extra: { onto: sim.pid(0, '天災 デドダム') } });
    expect(cuesOf(sim.s, sim.events, 0).some((c) => c.kind === 'evolve')).toBe(false);
    expect(cuesOf(sim.s, sim.events, 1).filter((c) => c.kind === 'evolve')).toHaveLength(1);
    expect(cuesOf(sim.s, sim.events, null).filter((c) => c.kind === 'evolve')).toHaveLength(1);
  });
});

describe('選ばれない・攻撃されない状態(ジャストダイバー)の表示', () => {
  const jd = () => {
    const sim = new Sim({ p0: { hand: ['魔誕の斬将オルゲイト'], mana: [W, W, W, D, D, N, N, ...mana(3)] } });
    sim.play('魔誕の斬将オルゲイト');
    sim.drain();
    return sim;
  };

  it('ジャストダイバーで出たクリーチャーは、選ばれず攻撃されない状態として分かる', () => {
    const sim = jd();
    const pm = sim.s.players[0].battle.find((p) => sim.s.cards[p.cards[0]].defId.includes('rp4-S02'))!;
    const w = wardOf(sim.s, pm.pid);
    expect(w).toMatchObject({ chosen: true, attacked: true, label: '選ばれない・攻撃されない', until: untilLabel({ kind: 'untilTurnStart', player: 0, afterTurn: 1 }) });
    expect(w!.until).toBe('持ち主の次のターンまで');
  });
  it('札に🛡の印と光る縁が付き、読み上げ・ツールチップにも出る。状態のないクリーチャーには出ない', () => {
    const sim = jd();
    const pm = sim.s.players[0].battle.find((p) => sim.s.cards[p.cards[0]].defId.includes('rp4-S02'))!;
    const { container } = render(<CardView s={sim.s} uid={pm.cards[0]} />);
    const card = container.querySelector('.card')!;
    expect(card.classList.contains('ward')).toBe(true);
    expect(container.querySelector('.ward-tag')!.textContent!.trim()).toBe('🛡'); // 文字は付けない(詳細はツールチップ・詳細欄)
    expect(card.getAttribute('aria-label')).toContain('選ばれない・攻撃されない');
    expect(card.getAttribute('title')).toContain('選ばれない・攻撃されない(持ち主の次のターンまで)');
    expect(card.textContent).toContain('JD');

    const plain = new Sim({ p0: { battle: ['天災 デドダム'] } });
    const u = plain.s.players[0].battle[0].cards[0];
    const r2 = render(<CardView s={plain.s} uid={u} />);
    expect(r2.container.querySelector('.card.ward')).toBeNull();
    expect(r2.container.querySelector('.ward-tag')).toBeNull();
  });
  it('カードの詳細に、いつまでかを書く', () => {
    const sim = jd();
    const pm = sim.s.players[0].battle.find((p) => sim.s.cards[p.cards[0]].defId.includes('rp4-S02'))!;
    const { container } = render(<CardDetail s={sim.s} uid={pm.cards[0]} />);
    expect(container.textContent).toContain('選ばれない(持ち主の次のターンまで)');
    expect(container.textContent).toContain('攻撃されない(持ち主の次のターンまで)');
  });
});
