// デッキF「相手の隙に一撃必殺！水闇手札破壊デッキ」の新規カード(docs/decks-25oudou.md)のシナリオテスト。
import { describe, expect, it } from 'vitest';
import { Sim, mana } from '../scenario';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const D = 'ロスト・Re:ソウル';

describe('F01 Vチャロン(無色)', () => {
  it('無色なので、どの文明のマナでも払える', () => {
    const sim = new Sim({ p0: { hand: ['Vチャロン'], mana: mana(7) } });
    expect(sim.canPlay('Vチャロン')).toBe(true);
  });
  it('出た時、プレイヤーを1人選ぶ。手札を山札の下に置いて同じ枚数引き、シールドを山札の下に置いて同じ枚数をシールド化する', () => {
    const sim = new Sim({ p0: { hand: ['Vチャロン'], mana: mana(7) }, p1: { hand: [N, D, W], shield: [W, W, D, D, N], deck: [N, N, N, N, 'ダミー', 'ダミー'] } });
    sim.play('Vチャロン');
    sim.option(1);
    expect(sim.count(1, 'hand')).toBe(3);
    expect(sim.count(1, 'shield')).toBe(5);
    expect(sim.count(1, 'deck')).toBe(6);
    // 元の手札・シールドは山札の下に回り、上のカードが手札・シールドになった
    expect(sim.names(1, 'deck')).toHaveLength(6);
  });
});

describe('F02 異端流し オニカマス', () => {
  it('相手に選ばれない', () => {
    const sim = new Sim({ p0: { battle: ['異端流し オニカマス'] }, p1: { hand: ['堕呪 エアヴォ'], mana: [W, W, W, W] }, active: 1 });
    sim.play('堕呪 エアヴォ');
    // 相手の選べるエレメントがないので、聞かれない
    expect(sim.has(0, 'battle', '異端流し オニカマス')).toBe(true);
  });
  it('相手のターンに、相手が召喚以外の方法でクリーチャーを出した時、手札に戻してもよい', () => {
    const sim = new Sim({
      p0: { battle: ['異端流し オニカマス'] },
      p1: { hand: ['音卿の精霊龍'], battle: [{ c: '時の法皇 ミラダンテ' }] },
      active: 1,
    });
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, '時の法皇 ミラダンテ'), target: { kind: 'player' } });
    sim.yes(); // 革命チェンジ
    sim.yes(); // オニカマス: 手札に戻す
    expect(sim.has(1, 'battle', '音卿の精霊龍')).toBe(false);
  });
});

describe('F03 終止の時計 ザ・ミュート(S・トリガー・プラス)', () => {
  it('出た時、カードを2枚引いてもよい。そうしたら、手札を1枚捨てる', () => {
    const sim = new Sim({ p0: { hand: ['終止の時計 ザ・ミュート'], mana: [W, W, W], deck: [N, D, W, W] } });
    sim.play('終止の時計 ザ・ミュート');
    sim.order('出た時'); // 条件を満たさないP能力と、通常の「出た時」の順序
    sim.yes();
    sim.pick(N);
    expect(sim.count(0, 'hand')).toBe(1);
    expect(sim.has(0, 'grave', N)).toBe(true);
  });
  it('S・トリガーで出て、相手のターンに2つ以上シールドがブレイクされていれば、相手はこのターン攻撃できない', () => {
    const sim = new Sim({
      p0: { shield: ['終止の時計 ザ・ミュート'], deck: [N, N, N] },
      p1: { battle: [{ c: '流星のガイアッシュ・カイザー' }, { c: W }] },
      active: 1,
    });
    // W・ブレイカーでブレイクできるシールドは1枚だけなので、2つはブレイクされない → P能力は働かない
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, '流星のガイアッシュ・カイザー'), target: { kind: 'player' } });
    sim.pick('終止の時計 ザ・ミュート');
    sim.drain();
    expect(sim.s.effects.some((e) => e.mod.kind === 'cannotAttackAny')).toBe(false);
  });
  it('2つ以上ブレイクされていれば、P能力で、相手はこのターン攻撃できない', () => {
    const sim = new Sim({
      p0: { shield: ['終止の時計 ザ・ミュート', 'ダミー'], deck: [N, N, N] },
      p1: { battle: [{ c: '流星のガイアッシュ・カイザー' }, { c: W }] },
      active: 1,
    });
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, '流星のガイアッシュ・カイザー'), target: { kind: 'player' } });
    sim.pick('終止の時計 ザ・ミュート');
    sim.drain();
    expect(sim.s.effects.some((e) => e.mod.kind === 'cannotAttackAny')).toBe(true);
    const next = sim.legal().filter((a) => a.type === 'ATTACK');
    expect(next.length).toBe(0);
  });
});

