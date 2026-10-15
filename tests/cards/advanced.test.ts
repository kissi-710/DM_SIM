import { describe, expect, it } from 'vitest';
import { canBeAttacked, canBeChosen } from '../../src/engine/derive';
import { mkCtx } from '../../src/engine/state';
import { declaration } from '../../src/engine/procs';
import { reg, Sim, mana } from '../scenario';

const N = 'フェアリー・ライフ'; // 自然
const W = 'アクアン'; // 水
const D = 'ロスト・Re:ソウル'; // 闇
const L = 'ドラゴンズ・サイン'; // 光
const F = '王道の革命 ドギラゴン'; // 光・火・自然(火の代用)

describe('A10 流星のガイアッシュ・カイザー', () => {
  it('出た時、カードを2枚引く', () => {
    const sim = new Sim({ p0: { hand: ['流星のガイアッシュ・カイザー'], mana: [W, W, W, N, N, N], deck: 5 } });
    sim.play('流星のガイアッシュ・カイザー');
    expect(sim.count(0, 'hand')).toBe(2);
  });
  it('自分のコスト10以上のクリーチャーの召喚コストが4少なくなる', () => {
    const without = new Sim({ p0: { hand: ['終末の監視者 ジ・ウォッチ'], mana: mana(6, W) } });
    expect(without.canPlay('終末の監視者 ジ・ウォッチ')).toBe(false);
    const withK = new Sim({ p0: { battle: ['流星のガイアッシュ・カイザー'], hand: ['終末の監視者 ジ・ウォッチ'], mana: mana(6, W) } });
    expect(withK.canPlay('終末の監視者 ジ・ウォッチ')).toBe(true);
    // コスト10未満のクリーチャーは軽減されない
    const small = new Sim({ p0: { battle: ['流星のガイアッシュ・カイザー'], hand: ['アクアン'], mana: mana(3, W) } });
    expect(small.canPlay('アクアン')).toBe(false);
  });
  it('相手のクリーチャーは、出たターンにプレイヤーを攻撃できない', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: ['流星のガイアッシュ・カイザー'] },
      p1: { battle: [{ c: '王道の革命 ドギラゴン', sick: true }] },
    });
    sim.s.players[1].battle[0].enteredTurn = sim.s.turn;
    expect(sim.legal().some((a) => a.type === 'ATTACK' && a.target.kind === 'player')).toBe(false);
    const later = new Sim({
      active: 1,
      p0: { battle: ['流星のガイアッシュ・カイザー'] },
      p1: { battle: [{ c: '王道の革命 ドギラゴン', sick: true }] },
    });
    later.s.players[1].battle[0].enteredTurn = later.s.turn - 1;
    expect(later.legal().some((a) => a.type === 'ATTACK' && a.target.kind === 'player')).toBe(true);
  });
  it('相手のターン終了時、相手がマナをタップせずにクリーチャーを出していれば、無料で召喚してもよい', () => {
    const sim = new Sim({ active: 1, p0: { hand: ['流星のガイアッシュ・カイザー'], deck: 5 } });
    sim.s.turnLog.push({ id: 5, causedBy: null, type: 'entered', turn: sim.s.turn, owner: 1, paid: 0, kind: 'creature', card: 1, via: 'summon' } as any);
    sim.endTurn();
    expect(sim.pending.why).toBe('may');
    expect(sim.pending.player).toBe(0);
    sim.yes();
    expect(sim.has(0, 'battle', '流星のガイアッシュ・カイザー')).toBe(true);
    expect(sim.count(0, 'hand')).toBe(3); // 出た時に2枚引き、自分のターンのドローで1枚
  });
  it('マナをタップして出していた場合は、召喚できない', () => {
    const sim = new Sim({ active: 1, p0: { hand: ['流星のガイアッシュ・カイザー'], deck: 5 } });
    sim.s.turnLog.push({ id: 5, causedBy: null, type: 'entered', turn: sim.s.turn, owner: 1, paid: 3, kind: 'creature', card: 1, via: 'summon' } as any);
    sim.endTurn();
    expect(sim.has(0, 'hand', '流星のガイアッシュ・カイザー')).toBe(true);
    expect(sim.s.active).toBe(0);
  });
});

