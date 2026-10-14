// インターステラ型マルルで追加したカード(インターステラ / XXDDZ / レッドギラゾーン / オーパーツ銃 / 配球の超人)と、
// そのための仕組み(超次元ゾーン・革命チェンジ・ファイナル革命・スレイヤー・付与・コスト封じ)のシナリオテスト。
import { describe, expect, it } from 'vitest';
import { canCast, canUseCost } from '../../src/engine/derive';
import { mkCtx } from '../../src/engine/state';
import { deckCards } from '../../src/cards';
import { checkDeck } from '../../src/engine/engine';
import { CARD_DB } from '../../src/cards';
import { reg, Sim, mana } from '../scenario';

const N = 'フェアリー・ライフ';
const AQ = 'アクアン'; // 水
const LOST = 'ロスト・Re:ソウル'; // 闇・コスト7

/** 待機中の誘発の順序・任意の誘発・選択肢に、与えた方針で答えて turnAction まで進める */
function settle(sim: Sim, o: { first?: string[]; yes?: boolean; option?: number } = {}): Sim {
  let guard = 0;
  while (sim.s.pending && sim.s.pending.why !== 'turnAction' && sim.s.winner === null && guard++ < 30) {
    const inp: any = sim.pending.input;
    if (inp.shape === 'order') {
      const labels: string[] = inp.labels;
      const want = (o.first ?? []).map((k) => labels.findIndex((l) => l.includes(k))).find((i) => i >= 0);
      sim.answer(inp.candidates[want ?? 0]);
    } else if (inp.shape === 'yesno') sim.answer(o.yes ?? true);
    else if (inp.shape === 'option') sim.answer([o.option ?? 0]);
    else sim.drain(1);
  }
  return sim;
}

describe('デッキ: インターステラ型マルル', () => {
  it('40枚で、同名4枚以内(構築制限)を満たす', () => {
    const d = deckCards('interstellar-maruru');
    expect(d).toHaveLength(40);
    expect(checkDeck(CARD_DB, d, true).ok).toBe(true);
  });
});

describe('偽りの月 インターステラ(超次元ゾーン)', () => {
  it('出た時: 手札の水/闇のコスト7以下の呪文を無料で唱え、墓地のかわりに超次元ゾーンに置く', () => {
    const sim = new Sim({
      p0: { hand: ['偽りの月 インターステラ', LOST], mana: [AQ, LOST, ...mana(5)] },
      p1: { hand: [N, N] },
    });
    sim.play('偽りの月 インターステラ');
    settle(sim, { first: ['呪文を無料で'] });
    expect(sim.count(1, 'hand')).toBe(0); // ロスト・Re:ソウルで相手の手札がなくなる
    expect(sim.count(1, 'grave')).toBe(2);
    expect(sim.has(0, 'hyper', LOST)).toBe(true);
    expect(sim.count(0, 'grave')).toBe(0);
    expect(sim.s.pending?.why).toBe('turnAction');
  });
  it('出た時: 水でも闇でもない呪文・コスト8以上の呪文は選べない(対象がなければ何も起きない)', () => {
    const sim = new Sim({ p0: { hand: ['偽りの月 インターステラ', N], mana: [AQ, LOST, ...mana(5)] } });
    sim.play('偽りの月 インターステラ');
    settle(sim);
    expect(sim.count(0, 'hyper')).toBe(0);
    expect(sim.has(0, 'hand', N)).toBe(true);
  });
  it('出た時: 墓地の呪文も唱えられる', () => {
    const sim = new Sim({ p0: { hand: ['偽りの月 インターステラ'], grave: [LOST], mana: [AQ, LOST, ...mana(5)] }, p1: { hand: [N] } });
    sim.play('偽りの月 インターステラ');
    settle(sim);
    expect(sim.has(0, 'hyper', LOST)).toBe(true);
    expect(sim.count(0, 'grave')).toBe(0);
    expect(sim.count(1, 'hand')).toBe(0);
  });
  it('攻撃する時: 超次元ゾーンの呪文を無料で唱え、山札の下に置く', () => {
    const sim = new Sim({
      p0: { battle: [{ c: '偽りの月 インターステラ', sick: false }], hyper: [LOST], deck: [N, N] },
      p1: { hand: [N, N], shield: 5 },
    });
    sim.attack('偽りの月 インターステラ', 'player');
    expect(sim.pending.why).toBe('may');
    sim.yes();
    settle(sim, { yes: false });
    expect(sim.count(1, 'grave')).toBe(2); // 相手の手札2枚が捨てられた(その後、割られたシールドが手札に入る)
    expect(sim.count(0, 'hyper')).toBe(0);
    expect(sim.names(0, 'deck').at(-1)).toBe(LOST);
  });
  it('攻撃する時: 超次元ゾーンに呪文がなければ何も起きない', () => {
    const sim = new Sim({ p0: { battle: [{ c: '偽りの月 インターステラ', sick: false }] }, p1: { hand: [N], shield: 5 } });
    sim.attack('偽りの月 インターステラ', 'player');
    // 任意の誘発(対象なし)を断る/使っても何も起きない
    sim.drain();
    expect(sim.count(1, 'grave')).toBe(0);
    expect(sim.count(0, 'hyper')).toBe(0);
  });
});

