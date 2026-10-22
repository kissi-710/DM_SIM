// 革命5cザーディで追加したカード(神秘の石柱 / ハッスル・キャッスル / サインサイクリカ・ザーディアン・サイン / ホーリーエンド・ナウ・オア・ネバー /
// ミラダンテXII / プチョヘンザ / カツムゲン / ドギラゴン悪)と、そのための仕組み(G城・革命チェンジ・ファイナル革命・効果バトル)のシナリオテスト。
import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../../src/cards';
import { canSummon } from '../../src/engine/derive';
import { checkDeck } from '../../src/engine/engine';
import { mkCtx } from '../../src/engine/state';
import { reg, Sim, mana } from '../scenario';

const AQ = 'アクアン'; // 水 コスト4 パワー2000
const SIGN = 'ドラゴンズ・サイン'; // 光の呪文 コスト5
const ZARDY = '龍風混成 ザーディクリカ'; // 光水火 コスト7 パワー6000 EXライフ
const GAIA = '流星のガイアッシュ・カイザー'; // 水自然 コスト6 パワー8000 ブルー・コマンド・ドラゴン
const DOGI = '王道の革命 ドギラゴン'; // 光火自然 コスト5 パワー5000 メガ・コマンド・ドラゴン
const BOSS = '漢気の2号 ボスカツ'; // 光闇火 コスト5 パワー4000
const SYM = 'ティンパニ=シンバリー'; // 闇 コスト4 パワー4000 ブロッカー
const WAKU = '蒼狼の豊穣 ワクムテラス'; // 水 コスト4 出た時2枚引く
const SIGN_CYCLICA = '龍素記号Si サインサイクリカ';
const HOLY = '天命龍装 ホーリーエンド';
const MIRA = '時の法皇 ミラダンテXII';
const PUCHO = '百族の長 プチョヘンザ';
const KATSU = 'V頂神話 カツムゲン';
const DOGI_EVIL = '紅き団長 ドギラゴン悪';
const CASTLE = 'ハッスル・キャッスル';
const PILLAR = '神秘の石柱';
const REDGIRA = '轟く革命 レッドギラゾーン'; // 水火自然 コスト7 パワー11000 ソニック・コマンド・ドラゴン

/** 待機中の誘発の順序・任意の誘発・選択肢に、与えた方針で答えて turnAction まで進める */
function settle(sim: Sim, o: { yes?: boolean } = {}): Sim {
  let guard = 0;
  while (sim.s.pending && sim.s.pending.why !== 'turnAction' && sim.s.winner === null && guard++ < 40) {
    const inp: any = sim.pending.input;
    if (inp.shape === 'order') sim.answer(inp.candidates[0]);
    else if (inp.shape === 'yesno') sim.answer(o.yes ?? true);
    else if (inp.shape === 'pick' && sim.pending.why === 'may') sim.answer((o.yes ?? true) ? inp.candidates.slice(0, 1) : []);
    else if (inp.shape === 'option') sim.answer([0]);
    else sim.drain(1);
  }
  return sim;
}

describe('デッキ: 革命5cザーディ', () => {
  it('40枚で、同名4枚以内(構築制限)を満たし、全カードが読み込める', () => {
    const d = deckCards('zardy-rev5c');
    expect(d).toHaveLength(40);
    expect(checkDeck(CARD_DB, d, true).ok).toBe(true);
  });
});

describe('神秘の石柱', () => {
  it('山札の上2枚をタップしてマナゾーンに置き、その後、マナゾーンから1枚を墓地に置く(マナは1枚増える)', () => {
    const sim = new Sim({ p0: { hand: [PILLAR], mana: mana(3), deck: 10 } });
    sim.play(PILLAR);
    settle(sim);
    expect(sim.count(0, 'mana')).toBe(4);
    expect(sim.count(0, 'grave')).toBe(2); // 呪文と、墓地に置いたマナ
    expect(sim.count(0, 'deck')).toBe(8);
  });
  it('置いたばかりのマナも、墓地に置く対象にできる', () => {
    const sim = new Sim({ p0: { hand: [PILLAR], mana: mana(3), deck: 10 } });
    sim.play(PILLAR);
    const placed = sim.s.players[0].mana.slice(-2); // 直前に置かれた2枚
    expect(sim.pending.why).toBe('select');
    expect((sim.pending.input as any).candidates).toEqual(expect.arrayContaining(placed));
    sim.answer([placed[0]]);
    expect(sim.s.cards[placed[0]].zone).toBe('grave');
    expect(sim.count(0, 'mana', 'フェアリー・ライフ')).toBe(3); // 元のマナは残る
  });
});

