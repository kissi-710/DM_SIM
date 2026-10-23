// デッキG「輝けボルシャック！火光アーマードデッキ」の新規カード(docs/decks-25oudou.md)のシナリオテスト。
import { describe, expect, it } from 'vitest';
import { Sim, mana } from '../scenario';
import { powerOf } from '../../src/engine/derive';
import { mkCtx } from '../../src/engine/state';
import { reg } from '../scenario';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const L = 'ドラゴンズ・サイン';
const F = 'ドンドン火噴くナウ'; // 水火自然
const LF = 'チャラ・ルピア'; // 光火
const power = (sim: Sim, p: 0 | 1, name: string) => powerOf(mkCtx(sim.s, reg), sim.s.players[p].battle.find((x) => x.pid === sim.pid(p, name))!);

describe('G01 光鎧龍ホーリーグレイス', () => {
  it('出た時、相手のクリーチャーをすべてタップする', () => {
    const sim = new Sim({ p0: { hand: ['光鎧龍ホーリーグレイス'], mana: [L, L, L, L, L, L] }, p1: { battle: [{ c: W }, { c: W }] } });
    sim.play('光鎧龍ホーリーグレイス');
    expect(sim.s.players[1].battle.every((p) => p.tapped)).toBe(true);
  });
  it('相手のターンに出た時、そのターンに2つ以上シールドがブレイクされていなければ破壊される', () => {
    const sim = new Sim({ p0: { shield: ['光鎧龍ホーリーグレイス'] }, p1: { battle: [{ c: W }] }, active: 1 });
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, W), target: { kind: 'player' } });
    sim.pick('光鎧龍ホーリーグレイス');
    sim.drain();
    expect(sim.has(0, 'battle', '光鎧龍ホーリーグレイス')).toBe(false);
  });
});

describe('G02 超竜ヴァルキリアス / G03 ボルメテウス・サファイア・ドラゴン', () => {
  it('アーマード・ドラゴンの上に進化し、出た時にマナゾーンからドラゴンを出せる', () => {
    const sim = new Sim({
      p0: { hand: ['超竜ヴァルキリアス'], battle: [{ c: 'GENJI・ハイパーXX' }], mana: [...mana(8, 'ドンドン火噴くナウ'), 'ボルメテウス・サファイア・ドラゴン'] },
    });
    const evo = sim.legal().find((a) => a.type === 'PLAY_CARD' && sim.s.cards[a.uid].defId === 'dm26sd1-G02');
    expect(evo).toBeDefined();
    sim.do(evo!);
    sim.use(); // マナゾーンのサファイアを出す
    expect(sim.has(0, 'battle', 'ボルメテウス・サファイア・ドラゴン')).toBe(true);
  });
  it('サファイア: 攻撃中はパワー+3000(パワーアタッカー)。ブレイクしたシールドは、手札ではなく墓地に置かれる', () => {
    const sim = new Sim({ p0: { battle: [{ c: 'ボルメテウス・サファイア・ドラゴン' }] }, p1: { shield: 5 } });
    expect(power(sim, 0, 'ボルメテウス・サファイア・ドラゴン')).toBe(11000);
    sim.attack('ボルメテウス・サファイア・ドラゴン', 'player');
    expect(sim.count(1, 'shield')).toBe(2);
    expect(sim.count(1, 'hand')).toBe(0);
    expect(sim.count(1, 'grave')).toBe(3);
  });
  it('パワーアタッカーは、攻撃中だけ', () => {
    const sim = new Sim({ p0: { battle: [{ c: 'アシスター・コッピ' }] }, p1: { battle: [{ c: W, tapped: true }] } });
    expect(power(sim, 0, 'アシスター・コッピ')).toBe(3000);
    const pid = sim.pid(0, 'アシスター・コッピ');
    sim.do({ type: 'ATTACK', attacker: pid, target: { kind: 'creature', pid: sim.pid(1, W) } });
    // バトルに勝って終わる(パワー3000+2000 > 2000)。攻撃が終わると元に戻る
    expect(power(sim, 0, 'アシスター・コッピ')).toBe(3000);
  });
});

describe('G05 アシスター・コッピ / G07 チャラ・ルピア', () => {
  it('コッピ: 各ターンに1度、アーマードを使うコストを1少なくする(2枚目は少なくならない)', () => {
    const sim = new Sim({
      p0: { hand: ['GENJI・ハイパーXX', 'GENJI・ハイパーXX'], battle: [{ c: 'アシスター・コッピ' }], mana: mana(12, 'ドンドン火噴くナウ') },
    });
    sim.play('GENJI・ハイパーXX'); // 5 - 1 = 4
    expect(sim.tappedMana(0)).toBe(4);
    sim.play('GENJI・ハイパーXX'); // 5(その2枚目は軽減されない)
    expect(sim.tappedMana(0)).toBe(4 + 5);
  });
  it('チャラ・ルピア: 自分のドラゴンの召喚コストを2少なくする', () => {
    const sim = new Sim({ p0: { hand: ['ボルシャック・ヴォルジャアク'], battle: [{ c: LF }], mana: [L, F, F, F, F] } });
    expect(sim.canPlay('ボルシャック・ヴォルジャアク')).toBe(true); // 7 - 2 = 5
  });
});

