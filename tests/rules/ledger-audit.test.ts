// 公式照合(ROADMAP M8。ISSUES の旧 ISSUE-02)の確認結果を、テストで固定する。
//  - D-13 キーナリー: 出たクリーチャー自身の「出た時」だけを止める(他のクリーチャーの誘発は止めない。公式 Q&A 46072 / 43766)
//  - D-5/L10・D-6/L9: 現行の実装と原文(R 603.5d / 104.2b)が食い違いうる場面を、カードの定義から洗い出し、
//    対象のカード(28種)では該当がないことを固定する。新しいカードを足して該当が出たら、このテストが落ちるので、
//    その時に実装を原文に合わせる(docs/rules-reference.md 12.3)。
import { describe, expect, it } from 'vitest';
import { CARD_LIST } from '../../src/cards';
import { Sim } from '../scenario';

const W = 'アクアン';
const D = 'ロスト・Re:ソウル';
const N = 'フェアリー・ライフ';

describe('D-13 キーナリーの誘発抑制の範囲', () => {
  it('相手のキーナリーがいても、出たクリーチャー自身の「出た時」だけが止まり、他のクリーチャーの誘発は止まらない', () => {
    const sim = new Sim({
      p0: { hand: [W, '天災 デドダム'], mana: [W, W, W, W, W, W, D, N, N], battle: [{ c: 'ヨビニオン・マルル', sick: false }], deck: [W, W, W, W, W, W] },
      p1: { battle: ['終末縫合王 ザ=キラー・キーナリー'] },
    });
    // 1体目: アクアン。自身の「出た時」(山札の上5枚)は、キーナリーで止まる(質問が出ない)
    sim.play(W);
    expect(sim.s.pending?.why).toBe('turnAction');
    // 2体目: デドダム。自身の「出た時」は止まるが、マルルの「各ターン、自分の2体目のクリーチャーが出た時」は止まらない
    sim.play('天災 デドダム');
    expect(sim.s.pending?.why).not.toBe('turnAction');
    expect(sim.pending.player).toBe(0);
    // 質問の出どころは、デドダムではなくマルル
    const src = sim.pending.source;
    expect(src && sim.s.cards[src.uid].defId).toBe(sim.s.cards[sim.uid(0, 'battle', 'ヨビニオン・マルル')].defId);
  });
});

/** オルゲイト(席0)に「コピーするか」と聞かれた回数。ほかの質問は、いいえ・先頭で進める */
function orgateAsks(sim: Sim): number {
  let n = 0;
  let guard = 0;
  while (sim.s.pending && sim.s.pending.why !== 'turnAction' && guard++ < 20) {
    const p = sim.pending;
    const inp: any = p.input;
    if (p.player === 0 && p.why === 'may' && String(p.prompt).includes('オルゲイト')) n++;
    if (inp.shape === 'yesno') sim.answer(false);
    else if (inp.shape === 'order') sim.answer(inp.candidates[0]);
    else sim.drain(1);
  }
  return n;
}

describe('L4 オルゲイトがコピーできる能力の範囲(公式 Q&A 46068・45938・44353)', () => {
  const base = (hand: string[]) =>
    new Sim({
      active: 1,
      p0: { battle: ['魔誕の斬将オルゲイト'], deck: [N, W, D, 'ダミー', 'ダミー', 'ダミー'] },
      p1: { battle: [{ c: 'ヨビニオン・マルル', sick: false }], hand, mana: [W, W, W, W, W, W, D, N, N], deck: [W, D, N, 'ダミー', 'ダミー', 'ダミー', 'ダミー'] },
    });
  it('出たクリーチャー自身の能力がトリガーした時にコピーできる(そのターンの1体目のアクアン)', () => {
    const sim = base([W]);
    sim.play(W);
    expect(orgateAsks(sim)).toBe(1);
  });
  it('別のクリーチャーが出たことでトリガーした能力(マルルの「2体目が出た時」)はコピーできず、出た自身の能力だけ', () => {
    const sim = base([W, '天災 デドダム']);
    sim.play(W);
    orgateAsks(sim);
    sim.play('天災 デドダム');
    // マルルの能力もトリガーしているが、コピーできるのはデドダム自身の「出た時」の1回だけ
    expect(orgateAsks(sim)).toBe(1);
  });
  it('マルル自身が2体目として出た時は、マルルの「2体目が出た時」もコピーできる(ヨビニオンと合わせて2回)', () => {
    const sim = base([W, 'ヨビニオン・マルル']);
    sim.play(W);
    orgateAsks(sim);
    sim.play('ヨビニオン・マルル');
    expect(orgateAsks(sim)).toBe(2);
  });
});

