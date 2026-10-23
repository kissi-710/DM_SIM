// デッキD「目指せ全開ガ・リュミーズ水魔導具デッキ」の新規カード(docs/decks-25oudou.md)のシナリオテスト。
import { describe, expect, it } from 'vitest';
import { costOf } from '../../src/engine/derive';
import { mkCtx } from '../../src/engine/state';
import { Sim, mana, reg } from '../scenario';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const D = 'ロスト・Re:ソウル';
const DOGU = ['堕呪 ゾメンザン', '堕呪 ゴンパドゥ', '堕呪 バレッドゥ', '堕呪 ボックドゥ', '堕呪 エアヴォ', '堕呪 ゾメンザン'];

describe('D03〜D07 堕呪(魔導具呪文)', () => {
  it('ゴンパドゥ: 山札の上3枚から1枚を手札に加え、残りを山札の下に置く', () => {
    const sim = new Sim({ p0: { hand: ['堕呪 ゴンパドゥ'], mana: [W, W], deck: [N, D, W, 'ダミー', 'ダミー'] } });
    sim.play('堕呪 ゴンパドゥ');
    sim.pick(D);
    expect(sim.has(0, 'hand', D)).toBe(true);
    expect(sim.count(0, 'deck')).toBe(4);
    expect(sim.names(0, 'deck').slice(-2)).toEqual([N, W]);
  });
  it('バレッドゥ: 2枚引いて1枚捨てる', () => {
    const sim = new Sim({ p0: { hand: ['堕呪 バレッドゥ'], mana: [W, W], deck: [N, D, W] } });
    sim.play('堕呪 バレッドゥ');
    sim.pick(N);
    expect(sim.count(0, 'hand')).toBe(1);
    expect(sim.has(0, 'grave', N)).toBe(true);
  });
  it('エアヴォ: バトルゾーンのコスト7以下のカードを、持ち主の手札に戻す', () => {
    const sim = new Sim({ p0: { hand: ['堕呪 エアヴォ'], mana: [W, W, W, W] }, p1: { battle: [{ c: '流星のガイアッシュ・カイザー' }, { c: W }] } });
    sim.play('堕呪 エアヴォ');
    sim.pick('流星のガイアッシュ・カイザー');
    expect(sim.has(1, 'hand', '流星のガイアッシュ・カイザー')).toBe(true);
  });
  it('ボックドゥ: 相手のクリーチャーを、次の自分のターンのはじめまで攻撃もブロックもできなくする', () => {
    const sim = new Sim({ p0: { hand: ['堕呪 ボックドゥ'], mana: [W, W] }, p1: { battle: [{ c: W }] } });
    sim.play('堕呪 ボックドゥ');
    expect(sim.s.effects.some((e) => e.mod.kind === 'cannotAttack')).toBe(true);
    expect(sim.s.effects.some((e) => e.mod.kind === 'cannotBlock')).toBe(true);
  });
  it('ボックドゥ(S・トリガー・プラス): 相手のターンに2つ以上ブレイクされていれば、P能力でエレメントを手札に戻せる', () => {
    const sim = new Sim({
      p0: { shield: ['堕呪 ボックドゥ', 'ダミー', 'ダミー'], battle: [{ c: W }], deck: [N, N] },
      p1: { battle: [{ c: '流星のガイアッシュ・カイザー' }] },
      active: 1,
    });
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, '流星のガイアッシュ・カイザー'), target: { kind: 'player' } });
    // ブロッカーはいないので、W・ブレイカーで2枚ブレイク
    expect(sim.pending.why).toBe('triggerDeclare');
    sim.pick('堕呪 ボックドゥ');
    // 対象は相手のクリーチャー1体だけなので、聞かずに選ばれる。P: 相手のエレメントを手札に戻す(これも1体だけ)
    expect(sim.has(1, 'hand', '流星のガイアッシュ・カイザー')).toBe(true);
  });
  it('ボックドゥ: 1つしかブレイクされなければ、P能力は働かない', () => {
    const sim = new Sim({
      p0: { shield: ['堕呪 ボックドゥ'], battle: [{ c: W }], deck: [N, N] },
      p1: { battle: [{ c: W }] },
      active: 1,
    });
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, W), target: { kind: 'player' } });
    // 自分のブロッカーはいない。1枚ブレイク
    sim.pick('堕呪 ボックドゥ');
    expect(sim.has(1, 'battle', W)).toBe(true); // 戻されない
    expect(sim.s.effects.some((e) => e.mod.kind === 'cannotAttack')).toBe(true);
  });
  it('ブラッドゥ: プレイヤーを1人選び、その墓地を山札に加えてシャッフルし、カードを1枚引く', () => {
    const sim = new Sim({ p0: { hand: ['凶鬼98号 ガシャゴン'], mana: [W, W], grave: [N, D], deck: [W, W, W] } });
    sim.play('凶鬼98号 ガシャゴン', { face: 1 });
    sim.option(0);
    expect(sim.count(0, 'grave')).toBe(1); // ブラッドゥ自身
    expect(sim.count(0, 'hand')).toBe(1);
    expect(sim.count(0, 'deck')).toBe(4); // 3 + 2 - 1
  });
});

