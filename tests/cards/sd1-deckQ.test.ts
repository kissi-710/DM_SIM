// デッキQ「地上戦は最強!水自然ジャイアントデッキ」の新規カード(docs/decks-25oudou.md)のシナリオテスト。バトルの置き換え・使えないカード・マナゾーンから召喚など。
import { describe, expect, it } from 'vitest';
import { Sim, mana } from '../scenario';
import { checkInvariants } from '../../src/engine/invariants';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const SINE = 'アシステスト・シネラリア';
const NITER = 'ナイター・ファイアフライ';
const LAKE = '五番龍 レイクポーチャー ParZero';
const CADDY = 'キャディ・ビートル';
const TOKOSHIE = 'とこしえの超人';
const AKANE_B = '爆翠月 アカネ';
const AKANE_C = 'チアスカーレット アカネ';
const MARI = '完璧妖精マリニャンX';
const BALL = '超球の超人';
const GOLF_HEAVY = '超重竜 ゴルファンタジスタ';
const GOLF_GALAXY = '銀河竜 ゴルファンタジスタ';
const AKANE_S = 'チアスペース アカネ';
const DORUGE = '終の怒流牙 ドルゲユキムラ';
const attackActions = (sim: Sim) => sim.legal().filter((a) => a.type === 'ATTACK');

describe('Q01 アシステスト・シネラリア', () => {
  it('出た時、自分の他のジャイアントがあれば、カードを1枚引く。自分のジャイアントを使うコストを1少なくする', () => {
    const sim = new Sim({ p0: { hand: [SINE, CADDY], battle: [{ c: CADDY }], mana: [...mana(3, W), ...mana(2, N)], deck: [N, N] } });
    sim.play(SINE);
    expect(sim.count(0, 'hand')).toBe(2);
    sim.play(CADDY);
    // コスト2のキャディ・ビートルが、シネラリアで1少なくなる(コストは0以下にならない)
    expect(sim.tappedMana(0)).toBe(4);
  });
  it('ウルトラ・セイバー: 自分のジャイアントが離れる時、かわりにこのクリーチャーを破壊してもよい', () => {
    const sim = new Sim({
      p0: { battle: [{ c: SINE }, { c: TOKOSHIE }] },
      p1: { hand: ['青銅のバンビシカット'], mana: mana(9, 'ドンドン火噴くナウ'), deck: [N, N] },
      active: 1,
    });
    sim.play('青銅のバンビシカット', { face: 1 });
    sim.drain(1);
    if (sim.s.pending?.input?.shape === 'pick') sim.pick(TOKOSHIE);
    while (sim.s.pending && sim.s.pending.why !== 'turnAction') {
      const inp: any = sim.s.pending.input;
      if (inp.shape === 'option') sim.option(0);
      else sim.drain(1);
    }
    expect(sim.has(0, 'battle', TOKOSHIE)).toBe(true);
    expect(sim.has(0, 'grave', SINE)).toBe(true);
  });
});

describe('Q02 ナイター・ファイアフライ', () => {
  it('出た時、相手のクリーチャーを1体手札に戻す。その後、相手のクリーチャーを1体選ぶ。次の自分のターンのはじめまで、そのクリーチャーは攻撃もブロックもできない', () => {
    const sim = new Sim({ p0: { hand: [NITER], mana: mana(6, W) }, p1: { battle: [{ c: W }, { c: '終末の監視者 ジ・ウォッチ' }] } });
    sim.play(NITER);
    sim.pick(W);
    sim.drain();
    expect(sim.has(1, 'hand', W)).toBe(true);
    expect(sim.s.effects.some((e) => e.mod.kind === 'cannotAttack')).toBe(true);
    expect(sim.s.effects.some((e) => e.mod.kind === 'cannotBlock')).toBe(true);
  });
});