type Json = Record<string, unknown>;

function walk(x: unknown, f: (o: Json) => void): void {
  if (Array.isArray(x)) x.forEach((v) => walk(v, f));
  else if (x && typeof x === 'object') {
    f(x as Json);
    Object.values(x as Json).forEach((v) => walk(v, f));
  }
}

describe('D-5/L10 同時に離れたクリーチャーの誘発(R 603.5d)', () => {
  it('バトルゾーンを離れた時・どこからでも墓地に置かれた時に誘発する能力を持つカードは、既知のものだけ', () => {
    const found = new Set<string>();
    for (const card of CARD_LIST) {
      walk(card.faces, (o) => {
        if (o.kind !== 'trigger') return;
        const spec = o.spec as { on?: Json | Json[] } | undefined;
        const ons = Array.isArray(spec?.on) ? spec!.on : spec?.on ? [spec.on] : [];
        for (const on of ons) {
          // 引いた時(cause: draw)は、離れる出来事ではない
          if (on.type === 'moved' && on.from !== 'hand' && on.from !== 'shield' && on.cause !== 'draw') found.add(card.id);
        }
      });
    }
    // 完璧団長 オーパーツ銃: 「相手の墓地に置かれた時」。能力を持つ側は離れておらず(同時に離れる自身は、相手の墓地に置かれない)、
    // 相手のカードごとに誘発する(tests/cards/interstellar.test.ts)ので、603.5d の「自身のみ過去の状態を見る」の差は出ない
    // 「無月」の頂 ＄スザーク＄(dm26sd1-D09)も同じ形(「相手の墓地にどこからでもカードが置かれた時」)で、同じ扱い
    // 龍后人形メアリー・ジェニー(dm26sd1-F09)は「自分のデスパペットが離れた時」。自身も同時に離れる場合は、自身の分だけ誘発する(lookBack。603.5d)
    // ボルシャック・ヴォルジャアク(dm26sd1-G08)は「このクリーチャーが破壊された時」(lookBack で、離れる直前の状態を見る)
    // 熊田すず(dm26sd1-H04)は「相手のクリーチャーが破壊された時」。他のカードの離れた時は、能力を持つカードが同時に離れていれば誘発しない(603.5d)ので、現行の挙動と一致する
    // メガ・ラスト・バースト(dm26sd1-I05 同期の妖精 / I07 Napo獅子 / I08 調律師ピーカプ)は、自身が離れた時で、lookBack(離れる直前の状態を見る)で実装した
    expect([...found].sort()).toEqual(['dm26rp2-S09', 'dm26sd1-D09', 'dm26sd1-F09', 'dm26sd1-G08', 'dm26sd1-H04', 'dm26sd1-I05', 'dm26sd1-I07', 'dm26sd1-I08', 'dm26sd1-K05', 'dm26sd1-L02', 'dm26sd1-S02', 'dm26sd1-S05', 'dm26sd1-S13', 'dm26sd1-W06']);
  });
});