describe('A11 CRYMAX ジャオウガ', () => {
  it('進化元なしで召喚でき、出た時に各プレイヤーはシールドを3枚選び、残りを墓地に置く', () => {
    const sim = new Sim({
      p0: { hand: ['CRYMAX ジャオウガ'], mana: mana(7, D), shield: [W, D, N, L, F] },
      p1: { shield: [N, W, D, L, F] },
    });
    sim.play('CRYMAX ジャオウガ');
    expect(sim.pending.player).toBe(0);
    sim.pick(W, D, N);
    expect(sim.pending.player).toBe(1);
    // 両者が選んでから、一括で墓地に置く(先に選んだ側のシールドは、まだ墓地に置かれていない)
    expect(sim.count(0, 'shield')).toBe(5);
    expect(sim.count(0, 'grave')).toBe(0);
    sim.pick(N, W, D);
    expect(sim.count(0, 'shield')).toBe(3);
    expect(sim.count(1, 'shield')).toBe(3);
    expect(sim.count(0, 'grave')).toBe(2);
    expect(sim.count(1, 'grave')).toBe(2);
  });
  it('攻撃する時、相手のクリーチャーを破壊し、手札を2枚見ずに捨てさせる', () => {
    const sim = new Sim({
      p0: { battle: ['CRYMAX ジャオウガ'] },
      p1: { battle: ['ヨビニオン・マルル', '天災 デドダム'], hand: [N, W, L], shield: 5 },
    });
    sim.attack('CRYMAX ジャオウガ', 'player');
    sim.pick('天災 デドダム');
    expect(sim.has(1, 'grave', '天災 デドダム')).toBe(true);
    // 手札3枚 → 2枚捨てて1枚。T・ブレイカーで3枚割られて手札は4枚
    expect(sim.count(1, 'hand')).toBe(4);
    expect(sim.count(1, 'grave')).toBe(3);
  });
  it('離れる時、かわりに自分の表向きのカード3枚を破壊してもよい(置換)', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: ['CRYMAX ジャオウガ', 'ヨビニオン・マルル', '天災 デドダム', 'ティンパニ=シンバリー'], mana: mana(4) },
      p1: { hand: ['修羅の死神フミシュナ'], mana: mana(5, W), deck: 5 },
    });
    sim.play('修羅の死神フミシュナ', { face: 1 });
    sim.option(0, 1); // カードを引く+相手のクリーチャーを手札に戻す
    sim.pick('CRYMAX ジャオウガ');
    // 置換の選択(持ち主=p0)
    expect(sim.pending.why).toBe('replaceChoice');
    expect(sim.pending.player).toBe(0);
    sim.option(0);
    expect(sim.has(0, 'battle', 'CRYMAX ジャオウガ')).toBe(true);
    // 他のバトルゾーンのカード3枚(ちょうど3枚なので、選択の余地はない)が破壊される。マナゾーンは対象外
    expect(sim.count(0, 'grave')).toBe(3);
    expect(sim.count(0, 'battle')).toBe(1);
    expect(sim.count(0, 'mana')).toBe(4);
  });
  it('破壊できるのはバトルゾーンのカードだけ: 他に3枚なければ、マナゾーンが何枚あっても身代わりにできない(公式 Q&A 41461)', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: ['CRYMAX ジャオウガ', 'ヨビニオン・マルル'], mana: mana(8) },
      p1: { hand: ['修羅の死神フミシュナ'], mana: mana(5, W), deck: 5 },
    });
    sim.play('修羅の死神フミシュナ', { face: 1 });
    sim.option(0, 1);
    sim.pick('CRYMAX ジャオウガ');
    // 置換の質問は出ず、そのまま手札に戻る
    expect(sim.has(0, 'hand', 'CRYMAX ジャオウガ')).toBe(true);
    expect(sim.count(0, 'mana')).toBe(8);
  });
  it('他のクリーチャーが4体以上いる時は、破壊する3枚を持ち主が選ぶ', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: ['CRYMAX ジャオウガ', 'ヨビニオン・マルル', '天災 デドダム', 'ティンパニ=シンバリー', 'アクアン'], mana: mana(2) },
      p1: { hand: ['修羅の死神フミシュナ'], mana: mana(5, W), deck: 5 },
    });
    sim.play('修羅の死神フミシュナ', { face: 1 });
    sim.option(0, 1);
    sim.pick('CRYMAX ジャオウガ');
    expect(sim.pending.why).toBe('replaceChoice');
    sim.option(0);
    expect(sim.pending.why).toBe('select');
    expect(sim.pending.player).toBe(0);
    sim.pick('ヨビニオン・マルル', 'アクアン', '天災 デドダム');
    expect(sim.has(0, 'battle', 'ティンパニ=シンバリー')).toBe(true);
    expect(sim.has(0, 'grave', 'アクアン')).toBe(true);
    expect(sim.count(0, 'grave')).toBe(3);
  });
  it('置換しなければ、そのまま手札に戻る', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: ['CRYMAX ジャオウガ', 'ヨビニオン・マルル', '天災 デドダム', 'ティンパニ=シンバリー'], mana: mana(4) },
      p1: { hand: ['修羅の死神フミシュナ'], mana: mana(5, W), deck: 5 },
    });
    sim.play('修羅の死神フミシュナ', { face: 1 });
    sim.option(0, 1);
    sim.pick('CRYMAX ジャオウガ');
    sim.option(1); // 置換しない
    expect(sim.has(0, 'hand', 'CRYMAX ジャオウガ')).toBe(true);
  });
  it('身代わりの「破壊」は、さらに置換されない(ジャオウガの身代わりにトライブの置換は使えない)', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: ['CRYMAX ジャオウガ', 'ヨビニオン・トライブ', '天災 デドダム', 'アクアン'], mana: mana(2) },
      p1: { hand: ['修羅の死神フミシュナ'], mana: mana(5, W), deck: 5 },
    });
    sim.play('修羅の死神フミシュナ', { face: 1 });
    sim.option(0, 1);
    // 対象は4体(ジャオウガ・トライブ・デドダム・アクアン)。ジャオウガを選ぶ
    sim.pick('CRYMAX ジャオウガ');
    sim.option(0); // 置換する: トライブ・デドダム・アクアンが破壊される
    expect(sim.has(0, 'grave', 'ヨビニオン・トライブ')).toBe(true);
    expect(sim.has(0, 'mana', 'ヨビニオン・トライブ')).toBe(false);
  });
  it('ダイレクトアタックで負ける時も、かわりに表向きのカード3枚を破壊してもよい(置換)', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: ['CRYMAX ジャオウガ', '天災 デドダム', 'ヨビニオン・トライブ', '漢気の2号 ボスカツ'], shield: 0 },
      p1: { battle: ['ヨビニオン・マルル'] },
    });
    sim.attack('ヨビニオン・マルル', 'player');
    // 置換の選択(持ち主=p0)
    expect(sim.pending.why).toBe('replaceChoice');
    expect(sim.pending.player).toBe(0);
    sim.option(0);
    // 勝敗は決まらず、ジャオウガは残る。ほかの3体が破壊される(ちょうど3枚なので選択はない)
    expect(sim.s.winner).toBeNull();
    expect(sim.has(0, 'battle', 'CRYMAX ジャオウガ')).toBe(true);
    expect(sim.count(0, 'grave')).toBe(3);
    expect(sim.count(0, 'battle')).toBe(1);
  });
  it('ダイレクトアタックの置換をしなければ、そのまま負ける', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: ['CRYMAX ジャオウガ', '天災 デドダム', 'ヨビニオン・トライブ', '漢気の2号 ボスカツ'], shield: 0 },
      p1: { battle: ['ヨビニオン・マルル'] },
    });
    sim.attack('ヨビニオン・マルル', 'player');
    sim.option(1); // 置換しない
    expect(sim.s.winner).toBe(1);
    expect(sim.count(0, 'grave')).toBe(0);
  });
  it('ダイレクトアタックで負ける時、身代わりにできるカードが3枚に満たなければ置換できず負ける', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: ['CRYMAX ジャオウガ', '天災 デドダム', 'ヨビニオン・トライブ'], mana: mana(4), shield: 0 },
      p1: { battle: ['ヨビニオン・マルル'] },
    });
    sim.attack('ヨビニオン・マルル', 'player');
    // マナゾーンのカードは身代わりにできない(破壊できるのはバトルゾーンのカードだけ)
    expect(sim.s.winner).toBe(1);
  });
  it('S-MAX進化クリーチャーが2体以上いる場合、1体を残して残りを手札に戻す', () => {
    const sim = new Sim({
      p0: { hand: ['CRYMAX ジャオウガ'], mana: mana(7, D), battle: ['CRYMAX ジャオウガ'], shield: 5 },
      p1: { shield: 5 },
    });
    sim.play('CRYMAX ジャオウガ');
    // 出た時の能力が先か、重複解消が先か(状況起因処理が優先)
    let guard = 0;
    while (sim.s.pending && sim.s.pending.why !== 'turnAction' && guard++ < 10) {
      const inp: any = sim.s.pending.input;
      if (sim.s.pending.why === 'keepOne') sim.answer([inp.candidates[0]]);
      else if (sim.s.pending.why === 'replaceChoice') sim.option(1);
      else if (inp.shape === 'pick') sim.answer(inp.candidates.slice(0, inp.min));
      else sim.answer(true);
    }
    expect(sim.count(0, 'battle', 'CRYMAX ジャオウガ')).toBe(1);
  });
});

