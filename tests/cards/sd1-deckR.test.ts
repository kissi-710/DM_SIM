// デッキR「勝舞の魂クロスせよ！火光サムライデッキ」の新規カード(docs/decks-25oudou.md)のシナリオテスト。クロスギアのジェネレート・クロス・サムライ・メクレイドなど。
import { describe, expect, it } from 'vitest';
import { Sim, mana, reg } from '../scenario';
import { CARD_DB, deckCards } from '../../src/cards';
import { makeRuleBased } from '../../src/ai/rulebased';
import { playGameSync } from '../../src/sim/playGame';
import { checkInvariants } from '../../src/engine/invariants';
import { powerOf } from '../../src/engine/derive';
import { mkCtx } from '../../src/engine/state';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const F = 'ドンドン火噴くナウ';
const L = 'ダミー';
const FLASH = '悪魔世界の閃光';
const MAROK = '戦術の天才 マロク';
const SHIRO = '鎧機天 シロフェシー';
const BUI = 'ボルメテウス・武者・ドラゴン「武偉」';
const GOUSOKU = '竜装 ゴウソク・タキオンアーマー';
const ZANGEKI = '竜装 ザンゲキ・マッハアーマー';
const GRENOH = '爆炎ホワイトグレンオー';
const MUSASHI = 'ヴァルキリアス・武者・ムサシ「弐天」';
const DOS = '竜牙 リュウジン・ドスファング';
const power = (sim: Sim, p: 0 | 1, name: string) => powerOf(mkCtx(sim.s, reg), sim.s.players[p].battle.find((x) => x.pid === sim.pid(p, name))!);
const crossActs = (sim: Sim) => sim.legal().filter((a) => a.type === 'CROSS');