describe('覚醒連結 XXDDZ', () => {
  it('自分のクリーチャーすべてにスピードアタッカーを与える(召喚酔いでも攻撃できる)', () => {
    const sim = new Sim({
      p0: { hand: ['天災 デドダム'], mana: [AQ, LOST, N], battle: [{ c: '覚醒連結 XXDDZ', sick: false, ex: true }], deck: [N, N, N, N] },
    });
    sim.play('天災 デドダム');
    sim.drain();
    expect(sim.canPlay('天災 デドダム')).toBe(false);
    const did = sim.pid(0, '天災 デドダム');
    expect(sim.legal().some((a) => a.type === 'ATTACK' && a.attacker === did && a.target.kind === 'player')).toBe(true);
  });
  it('スレイヤー: バトルに負けても、相手を破壊する', () => {
    const sim = new Sim({
      p0: { battle: [{ c: '覚醒連結 XXDDZ', sick: false, ex: true }, { c: '天災 デドダム', sick: false }] },
      p1: { battle: [{ c: 'ヨビニオン・マルル', tapped: true }] },
    });
    sim.attack('天災 デドダム', 'ヨビニオン・マルル');
    sim.drain();
    expect(sim.has(0, 'grave', '天災 デドダム')).toBe(true); // 3000 < 5000 で負ける
    expect(sim.has(1, 'grave', 'ヨビニオン・マルル')).toBe(true); // スレイヤーで道連れ
  });
  it('攻撃する時: EXライフのシールドを墓地に置くと、相手は呪文を唱えられない', () => {
    const sim = new Sim({
      p0: { battle: [{ c: '覚醒連結 XXDDZ', sick: false, ex: true }], shield: 3 },
      p1: { hand: [N], shield: 5 },
    });
    sim.attack('覚醒連結 XXDDZ', 'player');
    expect(sim.pending.why).toBe('may');
    sim.yes();
    expect(sim.count(0, 'shield')).toBe(3); // EXライフのシールドが墓地へ(通常シールド3枚は残る)
    expect(sim.s.players[0].shield.every((u) => !sim.s.cards[u].ex)).toBe(true);
    expect(sim.count(0, 'grave')).toBe(1);
    const c = mkCtx(sim.s, reg);
    const spell = sim.s.players[1].hand[0];
    expect(canCast(c, 1, spell, 0)).toBe(false);
    expect(canCast(c, 0, spell, 0)).toBe(true); // 自分は唱えられる
  });
  it('攻撃する時: 断れば、EXライフのシールドも残り、呪文も封じない', () => {
    const sim = new Sim({ p0: { battle: [{ c: '覚醒連結 XXDDZ', sick: false, ex: true }] }, p1: { hand: [N], shield: 5 } });
    sim.attack('覚醒連結 XXDDZ', 'player');
    sim.no();
    expect(sim.s.players[0].shield.some((u) => sim.s.cards[u].ex)).toBe(true);
    expect(canCast(mkCtx(sim.s, reg), 1, sim.s.players[1].hand[0], 0)).toBe(true);
  });
});