describe('A12 魔誕の斬将オルゲイト', () => {
  it('ハイパーエナジー: コストが異なるクリーチャーをタップして、1体につきコストを2少なくする', () => {
    const sim = new Sim({
      p0: { hand: ['魔誕の斬将オルゲイト'], mana: mana(3, W), battle: ['ヨビニオン・マルル', '天災 デドダム'] },
      p1: { battle: ['ティンパニ=シンバリー'] },
    });
    expect(sim.canPlay('魔誕の斬将オルゲイト')).toBe(true); // 7-2-2=3
    const pids = [sim.pid(0, 'ヨビニオン・マルル'), sim.pid(0, '天災 デドダム')];
    sim.play('魔誕の斬将オルゲイト', { extra: { tap: pids } });
    expect(sim.tappedMana(0)).toBe(3);
    // 出た時: 任意 → 相手のクリーチャーを手札に戻す(ジャストダイバーと同時に誘発するので順序を選ぶ)
    sim.order('手札に戻す');
    sim.yes();
    expect(sim.has(1, 'hand', 'ティンパニ=シンバリー')).toBe(true);
    const pm = sim.s.players[0].battle.filter((p) => p.tapped).length;
    expect(pm).toBe(2);
  });
  it('コストが同じクリーチャーは同時にタップできない', () => {
    const sim = new Sim({
      p0: { hand: ['魔誕の斬将オルゲイト'], mana: mana(7, W), battle: ['ヨビニオン・マルル', 'ヨビニオン・トライブ'] },
    });
    const pids = [sim.pid(0, 'ヨビニオン・マルル'), sim.pid(0, 'ヨビニオン・トライブ')];
    expect(() => sim.play('魔誕の斬将オルゲイト', { extra: { tap: pids } })).toThrow();
  });
  it('ジャストダイバー: 出た時、次の自分のターンのはじめまで相手に選ばれず、攻撃されない', () => {
    const sim = new Sim({
      p0: { hand: ['魔誕の斬将オルゲイト'], mana: mana(7, W) },
      p1: { battle: ['ヨビニオン・マルル'], hand: ['ヨビニオン・トライブ'], mana: mana(4) },
    });
    sim.play('魔誕の斬将オルゲイト');
    sim.order('手札に戻す');
    sim.no();
    expect(sim.s.effects.some((e) => e.mod.kind === 'cannotBeChosen')).toBe(true);
    sim.endTurn();
    // 相手のターン: タップされたオルゲイトでも攻撃対象にできない
    expect(sim.legal().some((a) => a.type === 'ATTACK' && a.target.kind === 'creature')).toBe(false);
  });
  it('ジャストダイバーは「出た時」にトリガーする能力なので、相手のキーナリーがいるとトリガーしない(公式Q&A 40533)', () => {
    const sim = new Sim({
      p0: { hand: ['魔誕の斬将オルゲイト'], mana: mana(7, W) },
      p1: { battle: ['終末縫合王 ザ=キラー・キーナリー'] },
    });
    sim.play('魔誕の斬将オルゲイト');
    sim.drain();
    const c = mkCtx(sim.s, reg);
    const pm = sim.s.players[0].battle[0];
    expect(sim.s.effects.some((e) => e.mod.kind === 'cannotBeChosen')).toBe(false);
    expect(canBeChosen(c, pm, 1)).toBe(true);
    expect(canBeAttacked(c, pm)).toBe(true);
  });
  it('相手のターン中に相手のクリーチャーが出てその能力がトリガーした時、自分もその能力を使える', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: ['魔誕の斬将オルゲイト'], deck: [N, W, D, 'ダミー', 'ダミー'] },
      p1: { hand: ['天災 デドダム'], mana: [W, D, N], deck: [L, F, N, 'ダミー'] },
    });
    sim.play('天災 デドダム');
    // 相手(ターンプレイヤー)のデドダムの能力が先
    expect(sim.pending.player).toBe(1);
    sim.assign({ hand: [L], mana: [F], grave: [N] });
    // 続いてオルゲイトが使うか確認
    expect(sim.pending.player).toBe(0);
    expect(sim.pending.why).toBe('may');
    sim.yes();
    // コピーした能力は、オルゲイトの持ち主が処理する(自分の山札の上3枚)
    expect(sim.pending.player).toBe(0);
    expect(sim.pending.why).toBe('assign');
    sim.assign({ hand: [N], mana: [W], grave: [D] });
    expect(sim.has(0, 'hand', N)).toBe(true);
    expect(sim.has(0, 'mana', W)).toBe(true);
    expect(sim.has(0, 'grave', D)).toBe(true);
  });
});