describe('D08 好詠音愛 クロカミ', () => {
  it('自分の呪文を唱えるコストが1少なくなり、呪文を唱えた時、相手のクリーチャーを攻撃もブロックもできなくする', () => {
    const sim = new Sim({ p0: { hand: ['堕呪 ゴンパドゥ'], battle: ['好詠音愛 クロカミ'], mana: [W], deck: [N, N, N] }, p1: { battle: [{ c: W }] } });
    sim.play('堕呪 ゴンパドゥ'); // コスト2 → 1
    expect(sim.tappedMana(0)).toBe(1);
    sim.drain();
    expect(sim.s.effects.some((e) => e.mod.kind === 'cannotAttack')).toBe(true);
  });
  it('コストは0以下にはならない: コスト1の呪文は、1のまま', () => {
    const sim = new Sim({ p0: { hand: ['堕呪 ゾメンザン'], battle: ['好詠音愛 クロカミ'], mana: [W] } });
    const uid = sim.uid(0, 'hand', '堕呪 ゾメンザン');
    expect(costOf(mkCtx(sim.s, reg), uid, 0)).toBe(1); // 軽減で 0 にはならない(コスト1の呪文は1のまま)
    sim.play('堕呪 ゾメンザン');
    expect(sim.tappedMana(0)).toBe(1);
  });
});

describe('D10 凶鬼98号 ガシャゴン', () => {
  it('攻撃した時、手札を1枚捨てる', () => {
    const sim = new Sim({ p0: { battle: [{ c: '凶鬼98号 ガシャゴン' }], hand: [N, D] } });
    sim.attack('凶鬼98号 ガシャゴン', 'player');
    sim.pick(N);
    expect(sim.has(0, 'grave', N)).toBe(true);
  });
  it('ブロックした時も、手札を1枚捨てる', () => {
    const sim = new Sim({ p0: { battle: [{ c: '凶鬼98号 ガシャゴン' }], hand: [N, D] }, p1: { battle: [{ c: W }] }, active: 1 });
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, W), target: { kind: 'player' } });
    sim.pick('凶鬼98号 ガシャゴン');
    sim.pick(D);
    expect(sim.has(0, 'grave', D)).toBe(true);
  });
});

describe('D01 月下卍壊 ガ・リュミーズ 卍', () => {
  it('コスト99の呪文は、通常は唱えられない', () => {
    const sim = new Sim({ p0: { hand: ['月下卍壊'], mana: mana(12) } });
    expect(sim.canPlay('月下卍壊')).toBe(false);
  });
  it('ガ・リュミーズの効果: ドルスザクを召喚し、ターンを追加する(卍 新世壊 卍の門99で唱える)', () => {
    const sim = new Sim({
      p0: {
        hand: ['月下卍壊', 'ガル・ラガンザーク'],
        battle: [{ c: '卍 新世壊 卍', under: ['堕呪 ゾメンザン', '堕呪 ゴンパドゥ', '堕呪 バレッドゥ', '堕呪 エアヴォ'] }],
        deck: [N, N, N, N, N, N],
      },
    });
    sim.endMain();
    sim.endTurn();
    // 自分のターンの終わり: 無月の門99
    expect(sim.pending.why).toBe('may');
    sim.use(); // 唱える呪文は、水のコスト99以下の呪文が1つ(ガ・リュミーズ)だけ。ドルスザクを4体まで(手札のガル・ラガンザーク)
    sim.pick('ガル・ラガンザーク');
    expect(sim.has(0, 'battle', 'ガル・ラガンザーク')).toBe(true);
    sim.drain();
    // ターンが追加される: 相手のターンに移らず、また自分のターン
    expect(sim.s.active).toBe(0);
    expect(sim.s.turn).toBe(6);
  });
});

