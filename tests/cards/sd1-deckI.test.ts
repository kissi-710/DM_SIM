// デッキI「赤青マジック」の新規カード(docs/decks-25oudou.md)のシナリオテスト。
import { describe, expect, it } from 'vitest';
import { Sim, mana } from '../scenario';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const F = 'ドンドン火噴くナウ'; // 水火自然

describe('I01〜I03 AQvibrato・Mogi林檎・ヒメカット', () => {
  it('Mogi林檎: 各ターンに1度、自分のマジック・カードを使うコストを1少なくする', () => {
    const sim = new Sim({ p0: { hand: ['AQvibrato', 'AQvibrato'], battle: ['アシスター・Mogi林檎'], mana: [W, W, W], deck: [N, N, N, N] } });
    sim.play('AQvibrato'); // 2 - 1 = 1
    expect(sim.tappedMana(0)).toBe(1);
    sim.play('AQvibrato'); // 2(軽減は各ターン1度)
    expect(sim.tappedMana(0)).toBe(3);
  });
  it('ヒメカット マジック・フレンド・バースト: 他のマジック・クリーチャーをタップして、呪文側(♪蛙の子)を、バトルゾーンに置いたまま唱える', () => {
    const sim = new Sim({
      p0: { hand: ['歌舞音愛 ヒメカット'], battle: [{ c: 'AQvibrato' }], mana: [W, W] },
      p1: { battle: [{ c: W }, { c: W }] },
    });
    sim.play('歌舞音愛 ヒメカット');
    sim.use('AQvibrato');
    // 呪文側: 相手のエレメントを2つまで手札に戻す
    sim.pick(W, W);
    sim.drain();
    expect(sim.has(0, 'battle', '歌舞音愛 ヒメカット')).toBe(true); // 置いたまま
    expect(sim.count(1, 'battle')).toBe(0);
    expect(sim.s.players[0].battle.find((p) => p.cards[0] === sim.uid(0, 'battle', 'AQvibrato'))!.tapped).toBe(true);
  });
  it('ヒメカット: 相手のターン中に相手が2枚目以降のカードを引いた時、1枚引いてもよい', () => {
    const sim = new Sim({ p0: { battle: ['歌舞音愛 ヒメカット'], deck: [N, N, N] }, p1: { hand: ['アクアン'], deck: [W, W, W] }, active: 1 });
    sim.drain();
    // 相手のターンのドロー(1枚目)は誘発しない。2枚目以降のドローがあれば誘発する
    expect(sim.count(0, 'hand')).toBe(0);
  });
});

describe('I04 ボン・キゴマイム / ♪やせ蛙', () => {
  it('相手のクリーチャーが出た時、そのターン、そのクリーチャーは攻撃できない。コストを支払わずに出ていたら、カードを1枚引いてもよい', () => {
    const sim = new Sim({ p0: { battle: ['ボン・キゴマイム'], deck: [N, N] }, p1: { hand: [W], mana: [W, W, W, W] }, active: 1 });
    sim.play(W);
    sim.drain();
    expect(sim.s.effects.some((e) => e.mod.kind === 'cannotAttack')).toBe(true);
    expect(sim.count(0, 'hand')).toBe(0); // マナを払って出たので、引かない
  });
  it('♪やせ蛙: 数字を選ぶと、その数字と同じコストの相手のクリーチャーは、次の自分のターンのはじめまで、攻撃もブロックもできない', () => {
    const sim = new Sim({ p0: { hand: ['ボン・キゴマイム'], mana: [W, W] }, p1: { battle: [{ c: W }, { c: 'AQvibrato' }] }, active: 0 });
    sim.play('ボン・キゴマイム', { face: 1 });
    sim.option(4); // コスト4(アクアン)
    sim.endMain();
    sim.endTurn();
    sim.skipMana();
    // 相手のターン: アクアン(コスト4)は攻撃できない。AQvibrato(コスト2)は攻撃できる(召喚酔いなし)
    sim.s.players[1].battle.forEach((p) => (p.sick = false));
    const atk = sim.legal().filter((a) => a.type === 'ATTACK').map((a) => (a.type === 'ATTACK' ? a.attacker : -1));
    expect(atk).not.toContain(sim.pid(1, W));
    expect(atk).toContain(sim.pid(1, 'AQvibrato'));
  });
});