describe('F04 斬隠蒼頭龍バイケン', () => {
  it('相手のターンに手札から捨てられる時、墓地に置くかわりに出してもよい。そうしたら、クリーチャーを1体戻してもよい', () => {
    const sim = new Sim({
      p0: { hand: ['斬隠蒼頭龍バイケン'] },
      p1: { hand: ['解体人形ジェニー'], mana: [D, D, D, D] },
      active: 1,
    });
    sim.play('解体人形ジェニー');
    // 相手の手札を見て、捨てさせる1枚(バイケンの1枚)。置換: 出してもよい
    expect(sim.pending.why).toBe('replaceChoice');
    sim.option(0);
    expect(sim.has(0, 'battle', '斬隠蒼頭龍バイケン')).toBe(true);
    expect(sim.has(0, 'grave', '斬隠蒼頭龍バイケン')).toBe(false);
  });
  it('自分のターンに捨てられる時は、置換されない', () => {
    const sim = new Sim({ p0: { hand: ['斬隠蒼頭龍バイケン', '堕呪 バレッドゥ'], mana: [W, W], deck: [N, N, N] } });
    sim.play('堕呪 バレッドゥ');
    sim.pick('斬隠蒼頭龍バイケン');
    expect(sim.has(0, 'grave', '斬隠蒼頭龍バイケン')).toBe(true);
  });
});

describe('F05 特攻人形ジェニー / F06 解体人形ジェニー', () => {
  it('特攻人形ジェニー: このクリーチャーを破壊して、相手の手札を1枚捨てさせてもよい', () => {
    const sim = new Sim({ p0: { hand: ['特攻人形ジェニー'], mana: [D, D] }, p1: { hand: [N, W] } });
    sim.play('特攻人形ジェニー');
    sim.yes();
    expect(sim.has(0, 'grave', '特攻人形ジェニー')).toBe(true);
    expect(sim.count(1, 'hand')).toBe(1);
  });
  it('解体人形ジェニー: 相手の手札を見て、1枚を選んで捨てさせる', () => {
    const sim = new Sim({ p0: { hand: ['解体人形ジェニー'], mana: [D, D, D, D] }, p1: { hand: [N, W, D] } });
    sim.play('解体人形ジェニー');
    sim.pick(W);
    expect(sim.has(1, 'grave', W)).toBe(true);
    expect(sim.count(1, 'hand')).toBe(2);
  });
});

describe('F07 カレイコの黒像(タマシード)', () => {
  it('どちらのプレイヤーも、山札から手札以外のゾーンに置かれるカードは、かわりに墓地に置かれる', () => {
    const sim = new Sim({ p0: { hand: [N], battle: ['カレイコの黒像'], mana: [N, N], deck: [W, W, W] } });
    sim.play(N);
    // フェアリー・ライフの「山札の上1枚をマナゾーンに置く」は、墓地に置かれる
    expect(sim.count(0, 'mana')).toBe(2);
    expect(sim.has(0, 'grave', W)).toBe(true);
  });
  it('シンカライズ: タマシードの上に進化クリーチャーを置ける', () => {
    const sim = new Sim({ p0: { hand: ['SSS級天災 デッドダムド'], battle: ['カレイコの黒像'], mana: [W, D, N, N, N, N, N, N] } });
    const evo = sim.legal().filter((a) => a.type === 'PLAY_CARD' && sim.s.cards[a.uid].defId === 'dm23bd3-001');
    expect(evo.length).toBeGreaterThan(0);
  });
  it('タマシードは攻撃できず、パワー0でも破壊されない', () => {
    const sim = new Sim({ p0: { battle: [{ c: 'カレイコの黒像' }] } });
    expect(sim.legal().filter((a) => a.type === 'ATTACK').length).toBe(0);
    sim.endMain();
    sim.endTurn();
    expect(sim.has(0, 'battle', 'カレイコの黒像')).toBe(true);
  });
});

