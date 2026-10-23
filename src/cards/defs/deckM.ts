// デッキM「ウィンの革命チェンジ闇自然アビスデッキ」(docs/decks-25oudou.md)の新規カード。
import type { CardDef } from '../../engine/types';
import {
  abyssRush, act, and, blocker, card, cip, civ, costGte, costLte, creature, destroy, draw, ifc, isCreature, machFighter, maybe, mekureido, onAttack,
  oppCreature, poweredBreaker, race, revolutionChange, sBack, select, selectUpTo, slayer, spell, staticAb, trig, wBreaker,
} from '../dsl';

const ABYSS = 'アビス';

/** 相手の手札を1枚見ないで選び、捨てさせる */
const blindDiscard = () => [select('$bd', { zone: 'hand', owner: 'opponent' }, { random: true }), act({ move: { sel: '$bd', to: 'grave', cause: 'discard' } })];

export const DECK_M: CardDef[] = [
  // 1. 邪幽 ジャガイスト(殿堂入り)
  card(
    'dm26sd1-M01',
    creature('邪幽 ジャガイスト', 5, 'D', 9000, ['アビスドラゴン'], [
      blocker(),
      wBreaker(),
      cip([maybe([select('$h', { zone: 'hand', owner: 'self' }, { min: 2, max: 2, prompt: '捨てる手札を2枚選んでください' }), act({ move: { sel: '$h', to: 'grave', cause: 'discard' } }), ...mekureido(ABYSS, 5)], '手札を2枚捨てて、アビス・メクレイド5しますか?')], {
        // 手札が2枚なければ、2枚は捨てられない
        ifAtResolve: { count: { zone: 'hand', owner: 'self' }, gte: 2 },
      }),
      trig(
        { on: { type: 'entered', owner: 'self', from: 'deck', cond: isCreature }, subject: 'any', limit: { perTurn: 1 } },
        [
          selectUpTo('$g', { zone: 'grave', owner: 'self', type: 'creature', where: and(race(ABYSS), costLte({ costOf: '$ev.card' })) }, 1, { prompt: '出す、墓地のアビス・クリーチャーを選んでください(出さなくてもよい)' }),
          act({ put: { sel: '$g' } }),
          act({ rush: { sel: '$g', ifAttacked: true } }),
        ],
        { label: '各ターンに1度、自分の山札からクリーチャーが出た時、そのクリーチャー以下のコストのアビスを自分の墓地から出してもよい' },
      ),
    ]),
  ),

  // 2. 邪闘 シス
  card(
    'dm26sd1-M02',
    creature('邪闘 シス', 6, 'D', 9000, ['アビスキマイラ'], [
      abyssRush(),
      wBreaker(),
      cip([select('$t', oppCreature()), act({ addEffect: { sel: '$t', mod: { kind: 'powerAdd', n: -999999 }, until: 'endOfTurn' } })]),
      onAttack([maybe(mekureido(ABYSS, 5, 2), 'アビス・W・メクレイド5しますか?')], { label: '攻撃する時、アビス・W・メクレイド5してもよい' }),
    ]),
  ),

  // 3. アビスベル=ジャシン帝
  card(
    'dm26sd1-M03',
    creature('アビスベル=ジャシン帝', 4, 'D', 7000, ['アビスロイヤル'], [
      blocker(),
      wBreaker(),
      staticAb({ type: 'allowPlayFrom', from: 'grave', cond: and(isCreature, race(ABYSS)), rush: true }),
      {
        kind: 'replace',
        label: 'このクリーチャーが離れる時、かわりに自分の手札を2枚捨ててもよい',
        optional: true,
        match: { type: 'leave', cond: { isSelf: true } },
        while: { count: { zone: 'hand', owner: 'self' }, gte: 2 },
        apply: {
          type: 'steps',
          steps: [select('$h', { zone: 'hand', owner: 'self' }, { min: 2, max: 2, prompt: '捨てる手札を2枚選んでください' }), act({ move: { sel: '$h', to: 'grave', cause: 'discard' } })],
        },
      },
      staticAb({ type: 'costDelta', delta: -2, cond: and(isCreature, { zoneIs: 'grave' }), floor: 1 }),
    ]),
  ),

  // 4. 深淵の壊炉 マーダン=ロウ
  card(
    'dm26sd1-M04',
    creature('深淵の壊炉 マーダン=ロウ', 4, 'D', 4000, ['アビスロイヤル'], [
      slayer(),
      cip([
        select('$d', { zone: 'hand', owner: 'opponent', type: 'creature' }, { prompt: '捨てさせる、相手の手札のクリーチャーを選んでください' }),
        act({ move: { sel: '$d', to: 'grave', cause: 'discard' } }),
      ]),
      onAttack(
        [
          ifc(
            {
              cmp: {
                l: {
                  add: [
                    { count: { zone: 'battle', owner: 'self', type: 'creature', where: civ('D') } },
                    { count: { zone: 'battle', owner: 'self', type: 'tamaseed', where: civ('D') } },
                  ],
                },
                op: '>=',
                r: 3,
              },
            },
            [
              selectUpTo('$g', { zone: 'grave', owner: 'opponent', type: 'creature' }, 1, { prompt: '「出た時」の能力を使う、相手の墓地のクリーチャーを選んでください' }),
              act({ useCip: { sel: '$g' } }),
              act({ move: { sel: '$g', to: 'deck', cause: 'effect', pos: 'bottom' } }),
            ],
          ),
        ],
        { label: 'シビルカウント3: 攻撃する時、闇のクリーチャーまたはタマシードが3つ以上あれば、相手の墓地のカードの「出た時」の能力を使ってもよい' },
      ),
    ]),
  ),

  // 5. 謀遠 テレスコ=テレス
  card(
    'dm26sd1-M05',
    creature('謀遠 テレスコ=テレス', 5, 'D', 5000, ['アビスロイヤル'], [
      blocker(),
      poweredBreaker(6000),
      trig({ on: { type: 'stepStart', step: 'start', player: 'opponent' }, subject: 'any' }, blindDiscard(), { label: '相手のターンのはじめに、相手の手札を1枚見ないで選び、捨てさせる' }),
      trig({ on: { type: 'moved', from: 'hand', to: 'grave', cause: 'discard', owner: 'opponent' }, subject: 'any' }, [maybe([draw(1)], 'カードを1枚引きますか?')], {
        label: '相手が自身の手札を1枚捨てた時、カードを1枚引いてもよい',
      }),
      staticAb({ type: 'powerAdd', n: 5000 }, { count: { zone: 'hand', owner: 'self' }, eq: 0 }),
      staticAb({ type: 'powerAdd', n: 5000 }, { count: { zone: 'hand', owner: 'opponent' }, eq: 0 }),
    ]),
  ),

  // 6. フットレス=トレース / 「力が欲しいか?」
  card(
    'dm26sd1-M06',
    creature('フットレス=トレース', 4, 'D', 4000, ['アビスロイヤル'], [
      blocker(),
      trig({ on: { type: 'stepStart', step: 'end', player: 'self' }, subject: 'any' }, [
        act({ moveTop: { n: 1, to: 'grave', cause: 'trash' } }),
        selectUpTo('$r', { zone: 'grave', owner: 'self', where: civ('D') }, 1, { prompt: '手札に戻す、墓地の闇のカードを選んでください(戻さなくてもよい)' }),
        act({ move: { sel: '$r', to: 'hand', cause: 'effect' } }),
      ], { label: '自分のターンの終わりに、山札の上から1枚を墓地に置き、闇のカードを1枚、墓地から手札に戻してもよい' }),
    ]),
    spell('「力が欲しいか?」', 4, 'D', [], mekureido(ABYSS, 5), ['アビスへの誘い']),
  ),

  // 7. 秩序の意志
  card('dm26sd1-M07', {
    ...spell('秩序の意志', 4, 'D', [sBack(civ('D'))], [select('$t', oppCreature(), { prompt: '封印を付ける相手のクリーチャーを選んでください' }), act({ seal: { sel: '$t' } })]),
  }),

  // 8. ア:エヌ:マクア
  card(
    'dm26sd1-M08',
    creature('ア:エヌ:マクア', 5, 'N', 6000, ['ヴェールアビス'], [
      machFighter(),
      wBreaker(),
      cip([
        {
          op: 'modes',
          pick: 1,
          options: [
            {
              label: '山札の上から2枚をタップしてマナゾーンに置き、カードを1枚マナゾーンから手札に戻す',
              steps: [
                act({ moveTop: { n: 2, to: 'mana', cause: 'effect', tapped: true } }),
                select('$m', { zone: 'mana', owner: 'self' }, { prompt: '手札に戻すマナゾーンのカードを選んでください' }),
                act({ move: { sel: '$m', to: 'hand', cause: 'effect' } }),
              ],
            },
            { label: '自分の墓地をシャッフルして山札の下に置く', steps: [act({ graveToBottom: { who: 'self' } })] },
            { label: '相手の墓地をシャッフルして山札の下に置く', steps: [act({ graveToBottom: { who: 'opponent' } })] },
            {
              label: '相手は、自身のコスト5以下の、クリーチャーではないエレメントをすべてマナゾーンに置く',
              steps: [act({ move: { sel: { zone: 'battle', owner: 'opponent', type: 'element', where: and({ not: { type: 'creature' } }, costLte(5)) }, to: 'mana', cause: 'manaPlace' } })],
            },
          ],
        },
      ]),
    ]),
  ),

  // 9. アビスベル=覇=ロード
  card(
    'dm26sd1-M09',
    creature('アビスベル=覇=ロード', 7, 'DN', 11000, ['アビスロイヤル'], [
      revolutionChange('革命チェンジ[コスト5以上のアビス]', and(costGte(5), race(ABYSS))),
      wBreaker(),
      staticAb({ type: 'grantKeyword', keyword: 'machFighter', cond: and(isCreature, race(ABYSS)) }),
      trig({ on: { type: 'stepStart', step: 'end', player: 'self' }, subject: 'any' }, [
        selectUpTo('$g', { zone: ['grave', 'mana'], owner: 'self', type: 'creature', where: and(race(ABYSS), costLte(6)) }, 1, { prompt: '出す、墓地またはマナゾーンのアビス・クリーチャーを選んでください(出さなくてもよい)' }),
        act({ put: { sel: '$g' } }),
      ], { label: '自分のターンの終わりに、コスト6以下のアビス・クリーチャーを1体、墓地またはマナゾーンから出してもよい' }),
      staticAb({ type: 'attackMeFirst' }, { not: { logged: { pattern: { type: 'attackDeclared', owner: 'opponent' } } } }),
    ]),
  ),

  // 10. ドミー=ゾー / 「倒したいか?」
  card(
    'dm26sd1-M10',
    creature('ドミー=ゾー', 5, 'D', 6000, ['アビスロイヤル'], [
      abyssRush(),
      wBreaker(),
      cip([maybe([act({ moveTop: { n: 5, to: 'grave', cause: 'trash' } })], '山札の上から5枚を墓地に置きますか?')]),
    ]),
    spell('「倒したいか?」', 2, 'N', [], [act({ moveTop: { n: 1, to: 'mana', cause: 'effect' } })], ['アビスへの誘い']),
  ),

  // 11. 悪魔妖精ベラドンナ
  card(
    'dm26sd1-M11',
    creature('悪魔妖精ベラドンナ', 2, 'DN', 2000, ['スノーフェアリー', 'ファンキー・ナイトメア'], [
      cip([
        maybe(
          [
            destroy('$self'),
            {
              op: 'modes',
              pick: 1,
              options: [
                { label: '相手の手札を1枚見ないで選び、捨てさせる', steps: blindDiscard() },
                { label: '自分の山札の上から1枚目をマナゾーンに置く', steps: [act({ moveTop: { n: 1, to: 'mana', cause: 'effect' } })] },
              ],
            },
          ],
          'このクリーチャーを破壊しますか?',
        ),
      ]),
    ]),
  ),
];