describe('轟く革命 レッドギラゾーン(革命チェンジ・ファイナル革命)', () => {
  const setup = () =>
    new Sim({
      p0: {
        hand: ['轟く革命 レッドギラゾーン'],
        battle: [{ c: '天災 デドダム', sick: false }, { c: 'ティンパニ=シンバリー', tapped: true, sick: false }],
      },
      p1: { shield: 5 },
    });
  it('革命チェンジ: 条件に合うクリーチャーが攻撃する時、手札から入れ替えて攻撃を続ける', () => {
    const sim = setup();
    sim.attack('天災 デドダム', 'player');
    expect(sim.pending.why).toBe('may');
    sim.yes();
    expect(sim.has(0, 'hand', '天災 デドダム')).toBe(true);
    expect(sim.has(0, 'battle', '轟く革命 レッドギラゾーン')).toBe(true);
    expect(sim.has(0, 'hand', '轟く革命 レッドギラゾーン')).toBe(false);
    // 攻撃は続き、レッドギラゾーン(W・ブレイカー)が2枚割る
    sim.drain();
    expect(sim.count(1, 'shield')).toBe(3);
    // 入れ替わったクリーチャーはタップ状態
    const top = sim.s.players[0].battle.find((p) => sim.s.cards[p.cards[0]].defId === sim.r.defs[Object.keys(sim.r.defs).find((k) => sim.r.defs[k].name.includes('レッドギラゾーン'))!].id)!;
    expect(top.tapped).toBe(true);
  });
  it('ファイナル革命: 自分の他のクリーチャーをすべてアンタップする', () => {
    const sim = setup();
    sim.attack('天災 デドダム', 'player');
    sim.yes();
    sim.drain();
    const t = sim.s.players[0].battle.find((p) => sim.s.cards[p.cards[0]].defId === sim.r.defs[Object.keys(sim.r.defs).find((k) => sim.r.defs[k].name.includes('ティンパニ'))!].id)!;
    expect(t.tapped).toBe(false);
  });
  it('ファイナル革命は、そのターンに他のファイナル革命を使っていれば使えない', () => {
    const sim = setup();
    sim.s.turnLog.push({ id: 1, causedBy: null, type: 'finalRevolution', turn: 5, owner: 0 });
    sim.attack('天災 デドダム', 'player');
    sim.yes();
    sim.drain();
    const t = sim.s.players[0].battle.find((p) => sim.s.cards[p.cards[0]].defId === sim.r.defs[Object.keys(sim.r.defs).find((k) => sim.r.defs[k].name.includes('ティンパニ'))!].id)!;
    expect(t.tapped).toBe(true);
  });
  it('革命チェンジの条件に合わないクリーチャーでは使えない(質問も出ない)', () => {
    const sim = new Sim({
      p0: { hand: ['轟く革命 レッドギラゾーン'], battle: [{ c: 'ヨビニオン・マルル', sick: false }] },
      p1: { shield: 5 },
    });
    sim.attack('ヨビニオン・マルル', 'player');
    expect(sim.s.pending?.why).not.toBe('may');
    expect(sim.has(0, 'hand', '轟く革命 レッドギラゾーン')).toBe(true);
  });
  it('自分のコマンドは、ブロックされない・スピードアタッカー・マッハファイターを得る', () => {
    const sim = new Sim({
      p0: { battle: ['轟く革命 レッドギラゾーン', { c: '天災 デドダム', sick: false }] },
      p1: { battle: ['ティンパニ=シンバリー'], shield: 5 },
    });
    // ブロッカーがいるが、ブロックを聞かれずにシールドが割られる
    sim.attack('天災 デドダム', 'player');
    expect(sim.s.pending?.why).not.toBe('block');
    expect(sim.count(1, 'shield')).toBe(4);
    // 召喚酔いのコマンドが、プレイヤーを攻撃できる(スピードアタッカー)
    expect(sim.legal().some((a) => a.type === 'ATTACK' && a.attacker === sim.pid(0, '轟く革命 レッドギラゾーン'))).toBe(true);
  });
});

describe('完璧団長 オーパーツ銃(革命チェンジ・ファイナル革命・ドロー)', () => {
  const setup = () =>
    new Sim({
      p0: { hand: ['完璧団長 オーパーツ銃'], battle: [{ c: '終末の監視者 ジ・ウォッチ', sick: false }], deck: [N, N, N] },
      p1: { battle: ['ティンパニ=シンバリー', 'アクアン', 'ヨビニオン・マルル'], hand: [N], shield: 5 },
    });
  it('革命チェンジ: 水または闇のパワー8000以上のクリーチャーが攻撃する時に使える', () => {
    const sim = setup();
    sim.attack('終末の監視者 ジ・ウォッチ', 'player');
    // ジ・ウォッチ自身の「攻撃する時」の誘発と革命チェンジの順序/任意の質問
    settle(sim, { first: ['革命チェンジ'], option: 0 });
    expect(sim.has(0, 'battle', '完璧団長 オーパーツ銃')).toBe(true);
    expect(sim.has(0, 'hand', '終末の監視者 ジ・ウォッチ')).toBe(true);
  });
  it('ファイナル革命: 数字を選ぶと、そのコストの相手のクリーチャーをすべて破壊し、そのコストのカードを実行できなくする', () => {
    const sim = setup();
    sim.attack('終末の監視者 ジ・ウォッチ', 'player');
    settle(sim, { first: ['革命チェンジ'], option: 4 }); // 数字 4
    expect(sim.has(1, 'battle', 'ティンパニ=シンバリー')).toBe(false);
    expect(sim.has(1, 'battle', 'アクアン')).toBe(false);
    expect(sim.has(1, 'battle', 'ヨビニオン・マルル')).toBe(false); // コスト4
    const c = mkCtx(sim.s, reg);
    expect(canUseCost(c, 1, 4)).toBe(false);
    expect(canUseCost(c, 1, 5)).toBe(true);
    expect(canUseCost(c, 0, 4)).toBe(true); // 自分は実行できる
    // 破壊したクリーチャーの数だけ、相手の墓地に置かれた時のドロー(任意)が起きている
    expect(sim.s.players[1].grave.length).toBe(3);
  });
  it('相手の墓地にカードが置かれた時、カードを1枚引いてもよい', () => {
    const sim = new Sim({
      p0: { battle: ['完璧団長 オーパーツ銃'], hand: ['ブレイン・スラッシュ'], mana: mana(6, N), deck: [N, N, N] },
      p1: { battle: [{ c: 'アクアン', tapped: true }], hand: [N] },
    });
    // オーパーツ銃自身の効果で相手の手札を捨てさせる代わりに、墓地送りを直接起こす: 戦闘で相手を破壊する
    sim.s.players[0].battle[0].sick = false;
    sim.s.players[0].battle[0].tapped = false;
    const before = sim.count(0, 'hand');
    sim.attack('完璧団長 オーパーツ銃', 'アクアン');
    expect(sim.has(1, 'grave', 'アクアン')).toBe(true);
    expect(sim.pending.why).toBe('may');
    sim.yes();
    expect(sim.count(0, 'hand')).toBe(before + 1);
  });
});