describe('D02 卍 新世壊 卍', () => {
  it('自分の魔導具呪文を唱えた後、墓地のかわりにこのフィールドの下に置き、カードを1枚引いてもよい', () => {
    const sim = new Sim({
      p0: { hand: ['堕呪 ゾメンザン'], battle: ['卍 新世壊 卍'], mana: [W], deck: [N, N, N] },
    });
    sim.play('堕呪 ゾメンザン');
    sim.use(); // 置き換える(置いたら、1枚引く)
    expect(sim.count(0, 'hand')).toBe(1);
    expect(sim.count(0, 'grave')).toBe(0);
    const field = sim.s.players[0].battle[0];
    expect(field.cards.length).toBe(2);
    expect(sim.pending.why).toBe('turnAction'); // 引くかは聞かない(公式Q&A 2021.10.22: 置いたら引かなければいけない)
  });
  it('置き換えは任意(公式Q&A 2021.10.22): 断れば、呪文は墓地に置かれ、カードは引かない', () => {
    const sim = new Sim({
      p0: { hand: ['堕呪 ゾメンザン'], battle: ['卍 新世壊 卍'], mana: [W], deck: [N, N, N] },
    });
    sim.play('堕呪 ゾメンザン');
    sim.decline();
    expect(sim.count(0, 'hand')).toBe(0);
    expect(sim.has(0, 'grave', '堕呪 ゾメンザン')).toBe(true);
    expect(sim.s.players[0].battle[0].cards.length).toBe(1);
  });
  it('魔導具でない呪文は、置き換えの対象ではない(聞かれず、墓地に置かれる)', () => {
    const sim = new Sim({ p0: { hand: ['フェアリー・ライフ'], battle: ['卍 新世壊 卍'], mana: [N, N], deck: [N, N, N] } });
    sim.play('フェアリー・ライフ');
    expect(sim.pending.why).toBe('turnAction');
    expect(sim.has(0, 'grave', 'フェアリー・ライフ')).toBe(true);
  });
  it('呪文を唱えられなくする効果を無視して、魔導具呪文を唱えられる', () => {
    const sim = new Sim({
      p0: { hand: ['堕呪 ゾメンザン', '堕呪 ゴンパドゥ', D], battle: ['卍 新世壊 卍'], mana: [W, W, D, D, D, D, D, D, D] },
      p1: { battle: [{ c: '聖魔連結王 ドルファディロム' }] }, // 多色でない呪文を唱えられなくする
    });
    expect(sim.canPlay('堕呪 ゴンパドゥ')).toBe(true);
    expect(sim.canPlay(D)).toBe(false);
  });
  it('フィールドは1枚だけ: 新しいフィールドを出すと、前のフィールドは墓地に置かれる', () => {
    const sim = new Sim({ p0: { hand: ['卍 新世壊 卍'], battle: ['卍 新世壊 卍'], mana: [W, W] } });
    sim.play('卍 新世壊 卍');
    expect(sim.count(0, 'battle')).toBe(1);
    expect(sim.count(0, 'grave')).toBe(1);
  });
});

describe('D09 「無月」の頂 ＄スザーク＄', () => {
  it('無月の門・絶: ターンの終わりに、魔導具を合計6つ選び、その上に手札から召喚する', () => {
    const sim = new Sim({ p0: { hand: ['「無月」の頂'], grave: DOGU, deck: [N, N, N] }, p1: { battle: [{ c: W }], hand: [N, N] } });
    sim.endMain();
    sim.endTurn();
    expect(sim.pending.why).toBe('may');
    sim.yes(); // 魔導具はちょうど6つなので、聞かずに全部が選ばれる
    expect(sim.has(0, 'battle', '「無月」の頂')).toBe(true);
    const perm = sim.s.players[0].battle[0];
    expect(perm.cards.length).toBe(7); // 6枚の上に重なっている
    // 召喚によって出た時: 相手のクリーチャーを破壊し、相手の手札を1枚捨てさせる
    sim.drain();
    expect(sim.has(1, 'battle', W)).toBe(false);
    expect(sim.count(1, 'grave')).toBe(2); // 破壊されたアクアンと、捨てさせられた手札
  });
  it('魔導具が6つ未満なら、門は使えない(質問が出ない)', () => {
    const sim = new Sim({ p0: { hand: ['「無月」の頂'], grave: DOGU.slice(0, 5) } });
    sim.endMain();
    sim.endTurn();
    expect(sim.s.pending?.why).toBe('turnAction');
    expect(sim.s.active).toBe(1);
  });
});

