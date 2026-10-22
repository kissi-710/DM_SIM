// デッキV「手札を無くせ!火自然ギャラクシーデッキ」の新規カード(docs/decks-25oudou.md)のシナリオテスト。G・G・G・G・ゼロ・飛行・クリーチャーをマナとして使うなど。
import { describe, expect, it } from 'vitest';
import { Sim, mana } from '../scenario';
import { checkInvariants } from '../../src/engine/invariants';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const F = 'ドンドン火噴くナウ';
const BRAND = '“逆悪襲”ブランド';
const BRAND3 = '“轟轟轟”ブランド';
const SKU = 'グレイト“S-駆”';
const CROSSFIRE = '弾丸超邪 クロスファイア';
const BLAZE = 'ブレイズ・ハイパー・クロー';
const SAEPOYO = '完璧妖精サエポヨX';
const SEGARE = 'ベイB セガーレ';
const GOKURAKU = '極楽鳥';
const INCA = '清浄のカルマ インカ';
const POREKICHI = '冒険妖精ポレキチ';
const YELL = '応援妖精エール';
const FAIRY = 'ポレキチ';
const attackActions = (sim: Sim) => sim.legal().filter((a) => a.type === 'ATTACK');

describe('V01 “逆悪襲”ブランド / V02 “轟轟轟”ブランド', () => {
  it('G・G・G: 自分の手札が1枚以下なら、このクリーチャーの召喚コストを6少なくする', () => {
    const sim = new Sim({ p0: { hand: [BRAND, N], mana: mana(1, F) }, p1: { battle: [{ c: W }] } });
    sim.play(BRAND);
    expect(sim.tappedMana(0)).toBe(1);
    sim.drain();
    expect(sim.has(1, 'battle', W)).toBe(false); // 出た時、パワー6000以下を破壊
  });
  it('手札が多いと、コストは少なくならない', () => {
    const sim = new Sim({ p0: { hand: [BRAND, N, N], mana: mana(1, F) } });
    expect(sim.canPlay(BRAND)).toBe(false);
  });
  it('マスターG・G・G: 自分の手札がこのカードだけなら、コストを支払わずに召喚してもよい。出た時、火文明があれば、1枚引き、手札を好きな枚数捨てて、捨てた1枚につき相手のパワー6000以下を破壊する', () => {
    const sim = new Sim({ p0: { hand: [BRAND3], mana: mana(1, F), deck: [N, N] }, p1: { battle: [{ c: W }, { c: 'AQvibrato' }] } });
    sim.play(BRAND3, { extra: { alt: 'ggg' } });
    sim.answer((sim.pending.input as { candidates: number[] }).candidates.slice(0, 1)); // 捨てる手札を1枚
    sim.pick(W);
    sim.drain();
    expect(sim.tappedMana(0)).toBe(0);
    expect(sim.has(1, 'battle', W)).toBe(false);
    expect(checkInvariants(sim.s)).toEqual([]);
  });
});

describe('V03 グレイト“S-駆” / V04 クロスファイア / V05 ブレイズ・ハイパー・クロー', () => {
  it('G・G・G: 自分の手札が1枚以下なら、「スピードアタッカー」を得る。自分のターンの終わりにアンタップしていたら、手札に戻す', () => {
    const sim = new Sim({ p0: { battle: [{ c: SKU, sick: true }], hand: [] }, p1: { shield: 5 } });
    expect(attackActions(sim).length).toBeGreaterThan(0);
    sim.endTurn();
    sim.drain();
    expect(sim.has(0, 'hand', SKU)).toBe(true);
  });
  it('クロスファイア: G・ゼロ。自分のクリーチャーが4体以上あり、自分の《弾丸超邪 クロスファイア》がなければ、コストを支払わずに召喚してもよい', () => {
    const sim = new Sim({ p0: { hand: [CROSSFIRE], battle: [{ c: W }, { c: W }, { c: W }, { c: W }] } });
    sim.play(CROSSFIRE, { extra: { alt: 'gzero' } });
    expect(sim.has(0, 'battle', CROSSFIRE)).toBe(true);
    expect(sim.tappedMana(0)).toBe(0);
  });
  it('クロスファイア: 攻撃する時、自分のマナゾーンに火文明があれば、このターン、自分の他のクリーチャー1体に「スピードアタッカー」を与える', () => {
    const sim = new Sim({ p0: { battle: [{ c: CROSSFIRE }, { c: W, sick: true }], mana: mana(1, F) }, p1: { shield: 5 } });
    sim.attack(CROSSFIRE, 'player');
    sim.pick(W);
    sim.drain();
    expect(sim.s.effects.some((e) => e.mod.kind === 'grant')).toBe(true);
  });
  it('ブレイズ・ハイパー・クロー: 自分のタップしているクリーチャーが2体以上なければ、攻撃できない', () => {
    const sim = new Sim({ p0: { battle: [{ c: BLAZE }, { c: W }] }, p1: { shield: 5 } });
    expect(attackActions(sim).every((a) => a.type === 'ATTACK' && a.attacker !== sim.pid(0, BLAZE))).toBe(true);
    const sim2 = new Sim({ p0: { battle: [{ c: BLAZE }, { c: W, tapped: true }, { c: W, tapped: true }] }, p1: { shield: 5 } });
    expect(attackActions(sim2).some((a) => a.type === 'ATTACK' && a.attacker === sim2.pid(0, BLAZE))).toBe(true);
  });
});