describe('実行できないコスト(コスト封じ)', () => {
  it('封じられたコストの呪文・クリーチャーは、使えない', () => {
    const sim = new Sim({
      p0: { battle: ['完璧団長 オーパーツ銃'] },
      p1: { hand: [N, 'アクアン'], mana: mana(6), shield: 5 },
      active: 1,
    });
    sim.s.effects.push({ id: 99, pid: -1, mod: { kind: 'cannotUseCost', n: 4 }, until: { kind: 'untilTurnStart', player: 0, afterTurn: 4 }, controller: 0 });
    expect(sim.canPlay(N)).toBe(true); // コスト2
    expect(sim.canPlay('アクアン')).toBe(false); // コスト4
  });
});

describe('配球の超人 / 記録的剛球', () => {
  it('クリーチャー面: 出た時、相手のクリーチャー1体を、持ち主のマナゾーンに置く', () => {
    const sim = new Sim({
      p0: { hand: ['配球の超人 / 記録的剛球'], mana: mana(8) },
      p1: { battle: ['アクアン'] },
    });
    sim.play('配球の超人 / 記録的剛球', { face: 0 });
    expect(sim.has(1, 'mana', 'アクアン')).toBe(true);
    expect(sim.count(1, 'battle')).toBe(0);
  });
  it('呪文面: 山札の上1枚をマナゾーンに置く(コスト2)', () => {
    const sim = new Sim({ p0: { hand: ['配球の超人 / 記録的剛球'], mana: mana(2), deck: [AQ, N] } });
    sim.play('配球の超人 / 記録的剛球', { face: 1 });
    expect(sim.has(0, 'mana', AQ)).toBe(true);
    expect(sim.count(0, 'grave', '配球の超人 / 記録的剛球')).toBe(1);
  });
});

describe('同じ攻撃時に誘発した革命チェンジとインターステラの攻撃時効果', () => {
  const setup = () =>
    new Sim({
      p0: { hand: ['轟く革命 レッドギラゾーン'], battle: [{ c: '偽りの月 インターステラ', sick: false }], hyper: [LOST], deck: [N, N] },
      p1: { hand: [N, N], shield: 5 },
    });
  it('革命チェンジを先に解決し、インターステラが手札に戻っても、攻撃時効果は(誘発済みなので)使える', () => {
    const sim = setup();
    sim.attack('偽りの月 インターステラ', 'player');
    expect(sim.pending.why).toBe('pickNext');
    sim.order('革命チェンジ'); // 革命チェンジを先に
    sim.yes();
    expect(sim.has(0, 'hand', '偽りの月 インターステラ')).toBe(true);
    expect(sim.has(0, 'battle', '轟く革命 レッドギラゾーン')).toBe(true);
    // 続けて、手札に戻ったインターステラの攻撃時効果を解決できる
    settle(sim, { first: ['超次元ゾーンの呪文'], yes: true });
    expect(sim.count(0, 'hyper')).toBe(0);
    expect(sim.names(0, 'deck').at(-1)).toBe(LOST);
    expect(sim.count(1, 'grave')).toBe(2); // ロスト・Re:ソウルで相手の手札が捨てられた
  });
  it('インターステラの攻撃時効果を先に解決してから、革命チェンジしてもよい', () => {
    const sim = setup();
    sim.attack('偽りの月 インターステラ', 'player');
    sim.order('超次元ゾーンの呪文');
    sim.yes();
    expect(sim.count(0, 'hyper')).toBe(0);
    expect(sim.pending.why).toBe('may'); // 革命チェンジの確認
    sim.yes();
    expect(sim.has(0, 'battle', '轟く革命 レッドギラゾーン')).toBe(true);
    expect(sim.has(0, 'hand', '偽りの月 インターステラ')).toBe(true);
  });
});