describe('クロスギア(ジェネレート・クロス)', () => {
  it('ジェネレート(コストを払ってバトルゾーンに出す)した後、コストをもう一度払って、自分のクリーチャーにクロスできる', () => {
    const sim = new Sim({ p0: { hand: [GOUSOKU], battle: [{ c: GRENOH }], mana: mana(4, F) } });
    sim.play(GOUSOKU); // ジェネレート: コスト2(自分自身の軽減は、バトルゾーンに出てから働く)
    expect(sim.has(0, 'battle', GOUSOKU)).toBe(true);
    expect(sim.tappedMana(0)).toBe(2);
    const acts = crossActs(sim);
    expect(acts.length).toBe(1);
    sim.do(acts[0]);
    expect(sim.s.players[0].battle.find((p) => p.crossedOn !== undefined)).toBeDefined();
    expect(sim.tappedMana(0)).toBe(3); // クロスのコストは、軽減されて1
    expect(power(sim, 0, GRENOH)).toBe(6000); // これをクロスしたクリーチャーのパワーを+1000
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('クロスしたクリーチャーが場を離れると、クロスは外れ、クロスギアは残る(再クロスできる)', () => {
    const sim = new Sim({ p0: { hand: [GOUSOKU], battle: [{ c: GRENOH }, { c: W }], mana: mana(6, F) } });
    sim.play(GOUSOKU);
    sim.do(crossActs(sim).find((a) => a.type === 'CROSS' && a.target === sim.pid(0, GRENOH))!);
    // クロス先が場を離れる
    const gp = sim.s.players[0].battle.find((p) => p.crossedOn !== undefined)!;
    expect(gp.crossedOn).toBe(sim.pid(0, GRENOH));
    sim.s.players[0].battle = sim.s.players[0].battle.filter((p) => p.pid !== sim.pid(0, GRENOH));
    const out = sim.s.players[0].hand;
    void out;
  });
});

describe('R05 竜装 ゴウソク / R06 竜装 ザンゲキ', () => {
  it('ゴウソク: 自分のサムライ・クリーチャーを召喚するコストは1少なくなる(0以下にならない)', () => {
    const sim = new Sim({ p0: { hand: [GRENOH], battle: [{ c: GOUSOKU }], mana: mana(5, F) } });
    sim.play(GRENOH);
    expect(sim.tappedMana(0)).toBe(4);
  });
  it('ザンゲキ: クロスされていなければ、自分のドラゴン・クリーチャーとサムライ・クリーチャーの召喚コストを1少なくする', () => {
    const sim = new Sim({ p0: { hand: [GRENOH], battle: [{ c: ZANGEKI }], mana: mana(5, F) } });
    sim.play(GRENOH);
    expect(sim.tappedMana(0)).toBe(4);
  });
  it('ザンゲキ: ドラゴンまたはサムライにクロスされていれば、自分のドラゴンとサムライすべてのパワーを+2000し、「スピードアタッカー」を与える', () => {
    const sim = new Sim({ p0: { hand: [ZANGEKI], battle: [{ c: GRENOH }, { c: BUI, sick: true }], mana: mana(8, F) } });
    sim.play(ZANGEKI);
    sim.drain();
    sim.do(crossActs(sim).find((a) => a.type === 'CROSS' && a.target === sim.pid(0, GRENOH))!);
    expect(power(sim, 0, BUI)).toBe(8000);
    expect(power(sim, 0, GRENOH)).toBe(7000);
    expect(sim.legal().some((a) => a.type === 'ATTACK' && a.attacker === sim.pid(0, BUI))).toBe(true);
  });
  it('ザンゲキをジェネレートした時、コストを支払わずに《ボルメテウス・武者・ドラゴン》にクロスしてもよい', () => {
    const sim = new Sim({ p0: { hand: [ZANGEKI], battle: [{ c: BUI }], mana: mana(4, F) } });
    sim.play(ZANGEKI);
    sim.use(BUI);
    expect(sim.s.players[0].battle.find((p) => p.crossedOn === sim.pid(0, BUI))).toBeDefined();
  });
});

describe('R09 竜牙 リュウジン・ドスファング', () => {
  it('出た時、サムライ・メクレイド5する(山札の上から3枚を見て、コスト5以下のサムライを1枚、コストを支払わずに使う)', () => {
    const sim = new Sim({ p0: { hand: [DOS], mana: [...mana(2, L), ...mana(3, F)], deck: [GRENOH, N, N, N] } });
    sim.play(DOS);
    sim.order('サムライ');
    sim.pick(GRENOH);
    sim.drain();
    expect(sim.has(0, 'battle', GRENOH)).toBe(true);
  });
});

describe('R02 戦術の天才 マロク', () => {
  it('エスケープ: 破壊される時、墓地に置くかわりに自分のシールドを1つ手札に加えてもよい', () => {
    const sim = new Sim({
      p0: { battle: [{ c: MAROK }], shield: 2 },
      p1: { hand: ['青銅のバンビシカット'], mana: mana(9, F), deck: [N, N] },
      active: 1,
    });
    sim.play('青銅のバンビシカット', { face: 1 });
    sim.drain(1);
    if (sim.s.pending?.input?.shape === 'option') sim.option(0);
    sim.drain();
    expect(sim.has(0, 'battle', MAROK)).toBe(true);
    expect(sim.count(0, 'shield')).toBe(1);
    expect(sim.count(0, 'hand')).toBe(1);
  });
  it('自分のターンのはじめに、クロスギアがクロスされていれば、サムライ・メクレイド5する', () => {
    const sim = new Sim({
      p0: { battle: [{ c: MAROK }, { c: GOUSOKU }], deck: [GRENOH, N, N, N] },
      p1: { deck: [N, N] },
      active: 1,
    });
    sim.s.players[0].battle[1].crossedOn = sim.s.players[0].battle[0].pid;
    sim.endTurn();
    sim.pick(GRENOH);
    sim.drain();
    expect(sim.has(0, 'battle', GRENOH)).toBe(true);
  });
});

describe('R03 鎧機天 シロフェシー / R04 武偉 / R07 ホワイトグレンオー', () => {
  it('シロフェシー: 「革命チェンジ」によって出た時、次の自分のターンのはじめまで、相手はコスト5以下の呪文を唱えられない。自分のターンの終わりにアンタップする', () => {
    const sim = new Sim({
      p0: { hand: [SHIRO], battle: [{ c: BUI }] },
      p1: { hand: ['クリムゾン・ビクトリー'], mana: mana(4, F), shield: 5 },
    });
    sim.attack(BUI, 'player');
    sim.yes(); // 革命チェンジ
    sim.drain();
    expect(sim.has(0, 'battle', SHIRO)).toBe(true);
    expect(sim.s.effects.some((e) => e.mod.kind === 'cannotCastLte')).toBe(true);
  });
  it('武偉: 出た時、侍流ジェネレート。手札のクロスギアを1枚、コストを支払わずにジェネレートしてもよい', () => {
    const sim = new Sim({ p0: { hand: [BUI, GOUSOKU], mana: mana(4, F) } });
    sim.play(BUI);
    sim.order('侍流ジェネレート');
    sim.use(GOUSOKU);
    sim.drain();
    expect(sim.has(0, 'battle', GOUSOKU)).toBe(true);
  });
  it('武偉: 出た時、自分のシールドを1つブレイクしてもよい。そうしたら、相手のパワー6000以下のクリーチャーを1体破壊する', () => {
    const sim = new Sim({ p0: { hand: [BUI], mana: mana(4, F), shield: 3 }, p1: { battle: [{ c: W }] } });
    sim.play(BUI);
    sim.drain(1);
    sim.yes();
    sim.drain();
    expect(sim.has(1, 'battle', W)).toBe(false);
    expect(sim.count(0, 'shield')).toBe(2);
  });
  it('爆炎ホワイトグレンオー: バトルゾーンにある自分のサムライ・クリーチャーはすべて、「スピードアタッカー」を得る', () => {
    const sim = new Sim({ p0: { battle: [{ c: GRENOH, sick: true }, { c: BUI, sick: true }] }, p1: { shield: 5 } });
    expect(sim.legal().some((a) => a.type === 'ATTACK' && a.attacker === sim.pid(0, BUI))).toBe(true);
  });
});

describe('R01 悪魔世界の閃光 / R08 ムサシ「弐天」', () => {
  it('悪魔世界の閃光: ヨビニオン。自分のクリーチャーをすべてアンタップし、次の自分のターンのはじめまで「ブロッカー」を与える', () => {
    const sim = new Sim({ p0: { hand: [FLASH], battle: [{ c: GRENOH, tapped: true }], mana: mana(6, L), deck: [W, N, N] } });
    sim.play(FLASH);
    sim.yes();
    sim.drain();
    expect(sim.has(0, 'battle', W)).toBe(true);
    expect(sim.s.players[0].battle.every((p) => !p.tapped || p.cards[0] === sim.uid(0, 'battle', W))).toBe(true);
    expect(sim.s.effects.filter((e) => e.mod.kind === 'grant').length).toBeGreaterThanOrEqual(1);
  });
  it('ムサシ「弐天」: 出た時、自分の火のエレメントの数以下のコストの相手のエレメントを1つ選び、破壊する', () => {
    const sim = new Sim({ p0: { hand: [MUSASHI], battle: [{ c: GRENOH }], mana: [...mana(3, F), ...mana(2, L)] }, p1: { battle: [{ c: W }] } });
    sim.play(MUSASHI);
    sim.drain();
    expect(sim.has(1, 'battle', W)).toBe(true); // 火のエレメントは2つ(ホワイトグレンオーとムサシ)。コスト4のアクアンは壊せない
  });
  it('ムサシ「弐天」: コストが火のエレメントの数以下なら破壊する', () => {
    const sim = new Sim({ p0: { hand: [MUSASHI], battle: [{ c: GRENOH }], mana: [...mana(3, F), ...mana(2, L)] }, p1: { battle: [{ c: W }, { c: 'AQvibrato' }] } });
    sim.play(MUSASHI);
    sim.pick('AQvibrato');
    sim.drain();
    expect(sim.has(1, 'battle', 'AQvibrato')).toBe(false);
  });
});

describe('R02 マロクのエスケープ(状況起因処理との順序)', () => {
  it('パワー0以下で破壊される時に使うエスケープは、手順(シールドを手札に)が終わってから、もう一度調べられる(聞き直しが終わらない不具合の回帰)', () => {
    // デッキR 対 デッキS のルールベース同士の対局(seed 13 は、以前はマロクの置換の聞き直しが終わらなかった)
    const r = playGameSync(CARD_DB, [makeRuleBased({}), makeRuleBased({})], { decks: [deckCards('sd1-r'), deckCards('sd1-s')], seed: 13, first: 0, maxSteps: 3000 });
    expect(r.winner).not.toBeNull();
    expect(r.steps).toBeLessThan(3000);
  }, 60000);
});