describe('D-12 自身が移動した時の誘発・D-10 EXライフの付与範囲', () => {
  it('「このクリーチャーが(バトルゾーンから)置かれた時」に誘発する能力を持つカードは、28枚にない(D-12)', () => {
    const found: string[] = [];
    for (const card of CARD_LIST) {
      walk(card.faces, (o) => {
        const spec = o.spec as { on?: Json | Json[]; subject?: string } | undefined;
        if (o.kind !== 'trigger' || !spec) return;
        const ons = Array.isArray(spec.on) ? spec.on : spec.on ? [spec.on] : [];
        if (ons.some((on) => on.type === 'moved') && (spec.subject === 'self' || ons.some((on) => on.self === true))) found.push(card.id);
      });
    }
    // dmrp17-km2(ドルファディロム)は「出た時、または EXライフのシールドが離れた時」で、自身の移動ではない。
    // dm26sd1-G08(ボルシャック・ヴォルジャアク)は「このクリーチャーが破壊された時」で、lookBack(離れる直前の状態を見る。603.5)で実装した
    // dm26sd1-I05 / I07 / I08 はメガ・ラスト・バースト(自身が離れて、手札・マナ・墓地に置かれた時。lookBack)
    // dm26sd1-J11(閃光の精霊カンビアーレ)の革命0は「シールドゾーンから手札に加えた時」で、バトルゾーンを離れる出来事ではない
    // dm26sd1-K05(Q.Q.QX.)の「このクリーチャーが離れた時」は、lookBack(離れる直前の状態を見る)で実装した
    // dm26sd1-L02(不敗のダイハード・リュウセイ)の「破壊された時」も、lookBack で実装した
    // dm26sd1-S02(ヴェネラック-F5)は「このクリーチャーが離れた時」、S13(ドラン・ゴル・ゲルス)はメガ・ラスト・バースト(ともに lookBack)。S05(94nm4)の「シールドゾーンにカードを置いた時」は、バトルゾーンを離れる出来事ではない
    // dm26sd1-W06(超次元の王家)の「このカードが超次元ゾーンに置かれた時」・W10(邪心臓の魔法陣)の「手札からマナゾーンに置いた時」は、バトルゾーンを離れる出来事ではない
    // dm26sd1-O11(邪脳の魔法陣)の「手札からマナゾーンに置いた時、アンタップする」は、マナゾーンにあるカードが自身の移動で誘発するもので、バトルゾーンを離れる出来事ではない
    expect(found.sort()).toEqual(['dm26sd1-G08', 'dm26sd1-I05', 'dm26sd1-I07', 'dm26sd1-I08', 'dm26sd1-J11', 'dm26sd1-K05', 'dm26sd1-L02', 'dm26sd1-O11', 'dm26sd1-S02', 'dm26sd1-S13', 'dm26sd1-W06', 'dm26sd1-W10', 'dmrp17-km2']);
  });
  it('EXライフを持つ進化クリーチャーはない。進化元の EXライフを進化先が使う場面(公式 Q&A 42663)は、28枚では起きない(D-10)', () => {
    const evoWithEx: string[] = [];
    for (const card of CARD_LIST) {
      for (const f of card.faces) {
        const isEvo = f.type === 'evolution' || f.type === 'smaxEvolution';
        const hasEx = (f.abilities ?? []).some((a) => (a as { kind?: string; name?: string }).kind === 'keyword' && (a as { name?: string }).name === 'exLife');
        if (isEvo && hasEx) evoWithEx.push(card.id);
      }
    }
    expect(evoWithEx).toEqual([]);
  });
});

describe('D-6/L9 山札切れの判定時点(R 104.2b)', () => {
  it('山札のカードを山札の外に出して、同じ効果の中で山札に戻す能力はない(一瞬でも0枚になる場面がない)', () => {
    // 山札へ移す原始操作(move / put の to: deck)と、「唱えた後山札の下に置く」(after: deckBottom。解決後の1回の移動)だけ。
    const toDeck: string[] = [];
    for (const card of CARD_LIST) {
      walk(card.faces, (o) => {
        const act = o as { move?: Json; put?: Json; to?: unknown };
        if (act.to === 'deck' || (act.move && act.move.to === 'deck') || (act.put && act.put.to === 'deck')) toDeck.push(card.id);
      });
    }
    // 25の王道で足したカードのうち、山札の外のカード(手札など)を山札へ移すだけで、山札を離れて戻るものではないもの(確認済み):
    //  dm26sd1-C11 一王二命三眼槍(ゲームに負ける時、かわりに手札のこのカードを山札の下に置く)
    //  dm26sd1-E01 オリオティス・ジャッジ(バトルゾーンのクリーチャーを山札の下に置く)
    //  dm26sd1-F01 Vチャロン(手札・シールドを山札の下に置き、その後、山札から引く・シールド化する)
    //  dm26sd1-M04 マーダン=ロウ(相手の墓地のカードの「出た時」の能力を使った後、そのカードを山札の下に置く)
    //  dm26sd1-O06 コーライルの海幻(バトルゾーンのクリーチャーまたはタマシードを山札の下に置き、カードを1枚引く)
    //  dm26sd1-X02 ウラギリダムス(下に重ねたカードを5枚、山札の下に置く。山札の外のカードを山札へ移すだけ)
    const SAFE = new Set(['dm26sd1-C11', 'dm26sd1-E01', 'dm26sd1-F01', 'dm26sd1-M04', 'dm26sd1-O06', 'dm26sd1-X02']);
    expect(toDeck.filter((id) => !SAFE.has(id))).toEqual([]);
  });
});