describe('G06 竜皇神 ボルシャック・バクテラス', () => {
  it('革命チェンジ: コスト7以上の、名前に《ボルシャック》とある多色クリーチャーの攻撃中に入れ替わる', () => {
    const sim = new Sim({
      p0: { hand: ['竜皇神 ボルシャック・バクテラス'], battle: [{ c: 'ボルシャック・ヴォルジャアク' }], deck: [N, N, N, N, N, N] },
    });
    sim.attack('ボルシャック・ヴォルジャアク', 'player');
    sim.yes();
    expect(sim.has(0, 'battle', '竜皇神 ボルシャック・バクテラス')).toBe(true);
  });
  it('出た時、山札の上4枚から、バクテラス以外のアーマードを好きな数出し、残りを山札の下に置く', () => {
    const sim = new Sim({
      p0: { hand: ['竜皇神 ボルシャック・バクテラス'], battle: [{ c: 'ボルシャック・ヴォルジャアク' }], deck: ['GENJI・ハイパーXX', 'アシスター・コッピ', N, N, N, N] },
    });
    sim.attack('ボルシャック・ヴォルジャアク', 'player');
    sim.yes();
    sim.pick('GENJI・ハイパーXX', 'アシスター・コッピ');
    expect(sim.has(0, 'battle', 'GENJI・ハイパーXX')).toBe(true);
    expect(sim.has(0, 'battle', 'アシスター・コッピ')).toBe(true);
  });
  it('自分の他のクリーチャーにブロッカーとスピードアタッカーを与える', () => {
    const sim = new Sim({ p0: { battle: [{ c: '竜皇神 ボルシャック・バクテラス' }, { c: W, sick: true }] } });
    const legal = sim.legal().filter((a) => a.type === 'ATTACK' && a.target.kind === 'player').map((a) => (a.type === 'ATTACK' ? a.attacker : -1));
    expect(legal).toContain(sim.pid(0, W)); // スピードアタッカー
  });
});

describe('G08 ボルシャック・ヴォルジャアク', () => {
  it('各ターンに1度、クリーチャーが出た時、山札の上1枚目をシールド化してもよい', () => {
    const sim = new Sim({ p0: { hand: [N, N], battle: [{ c: 'ボルシャック・ヴォルジャアク' }], mana: [N, N], deck: [W, W, W, W] } });
    sim.play(N);
    expect(sim.count(0, 'shield')).toBe(5); // 5 のまま(フェアリー・ライフは呪文で、クリーチャーではない)
    const sim2 = new Sim({ p0: { hand: ['チャラ・ルピア'], battle: [{ c: 'ボルシャック・ヴォルジャアク' }], mana: [L, F], deck: [W, W, W, W] } });
    sim2.play('チャラ・ルピア');
    sim2.yes();
    expect(sim2.count(0, 'shield')).toBe(6);
    // 各ターンに1度だけ
    expect(sim2.s.pending?.why).toBe('turnAction');
  });
  it('終極宣言: 自分のターンのはじめに、自分のシールドをすべてブレイクしてもよい。そうしたら、次の自分のターンのはじめまで負けない', () => {
    const sim = new Sim({
      p0: { battle: [{ c: 'ボルシャック・ヴォルジャアク' }], shield: 3 },
      p1: { battle: [{ c: W }], shield: 5 },
      active: 1,
    });
    sim.endTurn();
    expect(sim.pending.why).toBe('may');
    sim.yes();
    sim.drain();
    expect(sim.count(0, 'shield')).toBe(0);
    expect(sim.s.effects.some((e) => e.mod.kind === 'cannotLose')).toBe(true);
  });
  it('負けない効果の間は、ダイレクトアタックを受けても負けない', () => {
    const sim = new Sim({
      p0: { battle: [{ c: 'ボルシャック・ヴォルジャアク' }], shield: 0 },
      p1: { battle: [{ c: W }] },
      active: 1,
    });
    sim.s.effects.push({ id: 99, pid: -1, mod: { kind: 'cannotLose' }, until: { kind: 'untilTurnStart', player: 0, afterTurn: 5 }, controller: 0 });
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, W), target: { kind: 'player' } });
    sim.drain();
    expect(sim.s.winner).toBeNull();
  });
});

