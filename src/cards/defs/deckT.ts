// デッキT「元祖守りの王道!光自然巨大ゲートデッキ」(docs/decks-25oudou.md)の新規カード。ブロッカーを出す・チャージャー・エスケープ・バラバラエティなど。
import type { Selector, StepDef } from '../../engine/ast';
import type { CardDef } from '../../engine/types';
import {
  act, and, blocker, breaker, card, cip, civ, costGte, creature, destroy, draw, evolution, exLife, ifc, isCreature, maybe, notEvolution, oppCreature, select,
  selectUpTo, spell, sTrigger, staticAb, tBreaker, trig, wBreaker,
} from '../dsl';

/** 手札の、進化ではない「ブロッカー」を持つクリーチャー(light なら光のもの) */
const handBlocker = (light: boolean): Selector => ({
  zone: 'hand',
  owner: 'self',
  type: 'creature',
  where: and({ hasKw: 'blocker' }, notEvolution, ...(light ? [civ('L')] : [])),
});

/** 手札の(光の)ブロッカーを、最大 n 体出す */
const putBlockers = (light: boolean, n: number, prompt: string): StepDef[] => [selectUpTo('$b', handBlocker(light), n, { prompt }), act({ put: { sel: '$b' } })];

/** 山札の上から4枚を表向きにして、コスト7以上のクリーチャーをすべて手札に加え、残りを山札の下に置く */
const blueprint = (): StepDef[] => [
  act({ lookTop: { n: 4, as: '$t' } }),
  act({ reveal: { items: '$t' } }),
  act({ move: { sel: { zone: 'deck', owner: 'self', of: '$t', type: 'creature', where: costGte(7) }, to: 'hand', cause: 'effect' } }),
  act({ bottom: { of: '$t' } }),
];

/** テイクバック・チャージャー(チャージャー: この呪文を唱えた後、墓地に置くかわりにマナゾーンに置く) */
const takeback = (() => {
  const f = spell('テイクバック・チャージャー', 3, 'N', [], [
    selectUpTo('$e', { zone: 'battle', owner: 'any', type: 'element', chooseable: true, where: { cost: { lte: 3 } } }, 1, { prompt: 'タップして持ち主のマナゾーンに置くコスト3以下のエレメントを選んでください' }),
    act({ move: { sel: '$e', to: 'mana', cause: 'manaPlace', tapped: true } }),
  ], ['ジャイアント・スキル']);
  return { ...f, abilities: [{ kind: 'replace' as const, label: 'チャージャー', match: { type: 'moved', cause: 'cast' }, apply: { type: 'changeDest' as const, to: 'mana' as const } }, ...f.abilities] };
})();