describe('A13 終末の監視者 ジ・ウォッチ', () => {
  it('召喚によって出た時、クリーチャーを2体まで選んで手札に戻す', () => {
    const sim = new Sim({
      p0: { hand: ['終末の監視者 ジ・ウォッチ'], mana: mana(10, W) },
      p1: { battle: ['ヨビニオン・マルル', 'ティンパニ=シンバリー', '天災 デドダム'] },
    });
    sim.play('終末の監視者 ジ・ウォッチ');
    expect(sim.pending.why).toBe('select');
    sim.pick('ヨビニオン・マルル', 'ティンパニ=シンバリー');
    expect(sim.count(1, 'hand')).toBe(2);
    expect(sim.count(1, 'battle')).toBe(1);
  });
  it('相手のクリーチャーが出た時、ターンの残りをとばしてもよい', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: ['終末の監視者 ジ・ウォッチ'] },
      p1: { hand: ['ヨビニオン・マルル'], mana: mana(4), battle: [{ c: 'ヨビニオン・トライブ' }], shield: 5 },
    });
    sim.play('ヨビニオン・マルル');
    sim.no(); // ヨビニオン
    // ジ・ウォッチ(p0)の任意能力
    while (sim.s.pending?.why === 'pickNext') sim.order('ターンの残り');
    expect(sim.pending.why).toBe('may');
    expect(sim.pending.player).toBe(0);
    sim.yes();
    // ターンが飛ばされ、相手(p0)のターンになる
    expect(sim.s.active).toBe(0);
    expect(sim.s.step).toBe('mana');
  });
});

describe('A14 逆転の剣スカイソード', () => {
  it('出た時、相手のクリーチャーをマナゾーンに置き、マナからクリーチャーを出す', () => {
    const sim = new Sim({
      p0: { hand: ['逆転の剣スカイソード'], mana: [...mana(10), 'ヨビニオン・マルル'] },
      p1: { battle: ['ティンパニ=シンバリー'] },
    });
    sim.play('逆転の剣スカイソード');
    sim.yes(); // 相手をマナゾーンへ
    expect(sim.has(1, 'mana', 'ティンパニ=シンバリー')).toBe(true);
    sim.yes(); // マナから出す
    expect(sim.has(0, 'battle', 'ヨビニオン・マルル')).toBe(true);
  });
  it('マナゾーンの枚数より小さいコストのクリーチャーだけが対象', () => {
    const sim = new Sim({
      p0: { hand: ['逆転の剣スカイソード'], mana: [...mana(10), '終末の監視者 ジ・ウォッチ'] },
    });
    sim.play('逆転の剣スカイソード');
    sim.no();
    sim.yes();
    // マナ11枚: コスト10(ジ・ウォッチ)は 10 < 11 で対象
    expect(sim.has(0, 'battle', '終末の監視者 ジ・ウォッチ')).toBe(true);
  });
  it('S・トリガーとして使える', () => {
    const sim = new Sim({
      p0: { battle: ['終末縫合王 ザ=キラー・キーナリー'] },
      p1: { shield: ['逆転の剣スカイソード'], battle: ['ティンパニ=シンバリー'] },
    });
    sim.attack('終末縫合王 ザ=キラー・キーナリー', 'player');
    expect(sim.pending.why).toBe('block'); // ブロッカーがいる
    sim.none();
    expect(sim.pending.why).toBe('triggerDeclare');
  });
});