describe('G09 輝く革命 ボルシャック・フレア / G10 飛ぶ革命 ヴァル・ボルシャック', () => {
  it('各ターン、はじめて自分のクリーチャーがバトルする時、そのクリーチャーはそのバトルに勝つ', () => {
    const sim = new Sim({
      p0: { battle: [{ c: '輝く革命 ボルシャック・フレア' }, { c: W }] },
      p1: { battle: [{ c: '流星のガイアッシュ・カイザー', tapped: true }, { c: '終末の監視者 ジ・ウォッチ', tapped: true }] },
    });
    // アクアン(2000)が、ガイアッシュ(8000)にバトルを仕掛けて勝つ(はじめてのバトル)
    sim.s.players[0].battle[1].sick = false;
    sim.attack(W, '流星のガイアッシュ・カイザー');
    expect(sim.has(1, 'battle', '流星のガイアッシュ・カイザー')).toBe(false);
    expect(sim.has(0, 'battle', W)).toBe(true);
    // 2回目は、普通のバトル
    sim.s.players[0].battle[0].tapped = false;
    sim.attack('輝く革命 ボルシャック・フレア', '終末の監視者 ジ・ウォッチ');
    expect(sim.has(0, 'battle', '輝く革命 ボルシャック・フレア')).toBe(false); // 10500 < 12000
  });
  it('各ターン、はじめて出る相手のクリーチャーは、タップして出る', () => {
    const sim = new Sim({ p0: { battle: ['輝く革命 ボルシャック・フレア'] }, p1: { hand: [W, W], mana: mana(8, W) }, active: 1 });
    sim.play(W);
    sim.drain();
    expect(sim.s.players[1].battle[0].tapped).toBe(true);
    sim.play(W);
    sim.drain();
    expect(sim.s.players[1].battle[1].tapped).toBe(false);
  });
  it('ヴァル・ボルシャック: 他のクリーチャーを2体まで選び、それぞれタップまたはアンタップする', () => {
    const sim = new Sim({
      p0: { hand: ['飛ぶ革命 ヴァル・ボルシャック'], mana: [L, F, F, F, F] },
      p1: { battle: [{ c: W }, { c: W, tapped: true }] },
    });
    sim.play('飛ぶ革命 ヴァル・ボルシャック');
    sim.pick(W, W);
    sim.option(0); // タップする
    sim.option(1); // アンタップする
    expect(sim.s.players[1].battle.filter((p) => p.tapped).length).toBe(1);
  });
});

describe('G11 頂上印鑑 パラキン8th / 「魔物が居るな……」', () => {
  it('召喚コストを1少なくして出せるが、ターンの終わりに破壊される', () => {
    const sim = new Sim({ p0: { hand: ['頂上印鑑 パラキン8th'], mana: mana(4, F) } });
    // 通常のコスト5では、4枚では足りない(別のコストだけが使える)
    const plays = sim.legal().filter((a) => a.type === 'PLAY_CARD');
    expect(plays.length).toBe(1);
    expect(plays[0].type === 'PLAY_CARD' && plays[0].extra?.alt).toBe('para');
    sim.play('頂上印鑑 パラキン8th', { extra: { alt: 'para' } });
    expect(sim.tappedMana(0)).toBe(4);
    sim.endMain();
    sim.endTurn();
    expect(sim.has(0, 'battle', '頂上印鑑 パラキン8th')).toBe(false);
  });
  it('通常に召喚した場合は、破壊されない', () => {
    const sim = new Sim({ p0: { hand: ['頂上印鑑 パラキン8th'], mana: mana(5, F) } });
    sim.play('頂上印鑑 パラキン8th');
    sim.endMain();
    sim.endTurn();
    expect(sim.has(0, 'battle', '頂上印鑑 パラキン8th')).toBe(true);
  });
  it('攻撃する時、手札が1枚以下なら、アンタップしてカードを2枚引く', () => {
    const sim = new Sim({ p0: { battle: [{ c: '頂上印鑑 パラキン8th' }], hand: [N], deck: [N, N, N] } });
    sim.attack('頂上印鑑 パラキン8th', 'player');
    expect(sim.count(0, 'hand')).toBe(3);
    expect(sim.s.players[0].battle[0].tapped).toBe(false);
  });
  it('「魔物が居るな……」: 相手は自分のアンタップしているクリーチャーを2体タップし、自分は1枚引いて手札を1枚マナに置く', () => {
    const sim = new Sim({
      p0: { hand: ['頂上印鑑 パラキン8th', N], mana: [L, N, N, N], deck: [W, W] },
      p1: { battle: [{ c: W }, { c: W }, { c: W }] },
    });
    sim.play('頂上印鑑 パラキン8th', { face: 1 });
    // 相手の2体のタップは、同じカードなので聞かれない
    sim.pick(N);
    expect(sim.s.players[1].battle.filter((p) => p.tapped).length).toBe(2);
    expect(sim.count(0, 'mana')).toBe(5);
  });
});