describe('我竜塔第七層 ハッスル・キャッスル(G城)', () => {
  it('実行すると、表向きのシールドになり、山札の上1枚をタップしてマナゾーンに置く', () => {
    const sim = new Sim({ p0: { hand: [CASTLE], mana: mana(3), deck: 10 } });
    expect(sim.canPlay(CASTLE)).toBe(true);
    sim.play(CASTLE);
    settle(sim);
    expect(sim.count(0, 'shield')).toBe(6);
    expect(sim.s.cards[sim.uid(0, 'shield', CASTLE)].up).toBe(true);
    expect(sim.count(0, 'mana')).toBe(4);
    expect(sim.tappedMana(0)).toBe(4);
  });
  it('相手のクリーチャーが召喚以外で出る時は、かわりにマナゾーンに置く(召喚は止められない)', () => {
    const sim = new Sim({
      p0: { hand: [SIGN, DOGI, AQ], mana: [...mana(5, SIGN), ...mana(4, AQ)] },
      p1: { shield: [CASTLE, 'dummy', 'dummy'] },
    });
    sim.s.cards[sim.uid(1, 'shield', CASTLE)].up = true;
    sim.play(SIGN);
    settle(sim);
    expect(sim.has(0, 'mana', DOGI)).toBe(true); // 踏み倒しは、マナゾーンへ
    expect(sim.count(0, 'battle')).toBe(0);
    sim.play(AQ);
    settle(sim);
    expect(sim.has(0, 'battle', AQ)).toBe(true); // 召喚は止められない
  });
  it('ブレイクされると、手札ではなく墓地に置かれる', () => {
    const sim = new Sim({ p0: { battle: [{ c: AQ, sick: false }] }, p1: { shield: [CASTLE] } });
    sim.s.cards[sim.uid(1, 'shield', CASTLE)].up = true;
    sim.attack(AQ, 'player');
    settle(sim);
    expect(sim.has(1, 'grave', CASTLE)).toBe(true);
    expect(sim.count(1, 'hand')).toBe(0);
  });
});

describe('龍素記号Si サインサイクリカ / ザーディアン・サイン', () => {
  it('クリーチャー面: ブロッカーで、破壊された時、コスト5以下のクリーチャーを墓地から出してもよい(スレイヤーで相手も道連れ)', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: [SIGN_CYCLICA], grave: [AQ], shield: 5 },
      p1: { battle: [{ c: GAIA, sick: false }], shield: 5 },
    });
    sim.attack(GAIA, 'player');
    expect(sim.pending.why).toBe('block');
    sim.pick(SIGN_CYCLICA);
    // 破壊された時の任意の効果: 墓地のアクアンを出す
    for (let i = 0; i < 10 && sim.s.pending && sim.s.pending.why !== 'turnAction'; i++) {
      if (sim.pending.why === 'may') sim.use(AQ);
      else sim.drain(1);
    }
    expect(sim.has(0, 'grave', SIGN_CYCLICA)).toBe(true); // 8000 に 6500 は負ける
    expect(sim.has(1, 'grave', GAIA)).toBe(true); // スレイヤー
    expect(sim.has(0, 'battle', AQ)).toBe(true);
    expect(sim.has(0, 'grave', AQ)).toBe(false);
  });
  it('クリーチャー面: コスト6以上のクリーチャーは墓地から出せない(出さないを選んでもよい)', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: [SIGN_CYCLICA], grave: [ZARDY], shield: 5 },
      p1: { battle: [{ c: GAIA, sick: false }], shield: 5 },
    });
    sim.attack(GAIA, 'player');
    sim.pick(SIGN_CYCLICA);
    settle(sim);
    expect(sim.has(0, 'grave', ZARDY)).toBe(true);
    expect(sim.count(0, 'battle')).toBe(0);
  });
  it('呪文面: 手札からコスト7以下の多色コマンドを出す(単色・コスト8以上は出せない)', () => {
    const sim = new Sim({
      p0: {
        hand: [SIGN_CYCLICA, DOGI, AQ, GAIA],
        mana: [...mana(3, SIGN), ...mana(2, AQ)],
      },
    });
    sim.play(SIGN_CYCLICA, { face: 1 });
    expect(sim.pending.why).toBe('select');
    const cands: number[] = (sim.pending.input as any).candidates;
    expect(cands.map((u) => sim.s.cards[u].defId)).not.toContain('dm23bd7-031'); // アクアン(単色)
    sim.pick(DOGI);
    settle(sim);
    expect(sim.has(0, 'battle', DOGI)).toBe(true);
    expect(sim.has(0, 'grave', SIGN_CYCLICA)).toBe(true);
  });
});