describe('A15 終末縫合王 ザ=キラー・キーナリー', () => {
  it('EXライフ: 出る時に山札の上をシールドにする。離れる時、かわりにそのシールドを墓地に置く', () => {
    const sim = new Sim({
      p0: { hand: ['終末縫合王 ザ=キラー・キーナリー'], mana: [W, D, N, ...mana(7)], shield: 3, deck: 5 },
      p1: { battle: [], hand: ['修羅の死神フミシュナ'] },
    });
    sim.play('終末縫合王 ザ=キラー・キーナリー');
    expect(sim.count(0, 'shield')).toBe(4);
    const ex = sim.s.players[0].shield.filter((u) => sim.s.cards[u].ex);
    expect(ex.length).toBe(1);
  });
  it('離れる時はEXシールドが墓地に置かれ、クリーチャーは残る', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: [{ c: '終末縫合王 ザ=キラー・キーナリー', ex: true }], shield: 3 },
      p1: { hand: ['修羅の死神フミシュナ'], mana: mana(5, W), deck: 5 },
    });
    expect(sim.count(0, 'shield')).toBe(4);
    sim.play('修羅の死神フミシュナ', { face: 1 });
    sim.option(0, 1); // 引く+バウンス(1回)
    expect(sim.has(0, 'battle', '終末縫合王 ザ=キラー・キーナリー')).toBe(true);
    expect(sim.count(0, 'shield')).toBe(3);
    expect(sim.has(0, 'hand', '終末縫合王 ザ=キラー・キーナリー')).toBe(false);
    // 2回目の離脱: EXシールドはもうないので、手札に戻る
    const sim2 = new Sim({
      active: 1,
      p0: { battle: [{ c: '終末縫合王 ザ=キラー・キーナリー', ex: true }], shield: 3 },
      p1: { hand: ['修羅の死神フミシュナ'], mana: mana(5, W), deck: 5 },
    });
    sim2.play('修羅の死神フミシュナ', { face: 1 });
    sim2.option(1, 1);
    expect(sim2.has(0, 'hand', '終末縫合王 ザ=キラー・キーナリー')).toBe(true);
    expect(sim2.count(0, 'shield')).toBe(3);
  });
  it('出た時、相手のクリーチャーを戻し、そのコスト以下のクリーチャーを墓地から出す', () => {
    const sim = new Sim({
      p0: { hand: ['終末縫合王 ザ=キラー・キーナリー'], mana: [W, D, N, ...mana(7)], grave: ['天災 デドダム', 'CRYMAX ジャオウガ'], deck: 5 },
      p1: { battle: ['ヨビニオン・マルル'] },
    });
    sim.play('終末縫合王 ザ=キラー・キーナリー');
    sim.yes(); // 手札に戻す
    expect(sim.has(1, 'hand', 'ヨビニオン・マルル')).toBe(true);
    // マルル(コスト4)以下: デドダムだけ(ジャオウガ7は不可)
    expect(sim.has(0, 'battle', '天災 デドダム')).toBe(true);
  });
  it('戻さなくても、選んだクリーチャーのコスト以下を墓地から出す', () => {
    const sim = new Sim({
      p0: { hand: ['終末縫合王 ザ=キラー・キーナリー'], mana: [W, D, N, ...mana(7)], grave: ['天災 デドダム'], deck: 5 },
      p1: { battle: ['ヨビニオン・マルル'] },
    });
    sim.play('終末縫合王 ザ=キラー・キーナリー');
    sim.no();
    expect(sim.has(1, 'battle', 'ヨビニオン・マルル')).toBe(true);
    expect(sim.has(0, 'battle', '天災 デドダム')).toBe(true);
  });
  it('相手のクリーチャーが出てその能力がトリガーする時、かわりにトリガーしない(自身の「出た時」のみ)', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: ['終末縫合王 ザ=キラー・キーナリー'] },
      p1: { hand: ['天災 デドダム'], mana: [W, D, N], deck: [L, F, N, 'ダミー'] },
    });
    sim.play('天災 デドダム');
    expect(sim.s.pending?.why).toBe('turnAction'); // デドダムの能力は誘発しない
    expect(sim.has(1, 'battle', '天災 デドダム')).toBe(true);
    expect(sim.count(1, 'hand')).toBe(0);
  });
  it('他のクリーチャーの能力が誘発させる効果は止めない(シンバリーの2体目)', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: ['終末縫合王 ザ=キラー・キーナリー'] },
      p1: { hand: ['ヨビニオン・トライブ', 'ヨビニオン・トライブ'], mana: mana(8), battle: ['ティンパニ=シンバリー', 'ヨビニオン・マルル'], deck: 5 },
    });
    sim.play('ヨビニオン・トライブ');
    // 1体目: トライブ自身のヨビニオンは、自身の「出た時」なので止まる
    expect(sim.s.pending?.why).toBe('turnAction');
    sim.play('ヨビニオン・トライブ');
    // 2体目: シンバリー・マルルの能力は、別のクリーチャーが出て誘発したものなので止まらない
    expect(sim.s.pending?.why).not.toBe('turnAction');
  });
});

