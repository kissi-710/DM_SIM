// デッキC「シールドゼロで鬼札逆転４ｃ邪王門デッキ」(docs/decks-25oudou.md)の新規カード。
import type { CardDef } from '../../engine/types';
import {
  act, and, anyCiv, blocker, bounce, card, chooseNumber, cip, costGte, costLte, creature, destroy, draw, finalRevolution, ifc, justDiver,
  log, machFighter, manaHas, maybe, noShieldPlayer, notEvolution, onAttack, oppCreature, race, revolutionChange, select, selectUpTo, speedAttacker, spell,
  sTrigger, staticAb, tBreaker, toMana, trig, wBreaker,
} from '../dsl';

/** -∞ のかわりに使う、十分に小さい値(パワー0以下になって破壊される) */
const MINUS_INF = -999999999;


export const DECK_C: CardDef[] = [
  // 1. ♪立ち上がる 悪魔に天使 堕ちるかな
  card(
    'dm26sd1-C01',
    spell('♪立ち上がる 悪魔に天使 堕ちるかな', 4, 'W', [sTrigger()], [
      draw(1),
      chooseNumber('$n', 0, 12),
      act({ playerEffect: { mod: { kind: 'cannotCast', n: { var: '$n' } }, until: 'nextTurnStart' } }),
      act({ playerEffect: { mod: { kind: 'ignoreCost', n: { var: '$n' } }, until: 'nextTurnStart' } }),
    ]),
  ),

  // 2. 忍蛇の聖沌 c0br4
  card(
    'dm26sd1-C02',
    creature('忍蛇の聖沌 c0br4', 6, 'D', 5000, ['メカ・デル・ステラ', 'シノビ'], [
      sTrigger(),
      blocker(),
      cip([
        act({ moveTop: { n: 2, to: 'grave', cause: 'trash' } }),
        select('$c', { zone: 'grave', owner: 'self', type: 'creature', where: and(costLte(5), notEvolution) }),
        act({ put: { sel: '$c' } }),
      ]),
      cip([destroy('$self')], { turn: 'opponent', ifAtResolve: { not: { logged: { pattern: { type: 'shieldBroken', owner: 'self' }, min: 2 } } } }),
    ]),
  ),

  // 3. 深淵の逆転撃(逆転撃[闇(3)]: 攻撃された時に手札から無料で唱え、次の自分のターンのはじめに闇(3)を支払う)
  card(
    'dm26sd1-C03',
    spell(
      '深淵の逆転撃',
      4,
      'D',
      [
        {
          kind: 'trigger',
          label: '逆転撃[闇(3)]',
          optional: true,
          spec: {
            on: { type: 'attackDeclared', owner: 'opponent', targetKind: 'player' },
            watch: ['hand'],
            subject: 'any',
            if: { not: { logged: { pattern: { type: 'gyakutengeki' }, since: 'attackDeclared' } } },
          },
          steps: [
            log('gyakutengeki'),
            act({ castFree: { sel: '$self' } }),
            act({ playerEffect: { mod: { kind: 'owe', civ: 'darkness', n: 3 }, until: 'nextTurnStart' } }),
          ],
        },
      ],
      [select('$t', oppCreature()), act({ addEffect: { sel: '$t', mod: { kind: 'powerAdd', n: MINUS_INF }, until: 'endOfTurn' } })],
    ),
  ),

  // 4. 豊潤フォージュン
  card(
    'dm26sd1-C04',
    spell('豊潤フォージュン', 3, 'N', [], [toMana(1), ifc({ count: { zone: 'mana', owner: 'self' }, lte: 5 }, [draw(1)])]),
  ),

  // 5. 闘争類拳嘩目 ステゴロ・カイザー / お清めシャラップ
  card(
    'dm26sd1-C05',
    creature('闘争類拳嘩目 ステゴロ・カイザー', 7, 'N', 9000, ['ジュラシック・コマンド・ドラゴン', 'ハンター'], [
      machFighter(),
      wBreaker(),
      onAttack([toMana(1), maybe([select('$m', { zone: 'mana', owner: 'self' }), act({ move: { sel: '$m', to: 'hand', cause: 'effect' } })], 'マナゾーンのカードを手札に戻しますか?')]),
    ]),
    spell('お清めシャラップ', 3, 'N', [], [
      toMana(1),
      {
        op: 'modes',
        pick: 1,
        options: [
          {
            label: '自分の墓地',
            steps: [selectUpTo('$g', { zone: 'grave', owner: 'self' }, 99, { prompt: '山札に加えてシャッフルするカードを選んでください' }), act({ shuffleIn: { sel: '$g' } })],
          },
          {
            label: '相手の墓地',
            steps: [selectUpTo('$g', { zone: 'grave', owner: 'opponent' }, 99, { prompt: '山札に加えてシャッフルするカードを選んでください' }), act({ shuffleIn: { sel: '$g' } })],
          },
        ],
      },
    ]),
  ),

  // 6. 音卿の精霊龍 ラフルル・ラブ / 「未来から来る、だからミラクル」
  card(
    'dm26sd1-C06',
    creature('音卿の精霊龍 ラフルル・ラブ', 7, 'LW', 7000, ['エンジェル・コマンド・ドラゴン', 'ドレミ団', '革命軍'], [
      revolutionChange('革命チェンジ[光または水のドラゴン]', and(anyCiv('LW'), race('ドラゴン'))),
      wBreaker(),
      cip([act({ playerEffect: { mod: { kind: 'cannotCast' }, until: 'oppTurnEnd' } })]),
    ]),
    spell('「未来から来る、だからミラクル」', 6, 'LW', [], [
      draw(3),
      selectUpTo('$s', { zone: 'hand', owner: 'self', type: 'spell', where: costLte(5) }, 1, { prompt: 'コストを支払わずに唱える呪文を選んでください(唱えなくてもよい)' }),
      act({ castFree: { sel: '$s' } }),
    ]),
  ),

  // 7. 時の法皇 ミラダンテXII
  card(
    'dm26sd1-C07',
    creature('時の法皇 ミラダンテXII', 8, 'LW', 12000, ['エンジェル・コマンド・ドラゴン', '革命軍', 'ドレミ団'], [
      revolutionChange('革命チェンジ[光または水のコスト5以上のドラゴン]', and(anyCiv('LW'), costGte(5), race('ドラゴン'))),
      tBreaker(),
      cip([
        selectUpTo('$s', { zone: 'hand', owner: 'self', type: 'spell', where: and({ civ: 'light' }, costLte(5)) }, 1, { prompt: 'コストを支払わずに唱える光の呪文を選んでください(選ばなければカードを1枚引く)' }),
        ifc({ nonEmpty: '$s' }, [act({ castFree: { sel: '$s' } })], [draw(1)]),
      ]),
      finalRevolution([act({ playerEffect: { mod: { kind: 'cannotSummon', maxCost: 7 }, until: 'oppTurnEnd' } })]),
    ]),
  ),

  // 8. 龍素記号wD サイクルペディア
  card(
    'dm26sd1-C08',
    creature('龍素記号wD サイクルペディア', 5, 'WD', 5000, ['クリスタル・コマンド・ドラゴン', 'ダークロード'], [
      blocker(),
      justDiver(),
      cip(
        [
          select('$s', { zone: 'grave', owner: 'self', type: 'spell', where: costLte(4) }, { prompt: 'コストを支払わずに唱える呪文を選んでください' }),
          act({ castFree: { sel: '$s' } }),
        ],
        { optional: true, label: '墓地から呪文を無料で唱える' },
      ),
      trig(
        { on: { type: 'cast', owner: 'self', from: 'hand' }, subject: 'any', limit: { perTurn: 1 } },
        [select('$s', { zone: 'grave', owner: 'self', of: '$ev.card' }), act({ castFree: { sel: '$s' } })],
        { optional: true, label: '唱えた呪文を墓地から無料で唱える' },
      ),
      staticAb({ type: 'graveCastToBottom' }),
    ]),
  ),

  // 9. 百鬼の邪王門(鬼エンド: クリーチャーが攻撃する時、シールドが1つもないプレイヤーがいて、マナに闇と火があれば手札から無料で唱える)
  card(
    'dm26sd1-C09',
    spell(
      '百鬼の邪王門',
      6,
      'DF',
      [
        {
          kind: 'trigger',
          label: '鬼エンド',
          optional: true,
          spec: { on: { type: 'attackDeclared' }, watch: ['hand'], subject: 'any', if: and(noShieldPlayer, manaHas('DF')) },
          steps: [act({ castFree: { sel: '$self' } })],
        },
      ],
      [
        act({ moveTop: { n: 4, to: 'grave', cause: 'trash', as: '$g' } }),
        select('$c', { zone: 'grave', owner: 'self', of: '$g', type: 'creature', where: and(anyCiv('DF'), costLte(6), notEvolution) }),
        act({ put: { sel: '$c', as: '$e' } }),
        selectUpTo('$t', oppCreature(), 1, { prompt: 'バトルさせる相手のクリーチャーを選んでください(選ばなくてもよい)' }),
        act({ battle: { a: '$e', b: '$t' } }),
      ],
    ),
  ),

  // 10. 鬼ヶ大王 ジャオウガ
  card(
    'dm26sd1-C10',
    creature('鬼ヶ大王 ジャオウガ', 5, 'DF', 7000, ['デモニオ', '鬼札王国'], [
      speedAttacker(),
      wBreaker(),
      cip([act({ move: { sel: { zone: 'shield', owner: 'self' }, to: 'hand', cause: 'effect' } })], { optional: true, label: '自分のシールドをすべて手札に加える(S・トリガーは使えない)' }),
    ]),
  ),

  // 11. 一王二命三眼槍
  card(
    'dm26sd1-C11',
    creature('一王二命三眼槍', 5, 'DF', 6000, ['デモニオ', '鬼札王国'], [
      {
        kind: 'replace',
        label: 'ゲームに負ける時、かわりに手札のこのカードを表向きにして山札の下に置く',
        optional: true,
        match: { type: 'gameLoss', player: 'self', turn: 'opponent' },
        while: manaHas('DF'),
        apply: { type: 'steps', steps: [act({ move: { sel: '$self', to: 'deck', pos: 'bottom', cause: 'effect' } })] },
      },
      speedAttacker(),
      wBreaker(),
      cip(
        [
          act({ moveBottom: { n: 1, to: 'grave', cause: 'trash', as: '$b' } }),
          selectUpTo('$c', { zone: 'grave', owner: 'self', of: '$b', type: 'creature', where: and(costLte(5), notEvolution) }, 1),
          act({ put: { sel: '$c' } }),
        ],
        { ifAtResolve: noShieldPlayer },
      ),
    ]),
  ),

  // 12. 蒼き団長 ドギラゴン剣
  card(
    'dm26sd1-C12',
    creature('蒼き団長 ドギラゴン剣', 8, 'FN', 13000, ['メガ・コマンド・ドラゴン', '革命軍', 'ハムカツ団'], [
      revolutionChange('革命チェンジ[火または自然のコスト5以上のドラゴン]', and(anyCiv('FN'), costGte(5), race('ドラゴン'))),
      tBreaker(),
      staticAb({ type: 'grantKeyword', keyword: 'speedAttacker', cond: { multicolor: true } }),
      finalRevolution([
        {
          op: 'select',
          as: '$m',
          from: { zone: ['hand', 'mana'], owner: 'self', type: 'creature', where: and({ multicolor: true }, notEvolution) },
          sumLte: 6,
          prompt: 'コストの合計が6以下になるように、出す多色クリーチャーを選んでください',
        },
        act({ put: { sel: '$m' } }),
      ]),
    ]),
  ),

  // 13. 切札勝太&カツキング -熱血の物語-
  card(
    'dm26sd1-C13',
    creature('切札勝太&カツキング -熱血の物語-', 5, 'WFN', 5000, ['アウトレイジ・ドラゴン', 'ヒューマノイド'], [
      machFighter(),
      cip([
        act({ lookTop: { n: 5, as: '$top' } }),
        select('$p', { zone: 'deck', owner: 'self', of: '$top' }, { prompt: '表向きにして手札に加えるカードを選んでください' }),
        act({ reveal: { items: '$p' } }),
        act({ move: { sel: '$p', to: 'hand', cause: 'effect' } }),
        ifc({ some: { var: '$p', where: anyCiv('FN') } }, [
          maybe([select('$t', { zone: 'battle', owner: 'any', type: 'creature', chooseable: true }), bounce('$t')], 'クリーチャーを1体、持ち主の手札に戻しますか?'),
        ]),
        act({ bottom: { of: '$top' } }),
      ]),
      // 革命2: シールドが2つ以下なら、シールドゾーンから手札に加える時にS・トリガーを得る
      sTrigger({ shields: { lte: 2 } }),
      // 革命0: シールドが1つもなければ、パワー+10000・スピードアタッカー・T・ブレイカー
      staticAb({ type: 'powerAdd', n: 10000 }, { shields: { eq: 0 } }),
      staticAb({ type: 'grantKeyword', keyword: 'speedAttacker', cond: { isSelf: true } }, { shields: { eq: 0 } }),
      { kind: 'keyword', name: 'breaker', n: 3, while: { shields: { eq: 0 } } },
    ]),
  ),
];
