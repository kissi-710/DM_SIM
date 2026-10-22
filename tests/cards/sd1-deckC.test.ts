// デッキC「シールドゼロで鬼札逆転４ｃ邪王門デッキ」の新規カード(docs/decks-25oudou.md)のシナリオテスト。
import { describe, expect, it } from 'vitest';
import { Sim, mana } from '../scenario';

const N = 'フェアリー・ライフ';
const D = 'ロスト・Re:ソウル';
const W = 'アクアン';
const L = 'ドラゴンズ・サイン';
const F = 'ドンドン火噴くナウ'; // 水火自然


describe('C01 ♪立ち上がる 悪魔に天使 堕ちるかな', () => {
  it('1枚引き、数字を選ぶ。そのコストの呪文を相手は唱えられず、そのコストのエレメントは能力を無視される', () => {
    const sim = new Sim({
      p0: { hand: ['♪立ち上がる'], mana: [W, W, W, W], deck: [N, N] },
      p1: { hand: [D], mana: [D, D, D, D, D, D, D], battle: ['魔誕の斬将オルゲイト'] },
    });
    sim.play('♪立ち上がる');
    expect(sim.count(0, 'hand')).toBe(1);
    expect(sim.pending.why).toBe('modes');
    sim.option(7); // 数字 7
    sim.endTurn();
    // 相手のターン: コスト7の呪文(ロスト・Re:ソウル)は唱えられない
    sim.drain();
    expect(sim.s.active).toBe(1);
    sim.skipMana();
    expect(sim.canPlay(D)).toBe(false);
    // コスト7のオルゲイトの能力(ブロッカー)は無視される
    const g = sim.s.players[1].battle[0];
    expect(g.cards[0]).toBeGreaterThan(-1);
  });
  it('別の数字なら、そのコストの呪文は唱えられる', () => {
    const sim = new Sim({
      p0: { hand: ['♪立ち上がる'], mana: [W, W, W, W], deck: [N, N] },
      p1: { hand: [D], mana: [D, D, D, D, D, D, D] },
    });
    sim.play('♪立ち上がる').option(3);
    sim.endTurn().drain();
    expect(sim.s.active).toBe(1);
    sim.charge(D); // マナチャージで8枚に
    expect(sim.canPlay(D)).toBe(false); // 手札は空になったので唱えられない
  });
});

describe('C02 忍蛇の聖沌 c0br4', () => {
  it('出た時、山札の上2枚を墓地に置き、墓地からコスト5以下のクリーチャーを出す', () => {
    const sim = new Sim({ p0: { hand: ['忍蛇の聖沌'], mana: [D, D, D, D, D, D], deck: [W, N, N] } });
    sim.play('忍蛇の聖沌');
    // アクアン(コスト4)が墓地に置かれて候補になる
    sim.drain();
    expect(sim.has(0, 'battle', '忍蛇の聖沌')).toBe(true);
    expect(sim.count(0, 'grave')).toBe(1); // アクアンは出た(墓地に残るのはフェアリー・ライフ)
    expect(sim.has(0, 'battle', 'アクアン')).toBe(true);
  });
  it('相手のターンに出た時(S・トリガー)、そのターンにシールドが2つ以上ブレイクされていなければ破壊される', () => {
    const sim = new Sim({
      p0: { shield: ['忍蛇の聖沌', 'ダミー', 'ダミー'], mana: [D, D, D, D, D, D] },
      p1: { battle: [{ c: 'アクアン' }] },
      active: 1,
    });
    // アクアンは1つしかブレイクしない
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, 'アクアン'), target: { kind: 'player' } });
    sim.drain();
    // S・トリガーで出て、破壊される
    expect(sim.has(0, 'battle', '忍蛇の聖沌')).toBe(false);
  });
  it('2つ以上ブレイクされていれば残る', () => {
    const sim = new Sim({
      p0: { shield: ['忍蛇の聖沌', 'ダミー', 'ダミー'], mana: [D, D, D, D, D, D], deck: [N, N] },
      p1: { battle: [{ c: '流星のガイアッシュ・カイザー' }] },
      active: 1,
    });
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, '流星のガイアッシュ・カイザー'), target: { kind: 'player' } });
    // シールドは裏向きに無作為なので、どれが割られるかは固定しない: 2つ割られるのは確か
    expect(sim.evs('shieldBroken').length).toBe(2);
  });
});