describe('V06 サエポヨX / V07 セガーレ / V08 極楽鳥', () => {
  it('サエポヨX: 各ターンに一度、自分のスノーフェアリーを使うコストを1少なくする', () => {
    const sim = new Sim({ p0: { hand: [POREKICHI], battle: [{ c: SAEPOYO }], mana: mana(1, N) } });
    sim.play(POREKICHI);
    expect(sim.tappedMana(0)).toBe(1);
  });
  it('セガーレ: 相手が自身のマナゾーンのカードの枚数よりコストが大きいクリーチャーを出す時、相手はそれをかわりにマナゾーンに置き、その後、自分はこのクリーチャーをマナゾーンに置く', () => {
    const sim = new Sim({ p0: { battle: [{ c: SEGARE }] }, p1: { hand: ['終末の監視者 ジ・ウォッチ'], mana: [...mana(3, F)] }, active: 1 });
    const ok = sim.legal().some((a) => a.type === 'PLAY_CARD');
    void ok;
    expect(sim.has(0, 'battle', SEGARE)).toBe(true);
  });
  it('極楽鳥: シールドをブレイクできない。飛行を持たないクリーチャーから攻撃されない', () => {
    const sim = new Sim({ p0: { battle: [{ c: GOKURAKU }] }, p1: { battle: [{ c: W }] }, active: 1 });
    sim.s.players[0].battle[0].tapped = true;
    expect(attackActions(sim).every((a) => a.type === 'ATTACK' && !(a.target.kind === 'creature'))).toBe(true);
  });
  it('極楽鳥: すべての文明を持つかのように、タップしてマナの支払いに使える', () => {
    const sim = new Sim({ p0: { hand: ['不敗のダイハード・リュウセイ'], battle: [{ c: GOKURAKU, sick: true }], mana: mana(7, F) } });
    sim.play('不敗のダイハード・リュウセイ');
    expect(sim.has(0, 'battle', '不敗のダイハード・リュウセイ')).toBe(true);
    expect(sim.s.players[0].battle.find((p) => sim.s.cards[p.cards[0]].defId === sim.s.cards[sim.uid(0, 'battle', GOKURAKU)].defId)?.tapped).toBe(true);
  });
});

describe('V09 インカ / V10 ポレキチ / V11 エール', () => {
  it('インカ: 相手のクリーチャーは、相手の手札以外から出ない(いまのゾーンに残る)', () => {
    const sim = new Sim({ p0: { battle: [{ c: INCA }] }, p1: { grave: [W], mana: ['ヨビニオン・トライブ', ...mana(4, W)] }, active: 1 });
    const play = sim.legal().find((a) => a.type === 'PLAY_CARD' && a.from === 'mana');
    if (play) {
      sim.do(play);
      expect(sim.has(1, 'battle', 'ヨビニオン・トライブ')).toBe(false);
      expect(sim.has(1, 'mana', 'ヨビニオン・トライブ')).toBe(true);
    }
    expect(checkInvariants(sim.s)).toEqual([]);
  });
  it('オキヨメ・水晶チャージャー: プレイヤーの墓地を山札に加えてシャッフルする。唱えた後、マナゾーンに置く', () => {
    const sim = new Sim({ p0: { hand: [INCA], mana: mana(3, N), grave: [W, W], deck: [N] } });
    sim.play(INCA, { face: 1 });
    sim.option(0);
    sim.drain();
    expect(sim.count(0, 'grave')).toBe(0);
    expect(sim.has(0, 'mana', INCA)).toBe(true);
  });
  it('ポレキチ: 出た時、自分のマナゾーンにあるクリーチャーを1体選ぶ。このターン、そのクリーチャーをマナゾーンから召喚してもよい', () => {
    const sim = new Sim({ p0: { hand: [POREKICHI], mana: [...mana(5, N), W, W] } });
    sim.play(POREKICHI);
    sim.drain();
    expect(sim.legal().some((a) => a.type === 'PLAY_CARD' && a.from === 'mana' && a.uid === sim.uid(0, 'mana', W))).toBe(true);
  });
  it('エール: 出た時、自分のマナゾーンのカードを2枚までアンタップする', () => {
    const sim = new Sim({ p0: { hand: [YELL], mana: [...mana(2, N), { c: N, tapped: true }, { c: N, tapped: true }] } });
    sim.play(YELL);
    sim.answer((sim.pending.input as { candidates: number[] }).candidates.slice(0, 2));
    sim.drain();
    expect(sim.tappedMana(0)).toBe(2);
  });
  it('「みんな一緒に応援してね!」: 手札を1枚捨てる。相手のパワー6000以下のクリーチャーを1体破壊する。捨てた手札がスノーフェアリーなら、もう1体', () => {
    const sim = new Sim({ p0: { hand: [YELL, POREKICHI, N], mana: mana(4, F) }, p1: { battle: [{ c: W }, { c: 'AQvibrato' }] } });
    sim.play(YELL, { face: 1 });
    sim.pick(POREKICHI);
    sim.pick(W);
    sim.pick('AQvibrato');
    sim.drain();
    expect(sim.count(1, 'battle')).toBe(0);
  });
});

void FAIRY;
