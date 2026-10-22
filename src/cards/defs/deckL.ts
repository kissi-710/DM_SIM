// デッキL「勝太のハンター&カイザー「刃鬼」デッキ」(docs/decks-25oudou.md)の新規カード。
import type { CardDef } from '../../engine/types';
import {
  act, and, blocker, card, creature, destroy, draw, gStrike, ifc, isCreature, justDiver, machFighter, maybe, mekureido, myCreature, onAttack,
  oppCreature, race, select, selectUpTo, speedAttacker, spell, sTrigger, staticAb, tBreaker, trig, wBreaker, log,
} from '../dsl';

const HUNTER = 'ハンター';
const DRAGON = 'ドラゴン';

export const DECK_L: CardDef[] = [
  // 1. 「合体」の頂 アクア・TITAAANS / 「必殺!ジェット・カスケード・アタック!!」
  card(
    'dm26sd1-L01',
    creature('「合体」の頂 アクア・TITAAANS', 10, 'W', 12000, ['リキッド・ピープル', 'ジャイアント・ハンター', 'ゼニス'], [
      gStrike(),
      blocker(),
      tBreaker(),
      trig({ on: { type: 'entered', owner: 'opponent', cond: isCreature }, subject: 'any' }, [
        act({ judge: { as: '$j' } }),
        ifc({ nonEmpty: '$j' }, [draw(1), act({ playerEffect: { mod: { kind: 'cannotAttackAny' }, until: 'endOfTurn' } })]),
      ], { label: '相手のクリーチャーが出た時、ガチンコ・ジャッジ。勝ったら、カードを1枚引き、このターン、相手のクリーチャーは攻撃できない' }),
    ]),
    spell('「必殺!ジェット・カスケード・アタック!!」', 3, 'W', [], [draw(2)], ['ジャイアント・スキル']),
  ),

  // 2. 不敗のダイハード・リュウセイ
  card(
    'dm26sd1-L02',
    creature('不敗のダイハード・リュウセイ', 8, 'F', 8000, ['レッド・コマンド・ドラゴン', 'ハンター'], [
      wBreaker(),
      trig({ on: { type: 'attackDeclared', owner: 'self', cond: race(DRAGON) }, subject: 'any' }, [
        select('$s', { zone: 'shield', owner: 'opponent' }, { prompt: '持ち主の墓地に置く、相手のシールドを選んでください(裏向き)' }),
        act({ move: { sel: '$s', to: 'grave', cause: 'trash' } }),
      ], { label: '自分のドラゴンが攻撃する時、相手のシールドを1つ墓地に置く' }),
      {
        kind: 'replace',
        label: '自分がゲームに負ける時、かわりにこのクリーチャーを破壊する',
        match: { type: 'gameLoss', player: 'self' },
        apply: { type: 'steps', steps: [destroy('$self')] },
      },
      trig({ on: { type: 'moved', from: 'battle', to: 'grave', cause: 'destroy' }, subject: 'self', lookBack: true }, [act({ playerEffect: { mod: { kind: 'cannotLose' }, until: 'endOfTurn' } })], {
        label: '破壊された時、そのターン、自分はゲームに負けない',
      }),
    ]),
  ),

  // 3. 「必然」の頂 リュウセイ / 「オレの勝利だオフコース!」
  card(
    'dm26sd1-L03',
    creature('「必然」の頂 リュウセイ', 10, 'F', 12000, ['レッド・コマンド・ドラゴン', 'ジャイアント・ハンター', 'ゼニス'], [
      gStrike(),
      tBreaker(),
      staticAb({ type: 'grantKeyword', keyword: 'speedAttacker', cond: isCreature }),
      {
        kind: 'replace',
        label: '各ターンに1度、自分がゲームに負ける時、かわりに自分のハンターを1つ破壊してもよい',
        optional: true,
        match: { type: 'gameLoss', player: 'self' },
        while: { not: { logged: { pattern: { type: 'hissenSub' } } } },
        apply: {
          type: 'steps',
          steps: [log('hissenSub'), select('$h', myCreature(race(HUNTER)), { prompt: '破壊する自分のハンターを選んでください' }), destroy('$h')],
        },
      },
    ]),
    spell(
      '「オレの勝利だオフコース!」',
      6,
      'F',
      [{ kind: 'selfCost', delta: { sub: [0, { count: { zone: 'battle', owner: 'opponent', type: 'creature' } }] }, floor: 1 }],
      [destroy({ zone: 'battle', owner: 'any', type: 'creature', where: { power: { lte: 4000 } } })],
      ['ジャイアント・スキル'],
    ),
  ),

  // 4. 紅に染まりし者「王牙」 / クリムゾン・ビクトリー
  card(
    'dm26sd1-L04',
    creature('紅に染まりし者「王牙」', 8, 'F', 8000, ['ヒューマノイド・ドラゴン', 'ハンター', 'エイリアン'], [
      speedAttacker(),
      wBreaker(),
      onAttack([
        act({ judge: { as: '$j' } }),
        ifc({ nonEmpty: '$j' }, [
          act({ lookTop: { n: 3, as: '$top' } }),
          selectUpTo('$d', { zone: 'deck', owner: 'self', of: '$top', type: 'creature', where: race(DRAGON) }, 1, { prompt: '出すドラゴン・クリーチャーを選んでください(出さなくてもよい)' }),
          act({ bottom: { of: '$top', except: '$d' } }),
          act({ put: { sel: '$d' } }),
        ]),
      ], { label: '攻撃する時、ガチンコ・ジャッジ。勝ったら、山札の上から3枚を見て、ドラゴン・クリーチャーを1体出してもよい' }),
    ]),
    spell('クリムゾン・ビクトリー', 4, 'F', [sTrigger()], [destroy({ zone: 'battle', owner: 'any', type: 'creature', where: { power: { lte: 2000 } } })]),
  ),

  // 5. 超神龍バイラス・カースド
  card(
    'dm26sd1-L05',
    creature('超神龍バイラス・カースド', 10, 'N', 17000, ['アース・ドラゴン', 'ミステリー・トーテム', 'ハンター'], [
      machFighter(),
      tBreaker(),
      staticAb({ type: 'noOppShieldTrigger' }, { selfTapped: true }),
      staticAb({ type: 'attackMeFirst' }),
    ]),
  ),

  // 6. 「根性」の頂 メチャデ塊ゾウ / 「大親分、ここにあり!」
  card(
    'dm26sd1-L06',
    creature('「根性」の頂 メチャデ塊ゾウ', 10, 'N', 14000, ['ビーストフォーク', 'ジャイアント・ハンター', 'ゼニス'], [
      gStrike(),
      machFighter(),
      tBreaker(),
      trig({ on: { type: 'battleEnded', winner: 'self' }, subject: 'self' }, [
        selectUpTo('$h', { zone: 'mana', owner: 'self', type: 'creature', where: and(race(HUNTER), { cost: { lte: { count: { zone: 'mana', owner: 'self' } } } }) }, 1, {
          prompt: 'コストを支払わずに召喚する、マナゾーンのハンター・クリーチャーを選んでください(召喚しなくてもよい)',
        }),
        act({ summon: { sel: '$h' } }),
      ], { label: 'バトルに勝った時、マナゾーンにあるカードの枚数以下のコストを持つハンターを、マナゾーンから召喚してもよい' }),
    ]),
    spell(
      '「大親分、ここにあり!」',
      3,
      'N',
      [],
      [
        act({ lookTop: { n: 2, as: '$t' } }),
        select('$m', { zone: 'deck', owner: 'self', of: '$t' }, { prompt: 'マナゾーンに置くカードを選んでください' }),
        act({ move: { sel: '$m', to: 'mana', cause: 'effect' } }),
        {
          op: 'modes',
          pick: 1,
          options: [
            { label: '残りを山札の上に置く', steps: [] },
            { label: '残りを山札の下に置く', steps: [act({ bottom: { of: '$t' } })] },
          ],
        },
      ],
      ['ジャイアント・スキル'],
    ),
  ),

  // 7. メヂカラ・コバルト・カイザー / アイド・ワイズ・シャッター
  card(
    'dm26sd1-L07',
    creature('メヂカラ・コバルト・カイザー', 7, 'W', 7000, ['ブルー・コマンド・ドラゴン', 'ハンター'], [
      wBreaker(),
      trig({ on: { type: 'entered', owner: 'opponent', cond: isCreature }, subject: 'any' }, [act({ playerEffect: { mod: { kind: 'cannotAttackAny' }, until: 'endOfTurn' } })], {
        label: '相手のクリーチャーが出た時、そのターン、相手のクリーチャーはすべて攻撃できない',
      }),
      trig({ on: { type: 'cast', owner: 'opponent' }, subject: 'any' }, [maybe([draw(2)], 'カードを2枚引きますか?')], { label: '相手が呪文を唱えた時、カードを2枚引いてもよい' }),
    ]),
    spell('アイド・ワイズ・シャッター', 4, 'L', [sTrigger()], [
      selectUpTo('$t', oppCreature(), 2, { prompt: 'タップする相手のクリーチャーを2体まで選んでください' }),
      act({ tapLock: { sel: '$t' } }),
    ]),
  ),

  // 8. 「勝利」の頂 カイザー「刃鬼」
  card(
    'dm26sd1-L08',
    creature('「勝利」の頂 カイザー「刃鬼」', 11, 'WFN', 17000, ['レッド・コマンド・ドラゴン', 'ジャイアント・ハンター', 'ゼニス'], [
      { kind: 'selfCost', delta: { sub: [0, { count: { zone: 'battle', owner: 'self', type: 'creature', where: race(HUNTER) } }] }, floor: 1 },
      justDiver(),
      tBreaker(),
      trig({ on: [{ type: 'entered', via: 'summon' }, { type: 'attackDeclared' }], subject: 'self' }, mekureido(HUNTER, 10, 2), { label: 'ハンター・W・メクレイド10' }),
      staticAb({ type: 'grantKeyword', keyword: 'speedAttacker', cond: { isSelf: true } }, { shields: { gte: 5, who: 'opponent' } }),
    ]),
  ),
];