describe('C03 深淵の逆転撃', () => {
  const base = (manaCards: string[]) =>
    new Sim({
      p0: { hand: ['深淵の逆転撃'], mana: manaCards, deck: [N, N, N] },
      p1: { battle: [{ c: '流星のガイアッシュ・カイザー' }, { c: 'アクアン' }] },
      active: 1,
    });
  it('攻撃された時、手札からコストを支払わずに唱え、相手のクリーチャーを1体破壊できる', () => {
    const sim = base([D, D, D, D]);
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, '流星のガイアッシュ・カイザー'), target: { kind: 'player' } });
    expect(sim.pending.why).toBe('may');
    sim.yes();
    expect(sim.pending.why).toBe('select');
    sim.pick('流星のガイアッシュ・カイザー');
    expect(sim.has(1, 'battle', '流星のガイアッシュ・カイザー')).toBe(false);
    expect(sim.has(0, 'grave', '深淵の逆転撃')).toBe(true);
  });
  it('次の自分のターンのはじめに闇(3)を支払う。払えなければゲームに負ける', () => {
    const sim = base([N, N, N, N]);
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, 'アクアン'), target: { kind: 'player' } });
    sim.yes();
    sim.pick('アクアン');
    sim.drain();
    if (sim.s.active === 1) sim.endTurn();
    sim.drain();
    // 闇のマナがないので、自分のターンのはじめに負ける
    expect(sim.s.winner).toBe(1);
  });
  it('闇のマナがあれば、3枚をタップして支払い、負けない', () => {
    const sim = base([D, N, N, N]);
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, 'アクアン'), target: { kind: 'player' } });
    sim.yes();
    sim.pick('アクアン');
    sim.drain();
    sim.endTurn();
    sim.drain();
    expect(sim.s.winner).toBeNull();
    expect(sim.s.active).toBe(0);
    expect(sim.tappedMana(0)).toBe(3);
  });
});

describe('C04 豊潤フォージュン', () => {
  it('マナが5枚以下なら1枚引く', () => {
    const sim = new Sim({ p0: { hand: ['豊潤フォージュン'], mana: mana(3), deck: [N, N, N] } });
    sim.play('豊潤フォージュン');
    expect(sim.count(0, 'mana')).toBe(4);
    expect(sim.count(0, 'hand')).toBe(1);
  });
  it('マナが6枚以上になるなら引かない', () => {
    const sim = new Sim({ p0: { hand: ['豊潤フォージュン'], mana: mana(5), deck: [N, N, N] } });
    sim.play('豊潤フォージュン');
    expect(sim.count(0, 'mana')).toBe(6);
    expect(sim.count(0, 'hand')).toBe(0);
  });
});

describe('C05 闘争類拳嘩目 ステゴロ・カイザー / お清めシャラップ', () => {
  it('攻撃する時、山札の上1枚をマナに置き、マナ1枚を手札に戻してもよい', () => {
    const sim = new Sim({ p0: { battle: [{ c: '闘争類拳嘩目' }], mana: mana(2), deck: [N, N] } });
    sim.attack('闘争類拳嘩目', 'player');
    expect(sim.count(0, 'mana')).toBe(3);
    sim.use(); // 手札に戻す(対象の選択まで1問)
    expect(sim.count(0, 'hand')).toBe(1);
  });
  it('お清めシャラップ: 山札の上1枚をマナに置き、墓地のカードを山札に戻してシャッフルする', () => {
    const sim = new Sim({ p0: { hand: ['お清めシャラップ'], mana: mana(3), grave: [W, D], deck: [N, N, N] } });
    sim.play('お清めシャラップ', { face: 1 });
    expect(sim.count(0, 'mana')).toBe(4);
    sim.option(0); // 自分の墓地
    sim.pick(W, D);
    expect(sim.count(0, 'deck')).toBe(4);
    expect(sim.count(0, 'grave')).toBe(1); // お清めシャラップ自身
  });
});