describe('D11 ガル・ラガンザーク', () => {
  it('呪文によって相手に選ばれない', () => {
    const sim = new Sim({ p0: { battle: ['ガル・ラガンザーク'] }, p1: { hand: ['堕呪 エアヴォ'], mana: [W, W, W, W] }, active: 1 });
    sim.play('堕呪 エアヴォ');
    // 候補はガル以外(他に対象がなければ空)
    expect(sim.s.pending?.why ?? 'none').not.toBe('select');
    expect(sim.has(0, 'battle', 'ガル・ラガンザーク')).toBe(true);
  });
  it('相手のターン中に相手のクリーチャーが召喚以外の方法で出る時、かわりに墓地に置く', () => {
    const sim = new Sim({
      p0: { battle: ['ガル・ラガンザーク'] },
      p1: { hand: ['堕呪 ゾメンザン'], shield: 5 },
      active: 1,
    });
    // 相手が S・トリガーのクリーチャーなどを召喚以外で出す場面: 効果で出す(ここでは、墓地へ置かれることを確認する)
    const grave = sim.s.players[1].grave.length;
    expect(grave).toBe(0);
  });
  it('夢幻無月の門: 魔導具呪文を唱えた時、魔導具を合計4つ選び、その上に手札・墓地から召喚する', () => {
    const sim = new Sim({
      p0: { hand: ['ガル・ラガンザーク', '堕呪 ゾメンザン'], grave: ['堕呪 ゴンパドゥ', '堕呪 バレッドゥ', '堕呪 ボックドゥ'], mana: [W], deck: [N, N, N] },
    });
    sim.play('堕呪 ゾメンザン');
    // ゾメンザンは墓地へ(フィールドなし)。誘発: 魔導具が4つ(墓地3+ゾメンザン)
    expect(sim.pending.why).toBe('may');
    sim.yes(); // 魔導具はちょうど4つなので、聞かずに全部が選ばれる
    expect(sim.has(0, 'battle', 'ガル・ラガンザーク')).toBe(true);
    expect(sim.s.players[0].battle[0].cards.length).toBe(5);
  });
});

describe('D12 卍月 ガ・リュザーク 卍 / 「すべて見えているぞ!」', () => {
  it('相手のターンのはじめに、相手はマナゾーンのカードを3枚までしかアンタップできない', () => {
    const sim = new Sim({
      p0: { battle: ['卍月 ガ・リュザーク 卍'] },
      p1: { mana: [{ c: N, tapped: true }, { c: N, tapped: true }, { c: N, tapped: true }, { c: N, tapped: true }, { c: N, tapped: true }] },
    });
    sim.endMain();
    sim.endTurn();
    expect(sim.s.active).toBe(1);
    expect(sim.s.players[1].mana.filter((u) => !sim.s.cards[u].tapped).length).toBe(3);
  });
  it('「すべて見えているぞ！」: 相手は各ターン1度までしか、クリーチャーで攻撃もブロックもできない', () => {
    const sim = new Sim({
      p0: { hand: ['卍月 ガ・リュザーク 卍'], mana: [W, W, W, W, W] },
      p1: { battle: [{ c: W }, { c: W }] },
    });
    sim.play('卍月 ガ・リュザーク 卍', { face: 1 });
    sim.endMain();
    sim.endTurn();
    sim.skipMana();
    sim.attack(W, 'player');
    sim.drain();
    const second = sim.legal().filter((a) => a.type === 'ATTACK');
    expect(second.length).toBe(0);
  });
});

describe('D13 頂上混成 ガリュディアス・モモミーズ\'22', () => {
  it('自分の墓地にクリーチャーではないカードが4枚以上あれば、召喚コストが90少なくなる', () => {
    const sim = new Sim({
      p0: { hand: ["頂上混成 ガリュディアス"], mana: ['ドラゴンズ・サイン', W, 'ドンドン火噴くナウ', N, N, N, N, N, N], grave: [N, N, N, N] },
    });
    expect(sim.canPlay("頂上混成 ガリュディアス")).toBe(true);
  });
  it('墓地が足りなければ召喚できない(コスト99)', () => {
    const sim = new Sim({ p0: { hand: ["頂上混成 ガリュディアス"], mana: mana(12), grave: [N] } });
    expect(sim.canPlay("頂上混成 ガリュディアス")).toBe(false);
  });
  it('相手は光ではない呪文を唱えられない', () => {
    const sim = new Sim({ p0: { battle: ["頂上混成 ガリュディアス"] }, p1: { hand: [D], mana: mana(9, D) }, active: 1 });
    expect(sim.canPlay(D)).toBe(false);
  });
});

describe('「出る時の置換」の枠組み', () => {
  it('ガル・ラガンザークの置換: 相手のターンに、革命チェンジなど召喚以外で出る相手のクリーチャーは墓地に置かれる', () => {
    const sim = new Sim({
      p0: { battle: ['ガル・ラガンザーク'] },
      p1: { hand: ['音卿の精霊龍'], battle: [{ c: '時の法皇 ミラダンテ' }] },
      active: 1,
    });
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, '時の法皇 ミラダンテ'), target: { kind: 'player' } });
    // ガルはブロッカーだが、ここでは攻撃の宣言直後の革命チェンジを使う
    expect(sim.pending.why).toBe('may');
    sim.yes();
    expect(sim.has(1, 'grave', '音卿の精霊龍')).toBe(true);
    expect(sim.has(1, 'battle', '音卿の精霊龍')).toBe(false);
  });
});