describe('B4 王道の革命 ドギラゴン', () => {
  it('出た時、山札の上2枚をマナに置き、マナのクリーチャーを1体手札に戻す', () => {
    const sim = new Sim({
      p0: { hand: [F], mana: [L, D, F, N, N], deck: ['ヨビニオン・マルル', 'ダミー', 'ダミー'] },
    });
    sim.play(F);
    expect(sim.pending.why).toBe('select');
    sim.pick('ヨビニオン・マルル');
    expect(sim.has(0, 'hand', 'ヨビニオン・マルル')).toBe(true);
    expect(sim.count(0, 'mana')).toBe(6);
  });
  it('革命2: シールドが2つ以下(ブレイク後)なら、シールドから手札に加わる時にS・トリガーを得る', () => {
    const sim = new Sim({ p1: { shield: [F, 'ダミー', 'ダミー'] } });
    const c = mkCtx(sim.s, reg);
    const uid = sim.s.players[1].shield[0];
    // 1枚ブレイク中(残り2枚)
    sim.s.breaking = [uid];
    expect(declaration(c, uid)?.kind).toBe('shieldTrigger');
    // 残りが3枚以上になる場合は S・トリガーにならない
    const sim2 = new Sim({ p1: { shield: [F, 'ダミー', 'ダミー', 'ダミー'] } });
    const c2 = mkCtx(sim2.s, reg);
    const uid2 = sim2.s.players[1].shield[0];
    sim2.s.breaking = [uid2];
    expect(declaration(c2, uid2)).toBeNull();
  });
  it('革命0: シールドが0枚ならパワー+10000で、バトルに勝つとアンタップする', () => {
    const sim = new Sim({
      p0: { battle: [F], shield: 0 },
      p1: { battle: [{ c: '終末の監視者 ジ・ウォッチ', tapped: true }] },
    });
    sim.attack(F, '終末の監視者 ジ・ウォッチ'); // 15000 vs 12000
    expect(sim.has(1, 'grave', '終末の監視者 ジ・ウォッチ')).toBe(true);
    expect(sim.s.players[0].battle[0].tapped).toBe(false);
  });
  it('革命0でなければ勝てない', () => {
    const sim = new Sim({
      p0: { battle: [F], shield: 5 },
      p1: { battle: [{ c: '終末の監視者 ジ・ウォッチ', tapped: true }] },
    });
    sim.attack(F, '終末の監視者 ジ・ウォッチ'); // 5000 vs 12000
    expect(sim.has(0, 'grave', F)).toBe(true);
  });
});

describe('B5 漢気の2号 ボスカツ', () => {
  it('出た時、相手の手札を捨てさせ、同じ文明の多色クリーチャーを手札から出してもよい', () => {
    const sim = new Sim({
      p0: { hand: ['漢気の2号 ボスカツ', F], mana: [L, D, F, N, N] },
      p1: { hand: ['ダミー'] },
    });
    sim.play('漢気の2号 ボスカツ');
    expect(sim.has(1, 'grave', 'ダミー')).toBe(true);
    // ダミー(光)と文明が同じ(光を持つ)多色クリーチャー: ドギラゴン
    expect(sim.pending.why).toBe('select');
    sim.pick(F);
    expect(sim.has(0, 'battle', F)).toBe(true);
  });
  it('捨てさせたカードと文明が合わなければ出せない', () => {
    const sim = new Sim({
      p0: { hand: ['漢気の2号 ボスカツ', '天災 デドダム'], mana: [L, D, F, N, N] },
      p1: { hand: ['ダミー'] },
    });
    sim.play('漢気の2号 ボスカツ');
    expect(sim.s.pending?.why).toBe('turnAction');
    expect(sim.has(0, 'hand', '天災 デドダム')).toBe(true);
  });
});

describe('B6 魔誕と光喜と楽識と炎怒と哀樹の決断', () => {
  it('5つから2回選べる(同じものも可)', () => {
    const sim = new Sim({
      p0: { hand: ['魔誕と光喜と楽識と炎怒と哀樹の決断'], mana: [W, D, L, F, N], deck: 8 },
    });
    sim.play('魔誕と光喜と楽識と炎怒と哀樹の決断');
    const inp: any = sim.pending.input;
    expect(inp.pick).toBe(2);
    expect(inp.repeat).toBe(true);
    expect(inp.allIf).toBe(false);
    sim.option(1, 1); // 2枚引く ×2
    expect(sim.count(0, 'hand')).toBe(4);
  });
  it('エレメントにすべての文明がそろっていれば、5つすべてを1回ずつ使ってもよい', () => {
    const sim = new Sim({
      p0: {
        hand: ['魔誕と光喜と楽識と炎怒と哀樹の決断'],
        mana: [W, D, L, F, N],
        battle: [F, '天災 デドダム'],
        deck: 8,
        shield: 3,
      },
      p1: { hand: [N, N], battle: ['ヨビニオン・マルル'] },
    });
    sim.play('魔誕と光喜と楽識と炎怒と哀樹の決断');
    const inp: any = sim.pending.input;
    expect(inp.allIf).toBe(true);
    sim.option(0, 1, 2, 3, 4);
    expect(sim.count(0, 'shield')).toBe(4); // シールド追加
    expect(sim.count(1, 'hand')).toBe(1); // 1枚捨てさせた
    expect(sim.has(1, 'grave', 'ヨビニオン・マルル')).toBe(true); // コスト6以下を破壊
  });
});