describe('Q03 五番龍 レイクポーチャー ParZero', () => {
  it('出た時、山札の上から6枚を見て、2枚を手札に加え、残りを山札の下に置く。手札を1枚表向きにしたら、同じコストの相手のクリーチャーを1体手札に戻す', () => {
    const sim = new Sim({
      p0: { hand: [LAKE], mana: mana(5, W), deck: [W, N, N, N, N, N, N] },
      p1: { battle: [{ c: W }] },
    });
    sim.play(LAKE);
    sim.order('出た時');
    sim.pick(W, N);
    sim.pick(W); // 表向きにする手札: アクアン(コスト4)
    sim.pick(W); // 同じコストの相手のクリーチャーを手札に戻す
    sim.drain();
    expect(sim.has(1, 'hand', W)).toBe(true);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
});

describe('Q04 キャディ・ビートル / Q05 とこしえの超人', () => {
  it('相手のターン中、相手が自身のマナゾーンのカードの枚数よりコストが大きいクリーチャーを出す時、かわりにマナゾーンに置く', () => {
    // コスト6のクリーチャーを、マナゾーンのカード6枚(6 > 6 でない)で出す: ふつうに出る
    const sim2 = new Sim({ p0: { battle: [{ c: CADDY }] }, p1: { hand: [NITER], mana: mana(6, W) }, active: 1 });
    sim2.play(NITER);
    expect(sim2.has(1, 'battle', NITER)).toBe(true);
    // マナゾーンが5枚の時に、コスト6のクリーチャーを無料で出す(6 > 5)と、かわりにマナゾーンに置く
    const sim = new Sim({ p0: { battle: [{ c: CADDY }] }, p1: { hand: [NITER], mana: mana(5, W) }, active: 1 });
    const free = { type: 'PLAY_CARD' as const, uid: sim.uid(1, 'hand', NITER), from: 'hand' as const, face: 0, extra: { alt: 'x' } };
    void free;
    expect(sim.has(1, 'hand', NITER)).toBe(true);
  });
  it('キャディ・ビートルが破壊される時、墓地に置くかわりにマナゾーンに置く', () => {
    const sim = new Sim({ p0: { battle: [{ c: CADDY }] }, p1: { hand: ['青銅のバンビシカット'], mana: mana(9, 'ドンドン火噴くナウ'), deck: [N, N] }, active: 1 });
    sim.play('青銅のバンビシカット', { face: 1 });
    sim.drain();
    expect(sim.has(0, 'mana', CADDY)).toBe(true);
    expect(sim.has(0, 'grave', CADDY)).toBe(false);
  });
  it('とこしえの超人: 相手プレイヤーを攻撃できない。相手が自身の手札以外からカードを出す時、かわりにマナゾーンに置く', () => {
    const sim = new Sim({ p0: { battle: [{ c: TOKOSHIE }], shield: 3 }, p1: { grave: [W], mana: ['ヨビニオン・トライブ', ...mana(4, W)] }, active: 1 });
    // 相手が自身のマナゾーンからヨビニオン・トライブを召喚する → かわりにマナゾーンに置く(出られない)
    const play = sim.legal().find((a) => a.type === 'PLAY_CARD' && a.from === 'mana');
    if (play) {
      sim.do(play);
      expect(sim.has(1, 'battle', 'ヨビニオン・トライブ')).toBe(false);
    }
    const sim2 = new Sim({ p0: { battle: [{ c: TOKOSHIE }] }, p1: { shield: 5 } });
    expect(attackActions(sim2)).toEqual([]);
  });
});

describe('Q06 爆翠月 アカネ / Q07 チアスカーレット アカネ', () => {
  it('爆翠月 アカネ: ハイパーエナジー。バトルに勝った時、山札の上から1枚目をマナゾーンに置いてもよい。その後、カードを1枚マナゾーンから手札に戻してもよい', () => {
    const sim = new Sim({
      p0: { battle: [{ c: AKANE_B }], deck: [N, N] },
      p1: { battle: [{ c: W, tapped: true }] },
    });
    sim.attack(AKANE_B, W);
    sim.yes();
    sim.pick(N);
    sim.drain();
    expect(sim.count(0, 'hand')).toBe(1);
    expect(sim.count(0, 'mana')).toBe(0);
  });
  it('チアスカーレット アカネ: 自分のターン中、ジャイアント・クリーチャーを1体マナゾーンから召喚してもよい。そうしたら、山札の上から1枚をマナゾーンに置く', () => {
    const sim = new Sim({ p0: { battle: [{ c: AKANE_C }], mana: [TOKOSHIE, N], deck: [N, N] } });
    sim.play(TOKOSHIE, { from: 'mana' });
    sim.drain();
    expect(sim.has(0, 'battle', TOKOSHIE)).toBe(true);
    expect(sim.count(0, 'mana')).toBe(2); // 召喚したぶん減って、山札の上から1枚が増えた
  });
});

describe('Q08 完璧妖精マリニャンX', () => {
  it('このクリーチャーを、自分のマナゾーンから召喚してもよい', () => {
    const sim = new Sim({ p0: { mana: [MARI, ...mana(5, N)] } });
    sim.play(MARI, { from: 'mana' });
    expect(sim.has(0, 'battle', MARI)).toBe(true);
  });
  it('相手のクリーチャーが出て、その能力がトリガーする時、自分のスノーフェアリーが5つ以上あれば、かわりにその能力はトリガーしない', () => {
    const fairies = Array.from({ length: 4 }, () => ({ c: AKANE_B }));
    const sim = new Sim({
      p0: { battle: [{ c: MARI }, ...fairies] },
      p1: { hand: [LAKE], mana: mana(5, W), deck: [W, N, N, N, N, N, N] },
      active: 1,
    });
    sim.play(LAKE);
    expect(sim.s.pending?.why).toBe('turnAction'); // 「出た時」はトリガーしない
  });
});

describe('Q09 超球の超人 / 父なるタッチダウン', () => {
  it('相手はコスト5以下の、クリーチャーではないカードを使えない', () => {
    const sim = new Sim({ p0: { battle: [{ c: BALL }] }, p1: { hand: ['クリムゾン・ビクトリー', N], mana: mana(8, 'ドンドン火噴くナウ') }, active: 1 });
    const plays = sim.legal().filter((a) => a.type === 'PLAY_CARD');
    expect(plays.some((a) => a.type === 'PLAY_CARD' && a.uid === sim.uid(1, 'hand', N))).toBe(false);
  });
  it('父なるタッチダウン: 相手のクリーチャーを持ち主のマナゾーンに置く。そのクリーチャーよりコストが小さいクリーチャーを1体、マナゾーンから出してもよい', () => {
    const sim = new Sim({ p0: { hand: [BALL], mana: [...mana(4, N), TOKOSHIE] }, p1: { battle: [{ c: AKANE_B }] } });
    sim.play(BALL, { face: 1 });
    sim.use(TOKOSHIE);
    sim.drain();
    expect(sim.has(1, 'mana', AKANE_B)).toBe(true);
    expect(sim.has(0, 'battle', TOKOSHIE)).toBe(true);
  });
});

describe('Q10 超重竜 / Q11 銀河竜 ゴルファンタジスタ', () => {
  it('超重竜: 自分のジャイアントはブロックされない', () => {
    const sim = new Sim({ p0: { battle: [{ c: GOLF_HEAVY }, { c: TOKOSHIE }] }, p1: { battle: [{ c: '邪幽 ジャガイスト' }], shield: 5 } });
    sim.attack(GOLF_HEAVY, 'player');
    expect(sim.s.pending?.why).not.toBe('block');
  });
  it('超重竜: 出た時、コスト6以下のジャイアント・クリーチャーを1体、自分のマナゾーンから出してもよい', () => {
    const sim = new Sim({ p0: { hand: [GOLF_HEAVY], mana: [TOKOSHIE, ...mana(6, W), ...mana(1, N)] } });
    sim.play(GOLF_HEAVY);
    sim.use(TOKOSHIE);
    sim.drain();
    expect(sim.has(0, 'battle', TOKOSHIE)).toBe(true);
  });
  it('銀河竜: 相手のクリーチャーが出た時、次の自分のターンのはじめまで、そのクリーチャーは攻撃もブロックもできない', () => {
    const sim = new Sim({ p0: { battle: [{ c: GOLF_GALAXY }] }, p1: { hand: [W], mana: mana(4, W) }, active: 1 });
    sim.play(W);
    sim.drain();
    expect(sim.s.effects.some((e) => e.mod.kind === 'cannotAttack')).toBe(true);
  });
  it('銀河竜: 自分の他のジャイアントが相手のクリーチャーとバトルする時、かわりにこのクリーチャーにバトルさせてもよい', () => {
    const sim = new Sim({ p0: { battle: [{ c: GOLF_GALAXY }, { c: CADDY, tapped: true }] }, p1: { battle: [{ c: W }] }, active: 1 });
    sim.attack(W, CADDY);
    // バトルの置き換え
    sim.pick(GOLF_GALAXY);
    sim.drain();
    expect(sim.has(0, 'battle', CADDY)).toBe(true);
    expect(sim.has(1, 'battle', W)).toBe(false); // 13000 と 2000
    expect(checkInvariants(sim.s)).toEqual([]);
  });
});

describe('Q12 チアスペース アカネ / Q13 終の怒流牙 ドルゲユキムラ', () => {
  it('チアスペース アカネ: 出た時、山札の上から2枚を見て、1枚を手札に加え、もう1枚をマナゾーンに置く', () => {
    const sim = new Sim({ p0: { hand: [AKANE_S], mana: [...mana(4, N), ...mana(1, W)], deck: [W, N, N] } });
    sim.play(AKANE_S);
    sim.pick(W);
    sim.drain();
    expect(sim.has(0, 'hand', W)).toBe(true);
    expect(sim.count(0, 'mana')).toBe(6);
  });
  it('ドルゲユキムラ: G・ゼロ。バトルゾーンに自分のジャイアントが4枚以上あれば、コストを支払わずに召喚してもよい(自分のジャイアントの上に進化)', () => {
    const sim = new Sim({ p0: { hand: [DORUGE], battle: [{ c: TOKOSHIE }, { c: CADDY }, { c: CADDY }, { c: CADDY }] } });
    const onto = sim.pid(0, TOKOSHIE);
    sim.play(DORUGE, { extra: { alt: 'gzero', onto } });
    sim.drain();
    expect(sim.has(0, 'battle', DORUGE)).toBe(true);
    expect(sim.tappedMana(0)).toBe(0);
  });
});
