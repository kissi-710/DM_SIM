// デッキH「ドラゴン娘の生徒会大集結ドラゴンデッキ」(docs/decks-25oudou.md)の新規カード。
import type { CardDef } from '../../engine/types';
import {
  act, and, anyCiv, blocker, bounce, breaker, card, cip, costGte, creature, destroy, finalRevolution, ifc, maybe,
  not, notEvolution, onAttack, oppCreature, race, revolutionChange, select, selectUpTo, speedAttacker, spell, sTrigger, staticAb, tBreaker, trig, wBreaker,
} from '../dsl';

const DRAGON = 'ドラゴン';

/** 相手のターンに出た時、そのターンに自分のシールドが2つ以上ブレイクされていなければ、このクリーチャーを破壊する */
const oppTurnDrawback = () =>
  cip([destroy('$self')], { turn: 'opponent', ifAtResolve: { not: { logged: { pattern: { type: 'shieldBroken', owner: 'self' }, min: 2 } } } });

export const DECK_H: CardDef[] = [
  // 1. 煌龍 サッヴァーク
  card(
    'dm26sd1-H01',
    creature('煌龍 サッヴァーク', 7, 'L', 11000, ['マスター・ドラゴン', 'メタリカ'], [
      breaker(2),
      // ドラゴン・W・ブレイカー: 各ブレイクの前に、山札の上から1枚目をシールド化するか、表向きにしてから自分のシールド1つの上に置く
      trig(
        { on: { type: 'beforeBreak', selfAttacker: true }, subject: 'any' },
        [
          {
            op: 'repeat',
            times: { evLen: 'cards' },
            body: [
              {
                op: 'modes',
                pick: 1,
                options: [
                  { label: '山札の上から1枚目をシールド化する', steps: [act({ addShield: { n: 1 } })] },
                  {
                    label: '山札の上から1枚目を表向きにして、自分のシールド1つの上に置く',
                    steps: [
                      act({ lookTop: { n: 1, as: '$t' } }),
                      select('$s', { zone: 'shield', owner: 'self' }, { prompt: '重ねて置く自分のシールドを選んでください(裏向き)' }),
                      act({ stackShield: { sel: '$t', onto: '$s' } }),
                    ],
                  },
                ],
              },
            ],
          },
        ],
        { label: 'ドラゴン・W・ブレイカー: 各ブレイクの前に' },
      ),
      cip([
        select('$e', { zone: 'battle', owner: 'opponent', type: 'element', chooseable: true }, { prompt: '表向きでシールドの上に置く、相手のバトルゾーンのカードを選んでください' }),
        select('$s', { zone: 'shield', owner: 'opponent' }, { prompt: '重ねて置く、相手のシールドを選んでください(裏向き)' }),
        act({ stackShield: { sel: '$e', onto: '$s' } }),
      ]),
      {
        kind: 'replace',
        label: '自分のクリーチャーが離れる時、かわりに表向きのシールドを1枚墓地に置く',
        optional: true,
        match: { type: 'leave', owner: 'self', cond: { type: 'creature' } },
        while: { count: { zone: 'shield', owner: 'any', where: { faceUp: true } }, gte: 1 },
        apply: {
          type: 'steps',
          steps: [select('$f', { zone: 'shield', owner: 'any', where: { faceUp: true } }, { prompt: '持ち主の墓地に置く、表向きのシールドのカードを選んでください' }), act({ move: { sel: '$f', to: 'grave', cause: 'trash' } })],
        },
      },
    ]),
  ),

  // 2. サーヴァ・K・ゼオス
  card(
    'dm26sd1-H02',
    creature('サーヴァ・K・ゼオス', 8, 'L', 5000, ['マスター・ドラゴン', 'メタリカ'], [
      sTrigger(),
      blocker(),
      cip([maybe([select('$e', { zone: 'battle', owner: 'opponent', type: 'element', chooseable: true }), act({ move: { sel: '$e', to: 'shield', cause: 'shieldize' } })], '相手のエレメントを1つシールド化しますか?')]),
    ]),
  ),

  // 3. 蒼神龍トライクラブ・トライショット
  card(
    'dm26sd1-H03',
    creature('蒼神龍トライクラブ・トライショット', 6, 'W', 7000, ['ジャイアント・ポセイディア・ドラゴン'], [
      sTrigger(),
      blocker(),
      wBreaker(),
      cip([selectUpTo('$b', oppCreature(), 2, { prompt: '持ち主の手札に戻す相手のクリーチャーを2体まで選んでください' }), bounce('$b')]),
      oppTurnDrawback(),
    ]),
  ),

  // 4. 熊田すず
  card(
    'dm26sd1-H04',
    creature('熊田すず', 7, 'D', 4000, ['デーモン・コマンド・ドラゴン'], [
      sTrigger(),
      cip([select('$t', oppCreature()), destroy('$t')]),
      trig({ on: { type: 'moved', from: 'battle', cause: 'destroy', owner: 'opponent', kind: 'creature' }, subject: 'any' }, [
        select('$h', { zone: 'hand', owner: 'opponent' }, { who: 'opponent', prompt: '捨てる手札を選んでください' }),
        act({ move: { sel: '$h', to: 'grave', cause: 'discard' } }),
      ]),
    ]),
  ),

  // 5. 龍世界 ドラゴ大王
  card(
    'dm26sd1-H05',
    creature('龍世界 ドラゴ大王', 10, 'F', 13000, ['レッド・コマンド・ドラゴン'], [
      tBreaker(),
      cip([
        maybe(
          [
            select('$a', { zone: 'battle', owner: 'self', type: 'creature' }, { prompt: 'バトルさせる自分のクリーチャーを選んでください' }),
            select('$b', oppCreature(), { prompt: 'バトルさせる相手のクリーチャーを選んでください' }),
            act({ battle: { a: '$a', b: '$b' } }),
          ],
          '自分と相手のクリーチャーを1体ずつ選んで、バトルさせますか?',
        ),
      ]),
      {
        kind: 'replace',
        label: 'ドラゴンではないクリーチャーが出る時、かわりに持ち主の墓地に置く',
        match: { type: 'enter', owner: 'any', cond: and({ type: 'creature' }, not(race(DRAGON))) },
        apply: { type: 'changeDest', to: 'grave' },
      },
    ]),
  ),

  // 6. 勝利宣言 鬼丸「覇」
  card(
    'dm26sd1-H06',
    creature('勝利宣言 鬼丸「覇」', 10, 'F', 9000, ['ヒューマノイド', 'レッド・コマンド・ドラゴン', 'ハンター', 'エイリアン'], [
      speedAttacker(),
      staticAb({ type: 'powerAttacker', n: 5000 }),
      tBreaker(),
      onAttack([act({ judge: { as: '$j' } }), ifc({ nonEmpty: '$j' }, [act({ extraTurn: {} })])]),
    ]),
  ),

  // 7. 真久間メガ
  card(
    'dm26sd1-H07',
    creature('真久間メガ', 13, 'F', 13000, ['メガ・コマンド・ドラゴン', '革命軍'], [
      { kind: 'selfCost', delta: { sub: [0, { count: { zone: 'battle', owner: 'opponent', type: 'creature' } }] }, floor: 1 },
      speedAttacker(),
      tBreaker(),
      cip([destroy({ zone: 'battle', owner: 'opponent', type: 'creature', where: { power: { lte: 13000 } } })]),
    ]),
  ),

  // 8. 地封龍 ギャイア
  card(
    'dm26sd1-H08',
    creature('地封龍 ギャイア', 9, 'N', 18000, ['ガイア・コマンド・ドラゴン', '暴拳王国'], [
      breaker(4),
      {
        kind: 'replace',
        label: '相手の「出た時」で始まる能力を持つクリーチャーが出る時、かわりにマナゾーンに置く',
        match: { type: 'enter', owner: 'opponent', cond: and({ type: 'creature' }, { hasCip: true }) },
        apply: { type: 'changeDest', to: 'mana' },
      },
      staticAb({ type: 'allowPlayFrom', from: 'mana', cond: { type: 'creature' }, oncePerTurn: true }),
    ]),
  ),

  // 9. 地封院ギャイ
  card(
    'dm26sd1-H09',
    creature('地封院ギャイ', 6, 'N', 7000, ['ガイア・コマンド・ドラゴン'], [
      wBreaker(),
      cip([
        act({ lookTop: { n: 3, as: '$top' } }),
        act({ reveal: { items: '$top' } }),
        selectUpTo('$d', { zone: 'deck', owner: 'self', of: '$top', type: 'creature', where: race(DRAGON) }, 3, { prompt: '手札に加えるドラゴン・クリーチャーを好きな数選んでください' }),
        act({ move: { sel: '$d', to: 'hand', cause: 'effect' } }),
        act({ move: { sel: { zone: 'deck', owner: 'self', of: '$top' }, to: 'mana', cause: 'effect', tapped: true } }),
      ]),
      staticAb({ type: 'allowPlayFrom', from: 'mana', cond: and({ type: 'creature' }, race(DRAGON)), oncePerTurn: true }),
    ]),
  ),

  // 10. 蒼き守護神 ドギラゴン閃
  card(
    'dm26sd1-H10',
    creature('蒼き守護神 ドギラゴン閃', 8, 'LF', 13000, ['メガ・コマンド・ドラゴン', '革命軍', 'ハムカツ団'], [
      revolutionChange('革命チェンジ[光または火のコスト5以上のドラゴン]', and(anyCiv('LF'), costGte(5), race(DRAGON))),
      blocker(),
      tBreaker(),
      trig({ on: { type: 'stepStart', step: 'end', player: 'self' }, subject: 'any' }, [act({ untap: { sel: { zone: 'battle', owner: 'self', type: 'creature', where: { multicolor: true } } } })], { label: '自分のターンの終わりに、自分の多色クリーチャーをすべてアンタップする' }),
      finalRevolution([
        act({ lookTop: { n: 4, as: '$top' } }),
        act({ reveal: { items: '$top' } }),
        {
          op: 'select',
          as: '$m',
          from: { zone: 'deck', owner: 'self', of: '$top', type: 'creature', where: and({ multicolor: true }, notEvolution) },
          sumLte: 6,
          prompt: 'コストの合計が6以下になるように、出す多色クリーチャーを選んでください',
        },
        act({ put: { sel: '$m' } }),
        act({ bottom: { of: '$top' } }),
      ]),
    ]),
  ),

  // 11. 流星アーシュ
  card(
    'dm26sd1-H11',
    creature('流星アーシュ', 5, 'WN', 5000, ['ブルー・コマンド・ドラゴン', 'グリーン・コマンド・ドラゴン', 'ハンター'], [
      sTrigger(),
      blocker(),
      cip([
        act({ moveTop: { n: 1, to: 'mana', cause: 'effect', tapped: true } }),
        select('$d', { zone: 'mana', owner: 'self', type: 'creature', where: race(DRAGON) }, { prompt: '手札に戻すドラゴン・クリーチャーを選んでください' }),
        bounce('$d'),
        select('$t', oppCreature({ cost: { lte: { costOf: '$d' } } }), { prompt: '持ち主の手札に戻す、そのドラゴン以下のコストの相手のクリーチャーを選んでください' }),
        bounce('$t'),
      ]),
    ]),
  ),

  // 12. メンデルスゾーン
  card(
    'dm26sd1-H12',
    spell('メンデルスゾーン', 2, 'FN', [], [
      act({ lookTop: { n: 2, as: '$top' } }),
      act({ reveal: { items: '$top' } }),
      act({ move: { sel: { zone: 'deck', owner: 'self', of: '$top', where: race(DRAGON) }, to: 'mana', cause: 'effect', tapped: true } }),
      act({ move: { sel: { zone: 'deck', owner: 'self', of: '$top' }, to: 'grave', cause: 'trash' } }),
    ]),
  ),

  // 13. ボルシャック・栄光・ルピア
  card(
    'dm26sd1-H13',
    creature('ボルシャック・栄光・ルピア', 3, 'FN', 4000, ['ファイアー・バード', 'アーマード・ドラゴン'], [
      cip([
        act({ moveTop: { n: 1, to: 'mana', cause: 'effect', tapped: true, as: '$m' } }),
        ifc({ some: { var: '$m', where: race(DRAGON) } }, [act({ moveTop: { n: 1, to: 'mana', cause: 'effect', tapped: true } })]),
      ]),
    ]),
  ),

  // 14. ボルシャック・ドリーム・ドラゴン
  card(
    'dm26sd1-H14',
    creature('ボルシャック・ドリーム・ドラゴン', 7, 'LFN', 11000, ['アーマード・ドラゴン'], [
      { kind: 'selfCost', delta: -3, cond: { count: { zone: 'mana', owner: 'self', where: race(DRAGON) }, gte: 4 } },
      speedAttacker(),
      wBreaker(),
      trig(
        { on: { type: 'entered', owner: 'self', cond: and({ type: 'creature' }, race(DRAGON)) }, subject: 'any', limit: { perTurn: 1 } },
        [select('$t', oppCreature(), { prompt: 'タップする相手のクリーチャーを選んでください' }), act({ tap: { sel: '$t' } })],
        { optional: true, label: '各ターンに1度、自分のドラゴンが出た時、相手のクリーチャーを1体タップする' },
      ),
      onAttack([
        act({ lookTop: { n: 1, as: '$t' } }),
        act({ reveal: { items: '$t' } }),
        ifc({ some: { var: '$t', where: race(DRAGON) } }, [act({ put: { sel: '$t' } })], [act({ move: { sel: '$t', to: 'grave', cause: 'trash' } })]),
      ]),
    ]),
  ),
];