export const DECK_T: CardDef[] = [
  // 1. 闘門の精霊ウェルキウス
  card(
    'dm26sd1-T01',
    creature('闘門の精霊ウェルキウス', 9, 'L', 7500, ['エンジェル・コマンド'], [
      blocker(),
      wBreaker(),
      trig({ on: [{ type: 'entered', self: true }, { type: 'battleEnded', winner: 'self' }], subject: 'any' }, [
        draw(1),
        maybe(putBlockers(false, 1, '出す、手札の「ブロッカー」を持つクリーチャーを選んでください'), '「ブロッカー」を持つクリーチャーを手札から出しますか?'),
      ], { label: '出た時または自分のクリーチャーがバトルに勝った時、カードを1枚引く。その後、「ブロッカー」を持つクリーチャーを1体、自分の手札から出してもよい' }),
    ]),
  ),

  // 2. 光開の精霊サイフォゲート
  card(
    'dm26sd1-T02',
    creature('光開の精霊サイフォゲート', 6, 'L', 3500, ['エンジェル・コマンド'], [
      sTrigger(),
      blocker(),
      cip([maybe(putBlockers(true, 1, '出す、手札の光の「ブロッカー」を持つ進化ではないクリーチャーを選んでください'), '光の「ブロッカー」を持つ進化ではないクリーチャーを手札から出しますか?')]),
    ]),
  ),

  // 3. 星門の精霊アケルナル / スターゲイズ・ゲート
  card(
    'dm26sd1-T03',
    creature('星門の精霊アケルナル', 9, 'L', 10500, ['エンジェル・コマンド'], [
      blocker(),
      wBreaker(),
      trig({ on: { type: 'stepStart', step: 'end', player: 'self' }, subject: 'any' }, [maybe(putBlockers(true, 1, '出す、手札の光の「ブロッカー」を持つ進化ではないクリーチャーを選んでください'), '光の「ブロッカー」を持つ進化ではないクリーチャーを手札から出しますか?')], {
        label: '自分のターンの終わりに、光の「ブロッカー」を持つ、進化ではないクリーチャーを1体、自分の手札から出してもよい',
      }),
    ]),
    spell('スターゲイズ・ゲート', 5, 'L', [], putBlockers(true, 1, '出す、手札の光の「ブロッカー」を持つ進化ではないクリーチャーを選んでください')),
  ),

  // 4. ヘブンズ・ゲート
  card('dm26sd1-T04', spell('ヘブンズ・ゲート', 6, 'L', [sTrigger()], putBlockers(true, 2, '出す、手札の光の「ブロッカー」を持つ進化ではないクリーチャーを2体まで選んでください'))),

  // 5. 竹馬の超人 / テイクバック・チャージャー
  card(
    'dm26sd1-T05',
    creature('竹馬の超人', 7, 'N', 11000, ['ジャイアント'], [wBreaker(), cip([act({ moveTop: { n: 2, to: 'mana', cause: 'effect', tapped: true } })])]),
    takeback,
  ),

  // 6. 巨大設計図
  card('dm26sd1-T06', spell('巨大設計図', 2, 'N', [], blueprint())),

  // 7. 冥界を統べる新月のハーデス
  card(
    'dm26sd1-T07',
    creature('冥界を統べる新月のハーデス', 9, 'LD', 15500, ['エンジェル・コマンド', 'デーモン・コマンド', '月光王国'], [
      blocker(),
      tBreaker(),
      {
        kind: 'replace',
        label: 'エスケープ: 自分のクリーチャーが破壊される時、墓地に置くかわりに自分のシールドを1つ手札に加えてもよい(「S・トリガー」は使えない)',
        optional: true,
        match: { type: 'leave', owner: 'self', cause: 'destroy', cond: isCreature },
        while: { count: { zone: 'shield', owner: 'self' }, gte: 1 },
        apply: { type: 'steps', steps: [select('$s', { zone: 'shield', owner: 'self' }, { prompt: '手札に加えるシールドを選んでください(裏向き)' }), act({ move: { sel: '$s', to: 'hand', cause: 'effect' } })] },
      },
      trig({ on: { type: 'moved', from: 'shield', owner: 'self' }, subject: 'any' }, [select('$t', oppCreature(), { prompt: '破壊する相手のクリーチャーを選んでください' }), destroy('$t')], {
        label: 'オシオキムーン: カードが自分のシールドゾーンを離れた時、相手のクリーチャーを1体選び、破壊する',
      }),
    ]),
  ),

  // 8. 剛撃聖霊シェバ・エリクシア
  card(
    'dm26sd1-T08',
    creature('剛撃聖霊シェバ・エリクシア', 8, 'LN', 18000, ['ジャイアント', 'エンジェル・コマンド'], [
      blocker(),
      breaker(4),
      cip([
        {
          op: 'select',
          as: '$m',
          from: { zone: 'mana', owner: 'self', type: 'creature', where: notEvolution },
          min: 0,
          max: 2,
          sumLte: 7,
          prompt: 'コストの合計が7以下になるように、マナゾーンから出すクリーチャーを2体まで選んでください',
        },
        act({ put: { sel: '$m' } }),
      ]),
      staticAb({ type: 'cannotLeaveOwn', cond: isCreature, exceptDestroy: true }, { fiveCivs: { zone: 'battle', owner: 'self' } }),
    ]),
  ),

  // 9. 閃光の神官 ヴェルベット / フェアリー・パワー
  card(
    'dm26sd1-T09',
    creature('閃光の神官 ヴェルベット', 9, 'L', 11000, ['オラクル'], [blocker(), staticAb({ type: 'enterTapped' }), wBreaker()]),
    spell('フェアリー・パワー', 3, 'N', [], [
      act({ moveTop: { n: 1, to: 'mana', cause: 'effect', as: '$m' } }),
      ifc({ some: { var: '$m', where: and({ type: 'creature' }, { power: { gte: 6000 } }) } }, [draw(1)]),
    ]),
  ),

  // 10. 超七極 Gio / 巨大設計図
  card(
    'dm26sd1-T10',
    evolution('超七極 Gio', 9, 'L', 11500, ['エンジェル・コマンド', '侵略者'], and(isCreature, civ('L')), [
      // 手札の他のコスト9のカードを、好きな数相手に見せてもよい: 1枚につき召喚コストを1少なくする(見せられるものは、すべて見せるとして扱う)
      { kind: 'selfCost', delta: { mul: [-1, { count: { zone: 'hand', owner: 'self', notSelf: true, where: { cost: { eq: 9 } } } }] }, floor: 1 },
      blocker(),
      wBreaker(),
    ]),
    spell('巨大設計図', 2, 'N', [], blueprint()),
  ),

  // 11. 邪光魔縛 ネロマノフ=ルドルフI世
  card(
    'dm26sd1-T11',
    creature('邪光魔縛 ネロマノフ=ルドルフI世', 7, 'LDN', 11000, ['ディスペクター', 'エンジェル・コマンド', 'ダークロード', 'ナイト'], [
      exLife(),
      blocker(),
      wBreaker(),
      cip([
        act({ moveTop: { n: 2, to: 'mana', cause: 'effect', tapped: true } }),
        selectUpTo('$r', { zone: 'mana', owner: 'self' }, 2, { prompt: '手札に戻すマナゾーンのカードを2枚まで選んでください' }),
        act({ move: { sel: '$r', to: 'hand', cause: 'effect' } }),
      ]),
      trig({ on: [{ type: 'attackDeclared', owner: 'opponent', targetKind: 'player' }, { type: 'attackDeclared', owner: 'opponent', targetSelf: true }], subject: 'any', limit: { perTurn: 1 } }, [
        select('$d', { zone: 'hand', owner: 'opponent' }, { random: true }),
        act({ move: { sel: '$d', to: 'grave', cause: 'discard' } }),
      ], { label: '各ターンはじめて、自分またはこのクリーチャーが攻撃された時、各相手の手札を1枚見ないで選び、捨てさせる' }),
    ]),
  ),

  // 12. 終末縫合王 ミカドレオ
  card(
    'dm26sd1-T12',
    creature('終末縫合王 ミカドレオ', 10, 'WDN', 19000, ['ディスペクター', 'ゴッド', 'ゼニス'], [
      exLife(),
      blocker(),
      breaker(4),
      cip([
        act({ lookTop: { n: 4, as: '$top' } }),
        act({ reveal: { items: '$top' } }),
        selectUpTo('$c', { zone: 'deck', owner: 'self', of: '$top', type: 'creature', where: notEvolution }, 4, { prompt: '出すクリーチャーを好きな数選んでください' }),
        act({ put: { sel: '$c' } }),
        act({ move: { sel: { zone: 'deck', owner: 'self', of: '$top' }, to: 'mana', cause: 'effect' } }),
      ], { via: 'summon', label: '召喚によって出た時、山札の上から4枚を表向きにする。その中から好きな数のクリーチャーを出し、残りをマナゾーンに置く' }),
      trig({ on: { type: 'stepStart', step: 'start', player: 'self' }, subject: 'any', if: { count: { zone: 'battle', owner: 'self', type: 'creature', where: costGte(8) }, gte: 4 } }, [act({ win: {} })], {
        label: '自分のターンのはじめに、自分のコスト8以上のクリーチャーが4体以上あれば、自分はゲームに勝つ',
      }),
    ]),
  ),
];