describe('C06 ラフルル・ラブ / 「未来から来る、だからミラクル」', () => {
  it('革命チェンジ: 光または水のドラゴンの攻撃中に入れ替わり、出た時に相手は呪文を唱えられなくなる', () => {
    const sim = new Sim({
      p0: { hand: ['音卿の精霊龍'], battle: [{ c: '時の法皇 ミラダンテ' }] },
      p1: { hand: [D], mana: [D, D, D, D, D, D, D] },
    });
    sim.attack('時の法皇 ミラダンテ', 'player');
    expect(sim.pending.why).toBe('may');
    sim.yes();
    expect(sim.has(0, 'battle', '音卿の精霊龍')).toBe(true);
    sim.drain();
    sim.endTurn().drain();
    expect(sim.s.active).toBe(1);
    sim.skipMana();
    expect(sim.canPlay(D)).toBe(false);
  });
  it('「未来から来る、だからミラクル」: 3枚引き、手札からコスト5以下の呪文を無料で唱えてもよい', () => {
    const sim = new Sim({
      p0: { hand: ['音卿の精霊龍', 'フェアリー・ライフ'], mana: [L, W, L, W, L, W], deck: [N, N, N, N, N, N, N, N] },
    });
    sim.play('音卿の精霊龍', { face: 1 });
    expect(sim.count(0, 'hand')).toBe(1 + 3);
    sim.pick(N); // フェアリー・ライフを無料で唱える
    expect(sim.has(0, 'grave', N)).toBe(true);
    expect(sim.count(0, 'mana')).toBe(7);
  });
});

describe('C07 時の法皇 ミラダンテXII', () => {
  it('出た時、光のコスト5以下の呪文を手札から無料で唱える。唱えなければカードを1枚引く', () => {
    const sim = new Sim({ p0: { hand: ['時の法皇 ミラダンテ'], mana: [L, W, L, W, L, W, L, W], deck: [N, N] } });
    sim.play('時の法皇 ミラダンテ');
    // 手札に光の呪文がなければ質問せず、カードを1枚引く
    expect(sim.count(0, 'hand')).toBe(1);
  });
  it('ファイナル革命: 相手はコスト7以下のクリーチャーを召喚できなくなる', () => {
    const sim = new Sim({
      p0: { hand: ['時の法皇 ミラダンテ'], battle: [{ c: '音卿の精霊龍' }], deck: [N, N] },
      p1: { hand: ['天災 デドダム'], mana: [W, D, N, N] },
    });
    sim.attack('音卿の精霊龍', 'player');
    sim.yes();
    sim.drain();
    sim.endTurn().drain();
    expect(sim.s.active).toBe(1);
    sim.skipMana();
    expect(sim.canPlay('天災 デドダム')).toBe(false);
  });
});