describe('I05 同期の妖精 / ド浮きの動悸', () => {
  it('相手がクリーチャーを選ぶなら、可能ならこのクリーチャーを選ぶ', () => {
    const sim = new Sim({
      p0: { battle: ['同期の妖精', { c: '流星のガイアッシュ・カイザー' }] },
      p1: { hand: ['ド浮きの動悸'], mana: [W, W, W, W] },
      active: 1,
    });
    sim.play('ド浮きの動悸', { face: 1 });
    // 選べるのは、同期の妖精だけ。離れて手札に置かれるので、メガ・ラスト・バーストの確認が出る
    expect(sim.has(0, 'battle', '流星のガイアッシュ・カイザー')).toBe(true);
    expect(sim.has(0, 'hand', '同期の妖精')).toBe(true);
  });
  it('メガ・ラスト・バースト: 離れて手札に置かれた時、呪文側(ド浮きの動悸)をコストを支払わずに唱えてもよい', () => {
    const sim = new Sim({
      p0: { battle: ['同期の妖精'], deck: [N, N] },
      p1: { hand: ['堕呪 エアヴォ'], mana: [W, W, W, W], battle: [{ c: W }] },
      active: 1,
    });
    sim.play('堕呪 エアヴォ');
    // エアヴォ: コスト7以下のバトルゾーンのカードを手札に戻す。同期の妖精に選ばれる(挑発)。離れて手札に置かれた時の確認
    expect(sim.pending.why).toBe('may');
    sim.yes();
    // ド浮きの動悸: 相手のクリーチャー(アクアン)を手札に戻し、1枚引く
    expect(sim.has(1, 'battle', W)).toBe(false);
    expect(sim.count(0, 'hand')).toBe(1);
    expect(sim.has(0, 'hand', '同期の妖精')).toBe(false); // 呪文側を唱えたので、手札を離れた
  });
});

