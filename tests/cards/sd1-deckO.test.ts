// デッキO「タマシード戦略の火光水ライオネルデッキ」の新規カード(docs/decks-25oudou.md)のシナリオテスト。進化・タマシード・シールド化など。
import { describe, expect, it } from 'vitest';
import { Sim, mana, reg } from '../scenario';
import { checkInvariants } from '../../src/engine/invariants';
import { powerOf } from '../../src/engine/derive';
import { mkCtx } from '../../src/engine/state';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const L = 'ダミー'; // 光
const REX = 'タイムピョンチキ'; // レクスターズ
const LION = '「正義星帝」 <ライオネル.Star>';
const JONNY = 'MAX・ザ・ジョニー';
const JOKER_E = 'ジョーカーズの心絵';
const SLOT = 'スロットンの心絵';
const GERA = 'ゲラッチョの心絵';
const KORA = 'コーライルの海幻';
const SONG = '♪なぜ離れ どこへ行くのか 君は今';
const AQNET = 'AQ NETWORK';
const IDEAL = '理想と平和の決断';
const MOMO = 'アルカディアス・モモキング';
const JANOU = '邪脳の魔法陣';
const power = (sim: Sim, p: 0 | 1, name: string) => powerOf(mkCtx(sim.s, reg), sim.s.players[p].battle.find((x) => x.pid === sim.pid(p, name))!);
const attackActions = (sim: Sim) => sim.legal().filter((a) => a.type === 'ATTACK');