describe('B7 ドラゴンズ・サイン', () => {
  it('手札から光のドラゴンで進化でないコスト7以下を出し、次の自分のターンのはじめまでブロッカーを得る', () => {
    const sim = new Sim({ p0: { hand: [L, F], mana: [L, N, N, N, N] } });
    sim.play(L);
    sim.drain(); // ドギラゴンの出た時の選択
    expect(sim.has(0, 'battle', F)).toBe(true);
    expect(sim.s.effects.some((e) => e.mod.kind === 'grant' && e.mod.keyword === 'blocker')).toBe(true);
    sim.endTurn();
    expect(sim.s.effects.length).toBe(1); // 相手のターン中も有効
    sim.skipMana().endTurn();
    expect(sim.s.effects.length).toBe(0); // 次の自分のターンのはじめに失効
  });
  it('進化クリーチャーや7より大きいコストは出せない', () => {
    const sim = new Sim({ p0: { hand: [L, 'SSS級天災 デッドダムド'], mana: [L, N, N, N, N] } });
    sim.play(L);
    sim.drain();
    expect(sim.count(0, 'battle')).toBe(0);
  });
});

describe('B9 ブレイン・スラッシュ', () => {
  it('水と闇がそろっていれば、両方を選べる(上から順に処理)', () => {
    const sim = new Sim({
      p0: { hand: ['ブレイン・スラッシュ'], mana: [W, D, N, N, N, N], battle: ['天災 デドダム'], grave: ['ヨビニオン・マルル'], deck: 8 },
    });
    sim.play('ブレイン・スラッシュ');
    const inp: any = sim.pending.input;
    expect(inp.allIf).toBe(true);
    sim.option(0, 1);
    // カードを3枚引き、手札を1枚捨てる(選択)
    expect(sim.pending.why).toBe('select');
    const first = sim.s.players[0].hand[0];
    sim.answer([first]);
    expect(sim.count(0, 'hand')).toBe(2);
    expect(sim.has(0, 'battle', 'ヨビニオン・マルル')).toBe(true);
  });
  it('そろっていなければ、どちらか1つ', () => {
    const sim = new Sim({
      p0: { hand: ['ブレイン・スラッシュ'], mana: [W, D, N, N, N, N], battle: ['ヨビニオン・マルル'], grave: ['天災 デドダム'] },
    });
    sim.play('ブレイン・スラッシュ');
    const inp: any = sim.pending.input;
    expect(inp.allIf).toBe(false);
    expect(() => sim.option(0, 1)).toThrow();
    sim.option(1);
    expect(sim.has(0, 'battle', '天災 デドダム')).toBe(true);
  });
});

describe('B10 龍風混成 ザーディクリカ', () => {
  it('出た時、手札の呪文を無料で唱え、山札の下に置く', () => {
    const sim = new Sim({
      p0: { hand: ['龍風混成 ザーディクリカ', N], mana: [L, W, F, N, N, N, N], deck: [W, 'ダミー', 'ダミー'] },
    });
    sim.play('龍風混成 ザーディクリカ');
    expect(sim.pending.why).toBe('may');
    sim.yes();
    expect(sim.has(0, 'mana', W)).toBe(true); // ブースト
    const deck = sim.s.players[0].deck;
    expect(sim.s.cards[deck[deck.length - 1]].defId).toBe('dmrp01-093'); // 山札の下
    expect(sim.has(0, 'grave', N)).toBe(false);
  });
  it('墓地の呪文も唱えられる(コスト7以下)', () => {
    const sim = new Sim({
      p0: { hand: ['龍風混成 ザーディクリカ'], mana: [L, W, F, N, N, N, N], grave: [N], deck: [W, 'ダミー'] },
    });
    sim.play('龍風混成 ザーディクリカ');
    sim.yes();
    expect(sim.has(0, 'mana', W)).toBe(true);
  });
  it('ターン終了時、そのターンに呪文を唱えていれば、パワー5500以下を破壊し、カードを引いてもよい', () => {
    const sim = new Sim({
      p0: { battle: [{ c: '龍風混成 ザーディクリカ', ex: true }], hand: [N], mana: mana(3), deck: 5 },
      p1: { battle: ['ヨビニオン・マルル', 'CRYMAX ジャオウガ'] },
    });
    sim.play(N);
    sim.endTurn();
    expect(sim.has(1, 'grave', 'ヨビニオン・マルル')).toBe(true);
    expect(sim.has(1, 'battle', 'CRYMAX ジャオウガ')).toBe(true);
    expect(sim.pending.why).toBe('may');
    sim.yes();
    expect(sim.count(0, 'hand')).toBe(1);
  });
  it('呪文を唱えていなければ働かない', () => {
    const sim = new Sim({
      p0: { battle: [{ c: '龍風混成 ザーディクリカ', ex: true }], deck: 5 },
      p1: { battle: ['ヨビニオン・マルル'] },
    });
    sim.endTurn();
    expect(sim.has(1, 'battle', 'ヨビニオン・マルル')).toBe(true);
  });
});