describe('天命龍装 ホーリーエンド / ナウ・オア・ネバー', () => {
  it('クリーチャー面: 出た時、相手のクリーチャーをすべてタップし、カードを1枚引く', () => {
    const sim = new Sim({ p0: { hand: [HOLY], mana: mana(7, SIGN), deck: 10 }, p1: { battle: [AQ, SYM] } });
    sim.play(HOLY);
    settle(sim);
    expect(sim.s.players[1].battle.every((p) => p.tapped)).toBe(true);
    expect(sim.count(0, 'hand')).toBe(1);
  });
  it('呪文面: 手札のコスト7以下のクリーチャーを出して、手札に戻す(出た時の効果は使える)', () => {
    const sim = new Sim({ p0: { hand: [HOLY, WAKU], mana: mana(5, AQ), deck: 10 } });
    sim.play(HOLY, { face: 1 });
    settle(sim);
    expect(sim.count(0, 'battle')).toBe(0);
    expect(sim.has(0, 'hand', WAKU)).toBe(true);
    expect(sim.count(0, 'hand')).toBe(3); // ワクムテラス + 出た時に引いた2枚
  });
  it('出さなくてもよい', () => {
    const sim = new Sim({ p0: { hand: [HOLY, WAKU], mana: mana(5, AQ), deck: 10 } });
    sim.play(HOLY, { face: 1 });
    settle(sim, { yes: false });
    expect(sim.has(0, 'hand', WAKU)).toBe(true);
    expect(sim.count(0, 'hand')).toBe(1);
  });
  it('ドラゴンギルドは、ドラゴンではない(ドラゴンズ・サインで出せない)', () => {
    const sim = new Sim({ p0: { hand: [SIGN, HOLY], mana: mana(5, SIGN) } });
    sim.play(SIGN);
    settle(sim);
    expect(sim.has(0, 'hand', HOLY)).toBe(true);
    expect(sim.count(0, 'battle')).toBe(0);
  });
});

describe('時の法皇 ミラダンテXII', () => {
  const setup = (hand: string[]) =>
    new Sim({
      p0: { battle: [{ c: ZARDY, sick: false }], hand: [MIRA, ...hand], deck: 10 },
      p1: { shield: 5 },
    });
  it('革命チェンジ: 光または水のコスト5以上のドラゴンから入れ替わる', () => {
    const sim = setup([]);
    sim.attack(ZARDY, 'player');
    expect(sim.pending.why).toBe('may');
    sim.use();
    settle(sim);
    expect(sim.has(0, 'hand', ZARDY)).toBe(true);
    expect(sim.count(0, 'battle', MIRA)).toBe(1);
    expect(sim.count(1, 'shield')).toBe(2); // T・ブレイカーで3枚ブレイク
  });
  it('出た時: 光のコスト5以下の呪文がなければ、カードを1枚引く', () => {
    const sim = setup([]);
    sim.attack(ZARDY, 'player');
    sim.use();
    settle(sim);
    expect(sim.count(0, 'hand')).toBe(2); // ザーディクリカ + 引いた1枚
  });
  it('出た時: 光のコスト5以下の呪文を、手札からコストを支払わずに唱えると、引かない', () => {
    const sim = setup([SIGN]);
    sim.attack(ZARDY, 'player');
    sim.use(); // 革命チェンジ
    settle(sim);
    // ドラゴンズ・サインを唱え、手札のザーディクリカ(光のドラゴン)が出る。カードは引いていない
    expect(sim.evs('cast').length).toBeGreaterThanOrEqual(1);
    expect(sim.has(0, 'battle', ZARDY)).toBe(true);
    expect(sim.count(0, 'hand')).toBe(0);
    expect(sim.evs('moved').some((e) => e.cause === 'draw')).toBe(false);
  });
  it('ファイナル革命: 次の、相手のターンの終わりまで、相手はコスト7以下のクリーチャーを召喚できない', () => {
    const sim = setup([]);
    sim.attack(ZARDY, 'player');
    sim.use();
    settle(sim);
    expect(canSummon(mkCtx(sim.s, reg), 1, 7)).toBe(false);
    expect(canSummon(mkCtx(sim.s, reg), 1, 8)).toBe(true);
    expect(canSummon(mkCtx(sim.s, reg), 0, 7)).toBe(true); // 自分は召喚できる
    expect(sim.s.effects.some((e) => e.mod.kind === 'cannotSummon' && e.until.kind === 'endOfTurn' && e.until.turn === sim.s.turn + 1)).toBe(true);
  });
});