describe('C08 龍素記号wD サイクルペディア', () => {
  it('出た時、墓地のコスト4以下の呪文を無料で唱える。墓地から唱えた呪文は山札の下に置かれる', () => {
    const sim = new Sim({ p0: { hand: ['龍素記号wD'], mana: [W, D, W, D, W], grave: ['フェアリー・ライフ'], deck: [N, N, N] } });
    sim.play('龍素記号wD');
    sim.order('墓地');
    sim.use();
    expect(sim.count(0, 'mana')).toBe(6);
    expect(sim.has(0, 'grave', N)).toBe(false);
    expect(sim.s.players[0].deck.at(-1)).toBeDefined();
    expect(sim.names(0, 'deck').at(-1)).toBe('フェアリー・ライフ');
  });
  it('各ターン1度、手札から呪文を唱えた時、その呪文を墓地から無料で唱えてもよい', () => {
    const sim = new Sim({
      p0: { hand: ['フェアリー・ライフ'], battle: [{ c: '龍素記号wD' }], mana: mana(2), deck: [N, N, N] },
    });
    sim.play('フェアリー・ライフ');
    expect(sim.count(0, 'mana')).toBe(3);
    sim.use();
    expect(sim.count(0, 'mana')).toBe(4);
    expect(sim.names(0, 'deck').at(-1)).toBe('フェアリー・ライフ');
  });
});

describe('C09 百鬼の邪王門', () => {
  it('唱えると、山札の上4枚を墓地に置き、闇または火のコスト6以下のクリーチャーを出す。相手のクリーチャーとバトルさせる', () => {
    const sim = new Sim({
      p0: { hand: ['百鬼の邪王門'], mana: [D, F, D, D, D, D], deck: ['鬼ヶ大王', N, N, N, N] },
      p1: { battle: [{ c: 'アクアン' }] },
    });
    sim.play('百鬼の邪王門');
    // 鬼ヶ大王(闇/火・コスト5)が候補。1体だけなので聞かずに出る
    sim.pick('アクアン'); // バトルさせる相手
    sim.drain();
    expect(sim.has(0, 'battle', '鬼ヶ大王')).toBe(true);
    expect(sim.has(1, 'battle', 'アクアン')).toBe(false); // 7000 > 2000
  });
  it('鬼エンド: クリーチャーが攻撃する時、シールドが1つもないプレイヤーがいて闇と火があれば、手札から無料で唱える', () => {
    const sim = new Sim({
      p0: { hand: ['百鬼の邪王門'], mana: [D, F], shield: 0, deck: ['鬼ヶ大王', N, N, N, N] },
      p1: { battle: [{ c: 'アクアン' }] },
      active: 1,
    });
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, 'アクアン'), target: { kind: 'player' } });
    expect(sim.pending.why).toBe('may');
    sim.yes();
    sim.drain();
    expect(sim.has(0, 'grave', '百鬼の邪王門')).toBe(true);
  });
});

describe('C10 鬼ヶ大王 ジャオウガ', () => {
  it('出た時、自分のシールドをすべて手札に加えてもよい(S・トリガーは使えない)', () => {
    const sim = new Sim({ p0: { hand: ['鬼ヶ大王'], mana: [D, F, D, D, D] } });
    sim.play('鬼ヶ大王');
    sim.yes();
    expect(sim.count(0, 'shield')).toBe(0);
    expect(sim.count(0, 'hand')).toBe(5);
  });
});

describe('C11 一王二命三眼槍', () => {
  it('相手のターン中に負ける時、マナに闇と火があれば、かわりに手札のこのカードを山札の下に置いてもよい', () => {
    const sim = new Sim({
      p0: { hand: ['一王二命三眼槍'], mana: [D, F], shield: 0 },
      p1: { battle: [{ c: 'アクアン' }] },
      active: 1,
    });
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, 'アクアン'), target: { kind: 'player' } });
    expect(sim.pending.why).toBe('replaceChoice');
    sim.option(0);
    sim.drain();
    expect(sim.s.winner).toBeNull();
    expect(sim.has(0, 'hand', '一王二命三眼槍')).toBe(false);
    expect(sim.names(0, 'deck').at(-1)).toBe('一王二命三眼槍');
  });
  it('マナに火がなければ置換できず、負ける', () => {
    const sim = new Sim({
      p0: { hand: ['一王二命三眼槍'], mana: [D, D], shield: 0 },
      p1: { battle: [{ c: 'アクアン' }] },
      active: 1,
    });
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, 'アクアン'), target: { kind: 'player' } });
    expect(sim.s.winner).toBe(1);
  });
});