describe('B12 聖魔連結王 ドルファディロム', () => {
  it('出た時、相手の多色でないクリーチャーをすべて破壊する', () => {
    const sim = new Sim({
      p0: { hand: ['聖魔連結王 ドルファディロム'], mana: [L, D, F, N, N, N, N, N], deck: 5 },
      p1: { battle: ['ヨビニオン・マルル', '天災 デドダム', 'ティンパニ=シンバリー'] },
    });
    sim.play('聖魔連結王 ドルファディロム');
    expect(sim.has(1, 'grave', 'ヨビニオン・マルル')).toBe(true);
    expect(sim.has(1, 'grave', 'ティンパニ=シンバリー')).toBe(true);
    expect(sim.has(1, 'battle', '天災 デドダム')).toBe(true);
  });
  it('相手は多色でない呪文を唱えられない', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: ['聖魔連結王 ドルファディロム'] },
      p1: { hand: [N, 'ドンドン火噴くナウ'], mana: [W, F, N, N, N, N] },
    });
    expect(sim.canPlay(N)).toBe(false);
    expect(sim.canPlay('ドンドン火噴くナウ')).toBe(true);
  });
  it('EXライフのシールドが離れた時にも、多色でないクリーチャーをすべて破壊する', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: [{ c: '聖魔連結王 ドルファディロム', ex: true }], shield: 0 },
      p1: { battle: ['ヨビニオン・マルル', '天災 デドダム'] },
    });
    sim.attack('ヨビニオン・マルル', 'player');
    expect(sim.has(1, 'grave', 'ヨビニオン・マルル')).toBe(true);
    expect(sim.has(1, 'battle', '天災 デドダム')).toBe(true);
  });
});

describe('B13 SSS級天災 デッドダムド', () => {
  it('進化: 水・闇・自然のクリーチャーの上に置け、重なった時に相手のクリーチャーを破壊できる', () => {
    const sim = new Sim({
      p0: { hand: ['SSS級天災 デッドダムド'], mana: [W, W, W, D, D, N, N, N], battle: ['天災 デドダム'] },
      p1: { battle: ['ヨビニオン・マルル'] },
    });
    const pid = sim.pid(0, '天災 デドダム');
    expect(sim.canPlay('SSS級天災 デッドダムド')).toBe(true);
    sim.play('SSS級天災 デッドダムド', { extra: { onto: pid } });
    expect(sim.s.players[0].battle.length).toBe(1);
    expect(sim.s.players[0].battle[0].cards.length).toBe(2);
    sim.option(0); // 破壊する
    expect(sim.has(1, 'grave', 'ヨビニオン・マルル')).toBe(true);
  });
  it('進化元がなければ召喚できない', () => {
    const sim = new Sim({ p0: { hand: ['SSS級天災 デッドダムド'], mana: [W, W, W, D, D, N, N, N] } });
    expect(sim.canPlay('SSS級天災 デッドダムド')).toBe(false);
  });
  it('SSS級侵略: 水・闇・自然のコマンドが攻撃する時、手札から攻撃クリーチャーの上に重ねてもよい', () => {
    const sim = new Sim({
      p0: { battle: ['天災 デドダム'], hand: ['SSS級天災 デッドダムド'] },
      p1: { battle: ['ヨビニオン・マルル'], shield: 5 },
    });
    sim.attack('天災 デドダム', 'player');
    expect(sim.pending.why).toBe('may');
    sim.yes();
    // 重なった時の能力
    expect(sim.s.players[0].battle[0].cards.length).toBe(2);
    sim.option(2); // 手札に戻す
    expect(sim.has(1, 'hand', 'ヨビニオン・マルル')).toBe(true);
    // 攻撃は続く。デッドダムド(W・ブレイカー)で2枚割る
    expect(sim.count(1, 'shield')).toBe(3);
  });
  it('侵略はバトルゾーンの別のクリーチャーの山からも行える(「出た」扱いにならない)', () => {
    const sim = new Sim({
      p0: { battle: ['天災 デドダム', { c: 'SSS級天災 デッドダムド', under: ['ヨビニオン・マルル'] }] },
      p1: { battle: ['ティンパニ=シンバリー'], shield: 5 },
    });
    // 場のデッドダムドを、攻撃するデドダムの上に移動できる
    sim.attack('天災 デドダム', 'player');
    expect(sim.pending.why).toBe('may');
    const before = sim.evs('entered').length;
    sim.yes();
    expect(sim.evs('entered').length).toBe(before); // entered は発行されない
    expect(sim.evs('evolved').length).toBe(1);
  });
});

describe('配球の超人 / 記録的剛球', () => {
  it('クリーチャー面: 出た時、相手のクリーチャー1体を選んでマナゾーンに置く(強制)。T・ブレイカー', () => {
    const sim = new Sim({
      p0: { hand: ['配球の超人'], mana: mana(8) },
      p1: { battle: ['ティンパニ=シンバリー'] },
    });
    sim.play('配球の超人');
    expect(sim.has(1, 'mana', 'ティンパニ=シンバリー')).toBe(true);
    expect(sim.count(1, 'battle')).toBe(0);
    expect(sim.has(0, 'battle', '配球の超人')).toBe(true);
  });
  it('呪文面: コスト2の自然の呪文として唱えられ、山札の上1枚をブーストする', () => {
    const sim = new Sim({ p0: { hand: ['配球の超人'], mana: mana(2), deck: [W, 'ダミー'] } });
    expect(sim.canPlay('配球の超人')).toBe(true);
    sim.play('配球の超人', { face: 1 });
    expect(sim.has(0, 'mana', W)).toBe(true);
    expect(sim.has(0, 'grave', '配球の超人')).toBe(true);
    expect(sim.count(0, 'battle')).toBe(0);
  });
});