describe('百族の長 プチョヘンザ', () => {
  it('革命チェンジ + ファイナル革命: このクリーチャーよりパワーが小さいクリーチャーをすべて、持ち主のマナゾーンに置く', () => {
    const sim = new Sim({
      p0: { battle: [{ c: GAIA, sick: false }, AQ], hand: [PUCHO], deck: 10 },
      p1: { battle: [SYM, 'ヨビニオン・マルル', '配球の超人'], shield: 5 },
    });
    sim.attack(GAIA, 'player');
    sim.use();
    settle(sim);
    expect(sim.count(0, 'battle', PUCHO)).toBe(1);
    expect(sim.count(1, 'battle')).toBe(1);
    expect(sim.has(1, 'battle', '配球の超人')).toBe(true); // 14000 は残る
    expect(sim.has(1, 'mana', SYM)).toBe(true);
    expect(sim.has(1, 'mana', 'ヨビニオン・マルル')).toBe(true);
    expect(sim.has(0, 'mana', AQ)).toBe(true); // 自分のクリーチャーも、持ち主のマナゾーンへ
    expect(sim.has(0, 'battle', PUCHO)).toBe(true);
  });
  it('自分のマナの枚数よりコストが小さい相手のクリーチャーは、タップして出る', () => {
    const sim = new Sim({ p0: { battle: [PUCHO], mana: mana(5) }, p1: { hand: [AQ, SYM], mana: [...mana(4, AQ), ...mana(4, SYM)] }, active: 1 });
    sim.play(AQ); // コスト4 < マナ5
    sim.drain();
    sim.play(SYM); // コスト4 < マナ5
    sim.drain();
    expect(sim.s.players[1].battle).toHaveLength(2);
    expect(sim.s.players[1].battle.every((p) => p.tapped)).toBe(true);
    const sim2 = new Sim({ p0: { battle: [PUCHO], mana: mana(4) }, p1: { hand: [AQ], mana: mana(4, AQ) }, active: 1 });
    sim2.play(AQ); // コスト4 = マナ4 → タップしない
    sim2.drain();
    expect(sim2.s.players[1].battle[0].tapped).toBe(false);
  });
});