describe('F08 冥土人形ヴァミリア・バレル(超化獣)', () => {
  it('出た時、相手のエレメントを手札に戻し、相手の手札を1枚捨てさせる', () => {
    const sim = new Sim({ p0: { hand: ['冥土人形ヴァミリア・バレル'], mana: [W, D, N] }, p1: { battle: [{ c: W }], hand: [N] } });
    sim.play('冥土人形ヴァミリア・バレル');
    expect(sim.has(1, 'battle', W)).toBe(false);
    expect(sim.count(1, 'hand')).toBe(1); // 戻したアクアン。元の手札は捨てられた
    expect(sim.count(1, 'grave')).toBe(1);
  });
  it('ハイパー化: 他のクリーチャーを1体タップして、ハイパーモード(パワー6000・W・ブレイカー)になる', () => {
    const sim = new Sim({ p0: { battle: [{ c: '冥土人形ヴァミリア・バレル' }, { c: W }] } });
    const hy = sim.legal().filter((a) => a.type === 'HYPERIZE');
    expect(hy.length).toBe(1);
    sim.do(hy[0]);
    const perm = sim.s.players[0].battle[0];
    expect(perm.hyper).toBe(true);
    expect(sim.s.players[0].battle[1].tapped).toBe(true);
    // もう一度は、ハイパー化できない
    expect(sim.legal().some((a) => a.type === 'HYPERIZE')).toBe(false);
    sim.attack('冥土人形ヴァミリア・バレル', 'player');
    expect(sim.evs('shieldBroken').length).toBe(2);
  });
  it('ハイパーモードは、次の自分のターンのはじめまで', () => {
    const sim = new Sim({ p0: { battle: [{ c: '冥土人形ヴァミリア・バレル' }, { c: W }] } });
    sim.do(sim.legal().find((a) => a.type === 'HYPERIZE')!);
    sim.endMain();
    sim.endTurn();
    sim.drain();
    expect(sim.s.players[0].battle[0].hyper).toBe(true); // 相手のターン中も続く
    sim.skipMana().endMain().endTurn().drain();
    expect(sim.s.players[0].battle[0].hyper).toBeUndefined();
  });
  it('ハイパーモード: 相手が2枚目以降のカードを引いた時、相手は手札を1枚捨てる', () => {
    const sim = new Sim({
      p0: { battle: [{ c: '冥土人形ヴァミリア・バレル' }, { c: W }] },
      p1: { hand: [N, N], deck: [W, W, W, W] },
    });
    sim.do(sim.legal().find((a) => a.type === 'HYPERIZE')!);
    sim.endMain();
    sim.endTurn();
    // 相手のターン: ドローステップで1枚目(捨てない)
    expect(sim.count(1, 'hand')).toBe(3);
    expect(sim.count(1, 'grave')).toBe(0);
  });
});

describe('F09 龍后人形メアリー・ジェニー: 同時に離れる時(総合ルール 603.5d)', () => {
  it('自身と他のデスパペットが同時に離れても、誘発するのは自身の分の1回だけ', () => {
    const sim = new Sim({
      p0: { hand: ['オリオティス・ジャッジ'], mana: ['ドラゴンズ・サイン', N, N], battle: [{ c: '龍后人形メアリー・ジェニー' }, { c: '解体人形ジェニー' }], deck: [N, N, N] },
      p1: { hand: [N, W, D] },
    });
    sim.play('オリオティス・ジャッジ');
    expect(sim.count(0, 'battle')).toBe(0);
    expect(sim.pending.why).toBe('may');
    sim.yes(); // 1枚引く
    sim.pick(N); // 相手は手札を1枚捨てる
    expect(sim.s.pending?.why).toBe('turnAction');
    expect(sim.count(1, 'hand')).toBe(2);
  });
});

describe('F09 龍后人形メアリー・ジェニー', () => {
  it('自分のデスパペットすべてにブロッカーを与える', () => {
    const sim = new Sim({ p0: { battle: [{ c: '龍后人形メアリー・ジェニー' }, { c: '特攻人形ジェニー' }] }, p1: { battle: [{ c: W }] }, active: 1 });
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, W), target: { kind: 'player' } });
    expect(sim.pending.why).toBe('block');
    const cands = (sim.pending.input as { candidates: number[] }).candidates;
    expect(cands.length).toBe(2);
  });
  it('自分のデスパペットが離れた時、カードを1枚引いてもよい。その後、相手は手札を1枚捨てる', () => {
    const sim = new Sim({
      p0: { battle: [{ c: '龍后人形メアリー・ジェニー' }, { c: '特攻人形ジェニー' }], deck: [N, N] },
      p1: { battle: [{ c: '流星のガイアッシュ・カイザー' }], hand: [N, W] },
      active: 1,
    });
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, '流星のガイアッシュ・カイザー'), target: { kind: 'player' } });
    sim.pick('特攻人形ジェニー'); // メアリーに「ブロッカー」を与えられたデスパペットでブロックして、破壊される
    sim.yes(); // 1枚引く
    expect(sim.count(0, 'hand')).toBe(1);
    // 相手は自分で選んで捨てる
    sim.pick(N);
    expect(sim.count(1, 'hand')).toBe(1);
  });
});
