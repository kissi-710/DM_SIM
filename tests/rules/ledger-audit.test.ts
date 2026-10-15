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
          if (on.type === 'moved' && on.from !== 'hand' && on.from !== 'shield') found.add(card.id);
        }
      });
    }
    // 完璧団長 オーパーツ銃: 「相手の墓地に置かれた時」。能力を持つ側は離れておらず(同時に離れる自身は、相手の墓地に置かれない)、
    // 相手のカードごとに誘発する(tests/cards/interstellar.test.ts)ので、603.5d の「自身のみ過去の状態を見る」の差は出ない
    expect([...found].sort()).toEqual(['dm26rp2-S09']);
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
    expect(toDeck).toEqual([]);
  });
});