describe('O01 「正義星帝」 <ライオネル.Star>', () => {
  it('レクスターズの上に進化し、出た時、カードを1枚引く。光のタマシードを手札から出してもよい', () => {
    const sim = new Sim({ p0: { hand: [LION, GERA], battle: [{ c: REX }], mana: mana(5, L), deck: [N, N, N] }, p1: { battle: [{ c: W }] } });
    sim.play(LION, { extra: { onto: sim.pid(0, REX) } });
    sim.use(GERA);
    sim.drain();
    expect(sim.has(0, 'battle', LION)).toBe(true);
    expect(sim.has(0, 'battle', GERA)).toBe(true);
    expect(sim.count(0, 'hand')).toBeGreaterThanOrEqual(1);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('各ターンに1度、自分のタマシードが出た時、コスト6以下の進化クリーチャーを1体、自分の手札から出してもよい', () => {
    const sim = new Sim({
      p0: { hand: [GERA, MOMO], battle: [{ c: LION, under: [REX] }], mana: mana(2, L), deck: [N, N, N] },
      p1: { battle: [{ c: W }] },
    });
    sim.play(GERA);
    sim.drain(1);
    sim.pick(MOMO);
    sim.drain();
    expect(sim.has(0, 'battle', MOMO)).toBe(true);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
});

describe('O02 MAX・ザ・ジョニー', () => {
  it('パワードブレイカー。自分の他のジョーカーズまたはレクスターズ1枚につき、パワーを+2000する', () => {
    const sim = new Sim({ p0: { battle: [{ c: JONNY }, { c: REX }, { c: REX }, { c: W }] } });
    expect(power(sim, 0, JONNY)).toBe(14000);
  });
  it('各ブレイクの前に山札の上から1枚目をシールド化する。攻撃の終わりに、自分のシールドが10以上あれば、自分はゲームに勝つ', () => {
    const sim = new Sim({ p0: { battle: [{ c: JONNY }], shield: 9, deck: [N, N, N] }, p1: { shield: 1, deck: [N, N] } });
    sim.attack(JONNY, 'player');
    sim.drain();
    expect(sim.s.winner).toBe(0);
  });
  it('自分がゲームに負ける時、かわりにこのクリーチャーを破壊する', () => {
    const sim = new Sim({ p0: { battle: [{ c: JONNY }], shield: 0, deck: [N, N] }, p1: { battle: [{ c: W }], deck: [N, N] }, active: 1 });
    sim.attack(W, 'player');
    sim.option(0);
    sim.drain();
    expect(sim.s.winner).toBeNull();
    expect(sim.has(0, 'grave', JONNY)).toBe(true);
  });
});

describe('O03 ジョーカーズの心絵', () => {
  it('各プレイヤーは自身のクリーチャーとタマシードを最大1つずつ選び、残りをすべて山札に加えてシャッフルする。その後、加えたカード1枚につき、山札の上から1枚目をシールド化する', () => {
    const sim = new Sim({
      p0: { hand: [JOKER_E], battle: [{ c: W }, { c: REX }, { c: W }], mana: mana(8, L), deck: [N, N, N, N, N, N], shield: 0 },
      p1: { battle: [{ c: W }, { c: W }], deck: [N, N, N, N, N], shield: 0 },
    });
    sim.play(JOKER_E);
    // 自分: クリーチャー1体を残す(タマシードは自身)
    sim.pick(W);
    sim.pick(JOKER_E);
    // 相手: クリーチャー1体を残す
    for (let i = 0; i < 4 && sim.s.pending && sim.s.pending.why !== 'turnAction'; i++) {
      const inp: any = sim.s.pending.input;
      if (inp.shape === 'pick') sim.answer(inp.candidates.slice(0, inp.min === 0 ? 1 : inp.min));
      else sim.drain(1);
    }
    sim.drain();
    expect(sim.count(0, 'battle')).toBe(2); // 残した1体 + 心絵
    expect(sim.count(0, 'shield')).toBe(2);
    expect(sim.count(1, 'battle')).toBe(1);
    expect(sim.count(1, 'shield')).toBe(1);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
});

describe('O04 スロットンの心絵 / O05 ゲラッチョの心絵', () => {
  it('スロットンの心絵: 光のコスト7以下の進化クリーチャーを手札から出し、次の自分のターンのはじめまで「ブロッカー」を与える', () => {
    const sim = new Sim({ p0: { hand: [SLOT, LION], battle: [{ c: REX }], mana: mana(5, L), deck: [N, N] } });
    sim.play(SLOT);
    sim.option(1);
    sim.drain();
    expect(sim.has(0, 'battle', LION)).toBe(true);
  });
  it('ゲラッチョの心絵: カードを1枚引く。その後、相手は自身のアンタップしているクリーチャーを1体選び、タップする', () => {
    const sim = new Sim({ p0: { hand: [GERA], mana: mana(2, L), deck: [N, N] }, p1: { battle: [{ c: W }] } });
    sim.play(GERA);
    sim.drain();
    expect(sim.count(0, 'hand')).toBe(1);
    expect(sim.s.players[1].battle[0].tapped).toBe(true);
  });
});

describe('O06 コーライルの海幻 / O07 ♪なぜ離れ どこへ行くのか 君は今', () => {
  it('コーライルの海幻: クリーチャーまたはタマシードを1つ選ぶ。その持ち主は、それを山札の下に置き、カードを1枚引く', () => {
    const sim = new Sim({ p0: { hand: [KORA], mana: mana(4, W), deck: [N, N] }, p1: { battle: [{ c: 'AQvibrato' }], deck: [N, N] } });
    sim.play(KORA);
    sim.pick('AQvibrato');
    sim.drain();
    expect(sim.has(1, 'battle', 'AQvibrato')).toBe(false);
    expect(sim.count(1, 'hand')).toBe(1);
    expect(sim.count(0, 'hand')).toBe(0);
  });
  it('♪なぜ離れ どこへ行くのか 君は今: プレイヤー1人の墓地をシャッフルして山札の下に置き、カードを2枚引く', () => {
    const sim = new Sim({ p0: { hand: [SONG], mana: mana(3, W), deck: [N, N, N], grave: [W, W] } });
    sim.play(SONG);
    sim.option(0);
    sim.drain();
    expect(sim.count(0, 'grave')).toBe(1); // 呪文自身だけ
    expect(sim.count(0, 'hand')).toBe(2);
  });
});

describe('O08 AQ NETWORK', () => {
  it('出た時、コスト5以下のタマシードまたは呪文を1つ、手札からコストを支払わずに実行してもよい', () => {
    const sim = new Sim({ p0: { hand: [AQNET, GERA], mana: mana(5, W), deck: [N, N] } });
    sim.play(AQNET);
    sim.use();
    sim.drain();
    expect(sim.has(0, 'battle', GERA)).toBe(true);
  });
  it('シビルカウント3: 水のクリーチャーまたはタマシードが合計3つ以上あれば、「ブロッカー」を持ち、破壊される時、かわりに手札に戻る', () => {
    const sim = new Sim({
      p0: { battle: [{ c: AQNET }, { c: W }, { c: 'AQvibrato' }] },
      p1: { hand: ['青銅のバンビシカット'], mana: mana(9, 'ドンドン火噴くナウ'), deck: [N, N] },
      active: 1,
    });
    sim.play('青銅のバンビシカット', { face: 1 });
    sim.drain(1);
    if (sim.s.pending?.input?.shape === 'pick') sim.pick(AQNET);
    sim.drain();
    expect(sim.has(0, 'battle', AQNET)).toBe(false);
    expect(sim.has(0, 'hand', AQNET)).toBe(true);
  });
});

describe('O09 理想と平和の決断', () => {
  it('次の中から2回選ぶ: 山札の上から1枚をシールド化する(2回)', () => {
    const sim = new Sim({ p0: { hand: [IDEAL], mana: [...mana(2, L), ...mana(2, W)], deck: [N, N, N, N], shield: 0 } });
    sim.play(IDEAL);
    sim.option(1, 1);
    sim.drain();
    expect(sim.count(0, 'shield')).toBe(2);
  });
  it('革命2: 自分のシールドが2つ以下なら、シールドゾーンから手札に加えるこの呪文に「S・トリガー」を与える', () => {
    const sim = new Sim({ p0: { battle: [{ c: W }] }, p1: { shield: [IDEAL], deck: [N, N, N, N], mana: [] } });
    sim.attack(W, 'player');
    expect(sim.s.pending?.why).toBe('triggerDeclare');
  });
});

describe('O10 アルカディアス・モモキング', () => {
  it('自分の他のレクスターズすべてのパワーを+2000する', () => {
    const sim = new Sim({ p0: { battle: [{ c: MOMO, under: [REX] }, { c: GERA }] } });
    expect(power(sim, 0, MOMO)).toBe(12500);
  });
  it('相手は、光ではない呪文を唱えられない', () => {
    const sim = new Sim({ p0: { battle: [{ c: MOMO, under: [REX] }] }, p1: { hand: ['クリムゾン・ビクトリー', IDEAL], mana: [...mana(4, 'ドンドン火噴くナウ'), ...mana(4, L)] }, active: 1 });
    expect(sim.legal().some((a) => a.type === 'PLAY_CARD' && a.uid === sim.uid(1, 'hand', 'クリムゾン・ビクトリー') && a.face === 1)).toBe(false);
    expect(sim.legal().some((a) => a.type === 'PLAY_CARD' && a.uid === sim.uid(1, 'hand', IDEAL))).toBe(true);
    expect(attackActions(sim).length).toBe(0);
  });
});

describe('O11 邪脳の魔法陣', () => {
  it('出た時、山札の上から3枚を墓地に置いてもよい。その後、コスト4以下のクリーチャーではないカードを墓地から実行してもよい', () => {
    const sim = new Sim({ p0: { hand: [JANOU], mana: [...mana(2, L), ...mana(2, W), 'フットレス=トレース'], deck: [N, GERA, N, N, N] } });
    sim.play(JANOU);
    sim.yes();
    sim.use(GERA);
    sim.drain();
    expect(sim.has(0, 'battle', GERA)).toBe(true);
  });
  it('このカードを自分の手札からマナゾーンに置いた時、アンタップする', () => {
    const sim = new Sim({ p0: { hand: [JANOU] }, step: 'mana' });
    sim.charge(JANOU);
    sim.drain();
    expect(sim.s.cards[sim.uid(0, 'mana', JANOU)].tapped).toBe(false);
  });
});