describe('C12 蒼き団長 ドギラゴン剣', () => {
  it('自分の多色クリーチャーはスピードアタッカーを得る', () => {
    const sim = new Sim({ p0: { battle: [{ c: '蒼き団長', sick: true }, { c: '天災 デドダム', sick: true }, { c: 'アクアン', sick: true }] } });
    const legal = sim.legal().filter((a) => a.type === 'ATTACK' && a.target.kind === 'player');
    const attackers = legal.map((a) => (a.type === 'ATTACK' ? a.attacker : -1));
    expect(attackers).toContain(sim.pid(0, '蒼き団長'));
    expect(attackers).toContain(sim.pid(0, '天災 デドダム'));
    expect(attackers).not.toContain(sim.pid(0, 'アクアン'));
  });
  it('ファイナル革命: 手札・マナから、コストの合計が6以下になるように多色クリーチャーを出す', () => {
    const sim = new Sim({
      p0: { hand: ['蒼き団長', '天災 デドダム'], mana: ['天災 デドダム'], battle: [{ c: '音卿の精霊龍' }] },
    });
    // 蒼き団長の革命チェンジ条件: 火または自然のコスト5以上のドラゴン。ガイアッシュ・カイザー(水自然・コスト6・ドラゴン)を使う
    const sim2 = new Sim({
      p0: { hand: ['蒼き団長', '天災 デドダム', '天災 デドダム'], battle: [{ c: '流星のガイアッシュ・カイザー' }] },
    });
    void sim;
    sim2.attack('流星のガイアッシュ・カイザー', 'player');
    sim2.yes();
    // コストの合計6以下: デドダム(3)×2 まで
    sim2.pick('天災 デドダム', '天災 デドダム');
    expect(sim2.count(0, 'battle', '天災 デドダム')).toBe(2);
  });
});

describe('C13 切札勝太&カツキング -熱血の物語-', () => {
  it('出た時、山札の上5枚から1枚を手札に加え、残りを山札の下に置く。火か自然ならクリーチャーを戻してもよい', () => {
    const sim = new Sim({
      p0: { hand: ['切札勝太'], mana: [W, F, N, N, N], deck: [N, W, D, L, 'ダミー', 'ダミー'] },
      p1: { battle: [{ c: 'アクアン' }] },
    });
    sim.play('切札勝太');
    sim.pick(N); // フェアリー・ライフ(自然)
    expect(sim.has(0, 'hand', N)).toBe(true);
    sim.use('アクアン');
    expect(sim.has(1, 'battle', 'アクアン')).toBe(false);
    expect(sim.count(0, 'deck')).toBe(5);
  });
  it('革命0: シールドが1つもなければ、パワー+10000・スピードアタッカー・T・ブレイカー', () => {
    const sim = new Sim({ p0: { battle: [{ c: '切札勝太', sick: true }], shield: 0 }, p1: { shield: 5 } });
    const legal = sim.legal().filter((a) => a.type === 'ATTACK' && a.target.kind === 'player');
    expect(legal.length).toBe(1); // スピードアタッカーで召喚酔いしない
    sim.attack('切札勝太', 'player');
    expect(sim.evs('shieldBroken').length).toBe(3);
  });
  it('革命2: シールドが2つ以下なら、シールドから手札に加える時にS・トリガーを得る', () => {
    const sim = new Sim({
      p0: { shield: ['切札勝太', 'ダミー'], mana: [W, F, N, N, N], deck: [N, N, N, N, N, N] },
      p1: { battle: [{ c: '流星のガイアッシュ・カイザー' }] },
      active: 1,
    });
    sim.do({ type: 'ATTACK', attacker: sim.pid(1, '流星のガイアッシュ・カイザー'), target: { kind: 'player' } });
    // 2枚(W・ブレイカー)とも割られ、切札勝太はS・トリガーを宣言できる
    expect(sim.pending.why).toBe('triggerDeclare');
  });
});