describe('I06 マグナム / I07 Napo獅子 / I08 ピーカプ / I09 決断', () => {
  it('マグナム: 自分のターンに相手のクリーチャーが出る時、かわりに墓地に置く', () => {
    const sim = new Sim({
      p0: { battle: [{ c: 'AQvibrato' }, { c: '単騎連射 マグナム' }] },
      p1: { shield: ['光鎧龍ホーリーグレイス'] },
    });
    // 自分のターンに、相手がS・トリガーでクリーチャーを出す時、かわりに墓地に置く
    sim.attack('AQvibrato', 'player');
    sim.pick('光鎧龍ホーリーグレイス');
    sim.drain();
    expect(sim.has(1, 'grave', '光鎧龍ホーリーグレイス')).toBe(true);
    expect(sim.has(1, 'battle', '光鎧龍ホーリーグレイス')).toBe(false);
  });
  it('Napo獅子: マジック・クリーチャーがあれば召喚コストが1少なくなる。出た時、手札を2枚まで捨てて、その枚数より1枚多く引く', () => {
    const sim = new Sim({ p0: { hand: ['Napo獅子-Vi無粋', N, N], battle: ['AQvibrato'], mana: [F, F, F, F], deck: [W, W, W, W] } });
    expect(sim.canPlay('Napo獅子-Vi無粋')).toBe(true); // 5 - 1 = 4
    sim.play('Napo獅子-Vi無粋');
    sim.pick(N, N);
    expect(sim.count(0, 'hand')).toBe(3);
  });
  it('♪オレの歌: 相手のコスト2以下のエレメントをすべて破壊する', () => {
    const sim = new Sim({ p0: { hand: ['Napo獅子-Vi無粋'], mana: [F, F, F] }, p1: { battle: [{ c: 'AQvibrato' }, { c: 'AQvibrato' }, { c: W }] } });
    sim.play('Napo獅子-Vi無粋', { face: 1 });
    expect(sim.count(1, 'battle')).toBe(1);
  });
  it('ピーカプ ♪音速で: クリーチャーにスピードアタッカーを与え、最初の攻撃の終わりにアンタップする', () => {
    const sim = new Sim({ p0: { hand: ['調律師ピーカプ'], battle: [{ c: 'AQvibrato', sick: true }], mana: [F, F, F] } });
    sim.play('調律師ピーカプ', { face: 1 });
    sim.attack('AQvibrato', 'player');
    sim.drain();
    expect(sim.s.players[0].battle[0].tapped).toBe(false);
    // 2回目の攻撃は、アンタップされるが、もう「最初の攻撃」ではない
    sim.attack('AQvibrato', 'player');
    sim.drain();
    expect(sim.s.players[0].battle[0].tapped).toBe(true);
  });
  it('瞬閃と疾駆と双撃の決断: 同じものを2回選べる', () => {
    const sim = new Sim({ p0: { hand: ['瞬閃と疾駆と双撃の決断'], battle: [{ c: 'AQvibrato', sick: true }], mana: [F, F, F] } });
    sim.play('瞬閃と疾駆と双撃の決断');
    sim.option(1, 2);
    expect(sim.s.effects.some((e) => e.mod.kind === 'untapAfterAttack')).toBe(true);
    expect(sim.s.effects.some((e) => e.mod.kind === 'grant')).toBe(true);
  });
});

describe('I10 カクメイジン / I11 カラクリバーシ', () => {
  it('カクメイジン: 自分のマジックすべてにスピードアタッカーを与える', () => {
    const sim = new Sim({ p0: { battle: [{ c: '芸魔王将 カクメイジン', sick: true }, { c: 'AQvibrato', sick: true }, { c: W, sick: true }] } });
    const atk = sim.legal().filter((a) => a.type === 'ATTACK' && a.target.kind === 'player').map((a) => (a.type === 'ATTACK' ? a.attacker : -1));
    expect(atk).toContain(sim.pid(0, '芸魔王将 カクメイジン'));
    expect(atk).toContain(sim.pid(0, 'AQvibrato'));
    expect(atk).not.toContain(sim.pid(0, W));
  });
  it('カクメイジン: 各ブレイクの前に、マナの枚数以下のコストの呪文を、手札・墓地から無料で唱え、山札の下に置く', () => {
    const sim = new Sim({
      p0: { battle: [{ c: '芸魔王将 カクメイジン' }], hand: ['ド浮きの動悸'], mana: mana(4, F), deck: [N, N, N, N] },
      p1: { battle: [{ c: W }] },
    });
    sim.attack('芸魔王将 カクメイジン', 'player');
    sim.use(); // 呪文はド浮きの動悸1枚(コスト4 <= マナ4)
    // 相手のアクアンを手札に戻し、1枚引く
    sim.drain();
    expect(sim.has(1, 'battle', W)).toBe(false);
    expect(sim.names(0, 'deck').at(-1)).toBe('同期の妖精 / ド浮きの動悸');
  });
  it('カラクリバーシ: 革命チェンジ[マジック]・出た時、1枚引き、コスト3以下の呪文を無料で唱える', () => {
    const sim = new Sim({
      p0: { hand: ['芸魔隠狐 カラクリバーシ'], battle: [{ c: 'AQvibrato' }], deck: [N, N, N] },
    });
    sim.attack('AQvibrato', 'player');
    sim.yes();
    expect(sim.has(0, 'battle', '芸魔隠狐 カラクリバーシ')).toBe(true);
  });
});