describe('V頂神話 カツムゲン', () => {
  it('革命チェンジ: 火または自然のパワー8000以上のクリーチャーから入れ替わる', () => {
    const sim = new Sim({ p0: { battle: [{ c: GAIA, sick: false }], hand: [KATSU] }, p1: { shield: 5 } });
    sim.attack(GAIA, 'player');
    sim.use();
    settle(sim);
    expect(sim.has(0, 'battle', KATSU)).toBe(true);
    expect(sim.count(1, 'shield')).toBe(2); // T・ブレイカー
  });
  it('パワー8000未満のクリーチャーからは、革命チェンジできない', () => {
    const sim = new Sim({ p0: { battle: [{ c: DOGI, sick: false }], hand: [KATSU] }, p1: { shield: 5 } });
    sim.attack(DOGI, 'player');
    expect(sim.s.pending?.why).not.toBe('may');
  });
  it('相手がコストを支払わずにクリーチャーを出した時、バトルしてもよい。バトル中のパワーは無限で、勝てば手札を捨てて2枚引き、パワー6000以上のクリーチャーを捨てたらアンタップする', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: [{ c: KATSU, tapped: true }], hand: [GAIA], deck: 10 },
      p1: { hand: [SIGN, DOGI], mana: mana(5, SIGN) },
    });
    sim.play(SIGN);
    for (let i = 0; i < 12 && sim.s.pending && sim.s.pending.why !== 'turnAction'; i++) {
      if (sim.pending.why === 'may' && sim.pending.player === 0) sim.use();
      else sim.drain(1);
    }
    expect(sim.has(1, 'grave', DOGI)).toBe(true); // 無限のパワーで勝った
    expect(sim.has(0, 'grave', GAIA)).toBe(true); // 捨てた
    expect(sim.count(0, 'hand')).toBe(2); // 2枚引いた
    expect(sim.s.players[0].battle[0].tapped).toBe(false); // パワー8000のクリーチャーを捨てたので、アンタップ
  });
  it('パワー6000未満のクリーチャーを捨てた時は、アンタップしない', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: [{ c: KATSU, tapped: true }], hand: [AQ], deck: 10 },
      p1: { hand: [SIGN, DOGI], mana: mana(5, SIGN) },
    });
    sim.play(SIGN);
    for (let i = 0; i < 12 && sim.s.pending && sim.s.pending.why !== 'turnAction'; i++) {
      if (sim.pending.why === 'may' && sim.pending.player === 0) sim.use();
      else sim.drain(1);
    }
    expect(sim.has(0, 'grave', AQ)).toBe(true);
    expect(sim.count(0, 'hand')).toBe(2);
    expect(sim.s.players[0].battle[0].tapped).toBe(true);
  });
  it('バトルしないこともできる', () => {
    const sim = new Sim({ active: 1, p0: { battle: [KATSU], hand: [GAIA], deck: 10 }, p1: { hand: [SIGN, DOGI], mana: mana(5, SIGN) } });
    sim.play(SIGN);
    for (let i = 0; i < 12 && sim.s.pending && sim.s.pending.why !== 'turnAction'; i++) {
      if (sim.pending.why === 'may' && sim.pending.player === 0) sim.decline();
      else sim.drain(1);
    }
    expect(sim.has(1, 'battle', DOGI)).toBe(true);
    expect(sim.evs('battleEnded')).toHaveLength(0);
  });
  it('コストを支払って召喚したクリーチャーには、バトルしない', () => {
    const sim = new Sim({ active: 1, p0: { battle: [KATSU] }, p1: { hand: [AQ], mana: mana(4, AQ) } });
    sim.play(AQ);
    settle(sim);
    expect(sim.s.pending?.why).toBe('turnAction');
    expect(sim.evs('battleEnded')).toHaveLength(0);
  });
});

describe('紅き団長 ドギラゴン悪', () => {
  it('革命チェンジ + ファイナル革命: 山札の上から2枚を墓地に置き、コスト7以下の多色クリーチャーを墓地から出す', () => {
    const sim = new Sim({
      p0: { battle: [{ c: REDGIRA, sick: false }], hand: [DOGI_EVIL], deck: [ZARDY, AQ, AQ, AQ] },
      p1: { shield: 5 },
    });
    sim.attack(REDGIRA, 'player');
    expect(sim.pending.why).toBe('may');
    sim.use();
    settle(sim);
    expect(sim.has(0, 'battle', DOGI_EVIL)).toBe(true);
    expect(sim.has(0, 'battle', ZARDY)).toBe(true); // 墓地に置いたザーディクリカが出た
    expect(sim.has(0, 'grave', AQ)).toBe(true);
    expect(sim.count(1, 'shield')).toBe(2); // T・ブレイカー
  });
  it('各ターン1回、自分の多色クリーチャーが出た時、相手のクリーチャーを選んでバトルしてもよい', () => {
    const sim = new Sim({
      p0: {
        battle: [{ c: DOGI_EVIL, sick: false }],
        hand: [SIGN_CYCLICA, BOSS],
        mana: [...mana(3, SIGN), ...mana(2, AQ)],
      },
      p1: { battle: [SYM] },
    });
    sim.play(SIGN_CYCLICA, { face: 1 });
    sim.drain(1); // 出すクリーチャーを選ぶ(単一なら自動)
    for (let i = 0; i < 8 && sim.s.pending && sim.s.pending.why !== 'turnAction'; i++) {
      if (sim.pending.why === 'may') sim.use(SYM);
      else sim.drain(1);
    }
    expect(sim.has(1, 'grave', SYM)).toBe(true); // 13000 が 4000 に勝つ
    expect(sim.has(0, 'battle', DOGI_EVIL)).toBe(true);
  });
});
