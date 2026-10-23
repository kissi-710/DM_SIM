// デッキE「呪文連打でコンボを目指せゴスペルデッキ」(docs/decks-25oudou.md)の新規カード。
import type { CardDef } from '../../engine/types';
import {
  act, and, blocker, bounce, card, costLte, creature, destroy, draw, ifc, notEvolution, onAttack, oppCreature, select, selectUpTo, spell, sTrigger,
  wBreaker, cip,
} from '../dsl';

/** 手札を1枚捨てる(捨てるカードは自分が選ぶ) */
const discardOne = (as = '$d') => [select(as, { zone: 'hand', owner: 'self' }, { prompt: '捨てる手札を選んでください' }), act({ move: { sel: as, to: 'grave', cause: 'discard', as: `${as}d` } })];

/** 次の自分のターンのはじめまで、相手のクリーチャー1体を攻撃もブロックもできなくする */
const lockOne = () => [
  select('$lk', oppCreature(), { prompt: '次の自分のターンのはじめまで、攻撃もブロックもできなくする相手のクリーチャーを選んでください' }),
  act({ addEffect: { sel: '$lk', mods: [{ kind: 'cannotAttack' }, { kind: 'cannotBlock' }], until: 'nextTurnStart' } }),
];

export const DECK_E: CardDef[] = [
  // 1. オリオティス・ジャッジ
  card(
    'dm26sd1-E01',
    spell('オリオティス・ジャッジ', 3, 'L', [sTrigger()], [
      {
        op: 'forPlayers',
        body: [
          act({
            move: {
              sel: { zone: 'battle', owner: 'iter', type: 'creature', where: { cost: { gte: { count: { zone: 'mana', owner: 'iter' } } } } },
              to: 'deck',
              pos: 'bottom',
              cause: 'effect',
            },
          }),
        ],
      },
    ]),
  ),

  // 2. ファイナル・ストップ
  card(
    'dm26sd1-E02',
    spell('ファイナル・ストップ', 4, 'L', [], [act({ playerEffect: { mod: { kind: 'cannotCast' }, until: 'oppTurnEnd' } }), draw(1)]),
  ),

  // 3. セイレーン・コンチェルト
  card(
    'dm26sd1-E03',
    spell('セイレーン・コンチェルト', 1, 'W', [sTrigger()], [
      select('$m', { zone: 'mana', owner: 'self' }, { prompt: '手札に戻すマナゾーンのカードを選んでください' }),
      bounce('$m'),
      select('$h', { zone: 'hand', owner: 'self' }, { prompt: 'マナゾーンに置く手札を選んでください' }),
      act({ move: { sel: '$h', to: 'mana', cause: 'effect' } }),
    ]),
  ),

  // 4. キリモミ・ヤマアラシ
  card(
    'dm26sd1-E04',
    spell('キリモミ・ヤマアラシ', 1, 'F', [], [act({ playerEffect: { mod: { kind: 'nextSummon', delta: -1, sa: true }, until: 'endOfTurn' } })]),
  ),

  // 5. 最期の竜炎
  card(
    'dm26sd1-E05',
    spell('最期の竜炎', 1, 'F', [sTrigger()], [
      ...discardOne(),
      // 「こうして捨てたカード以下」: 捨てられなかった(手札がない)なら、選ぶ対象がない
      ifc({ nonEmpty: '$dd' }, [
        select('$t', { zone: 'battle', owner: 'opponent', type: 'element', chooseable: true, where: { cost: { lte: { costOf: '$dd' } } } }, { prompt: '破壊する相手のエレメントを選んでください' }),
        destroy('$t'),
      ]),
    ]),
  ),

  // 6. 勇愛の天秤
  card(
    'dm26sd1-E06',
    spell('勇愛の天秤', 2, 'F', [sTrigger()], [
      {
        op: 'modes',
        pick: 1,
        options: [
          { label: '手札を1枚捨て、その後、カードを2枚引く', steps: [...discardOne(), draw(2)] },
          {
            label: '相手のパワー2000以下のクリーチャーを1体破壊する',
            steps: [select('$t', oppCreature({ power: { lte: 2000 } })), destroy('$t')],
          },
        ],
      },
    ]),
  ),

  // 7. バーニング・フィンガー(S・トリガー・プラス)
  card(
    'dm26sd1-E07',
    spell('バーニング・フィンガー', 2, 'F', [sTrigger()], [
      ...discardOne(),
      draw(2),
      // P: S・トリガーで使い、それが相手のターンで、そのターン中に自分のシールドが2つ以上ブレイクされていれば、相手のコスト6以下のエレメントを1つ破壊する
      ifc(and({ stUsed: true }, { turnOf: 'opponent' }, { logged: { pattern: { type: 'shieldBroken', owner: 'self' }, min: 2 } }), [
        select('$e', { zone: 'battle', owner: 'opponent', type: 'element', chooseable: true, where: costLte(6) }, { prompt: 'P: 破壊する相手のエレメントを選んでください' }),
        destroy('$e'),
      ]),
    ]),
  ),

  // 8. 水晶の王 ゴスペル
  card(
    'dm26sd1-E08',
    creature('水晶の王 ゴスペル', 9, 'LW', 11000, ['オラクル・セレス', 'キング・コマンド・ドラゴン', 'アンノウン'], [
      { kind: 'selfCost', delta: { sub: [0, { count: { zone: 'grave', owner: 'self', type: 'spell' } }] }, floor: 2 },
      blocker(),
      wBreaker(),
      cip([selectUpTo('$s', { zone: 'grave', owner: 'self', type: 'spell' }, 99, { prompt: '手札に戻す呪文を選んでください' }), bounce('$s')]),
      onAttack([
        selectUpTo('$c', { zone: 'hand', owner: 'self', type: 'spell' }, 1, { prompt: 'コストを支払わずに唱える呪文を選んでください(唱えなくてもよい)' }),
        act({ castFree: { sel: '$c' } }),
      ]),
    ]),
  ),

  // 9. 氷柱と炎弧の決断
  card(
    'dm26sd1-E09',
    spell('氷柱と炎弧の決断', 3, 'WF', [sTrigger({ count: { zone: 'grave', owner: 'self', type: 'spell' }, gte: 2 })], [
      {
        op: 'modes',
        pick: 2,
        repeat: true,
        options: [
          { label: '相手のクリーチャーを1体、攻撃もブロックもできなくする', steps: lockOne() },
          { label: '手札を1枚捨て、カードを2枚引く', steps: [...discardOne(), draw(2)] },
          {
            label: 'コスト2以下のエレメントを1つ、手札から出す',
            steps: [select('$p', { zone: 'hand', owner: 'self', type: 'element', where: and(costLte(2), notEvolution) }, { prompt: '手札から出すコスト2以下のエレメントを選んでください' }), act({ put: { sel: '$p' } })],
          },
        ],
      },
    ]),
  ),

  // 10. T・T・T
  card(
    'dm26sd1-E10',
    spell('T・T・T', 3, 'LWF', [], [
      {
        op: 'modes',
        pick: 1,
        options: [
          { label: '相手のクリーチャーを3体まで選び、タップする', steps: [selectUpTo('$t', oppCreature(), 3), act({ tap: { sel: '$t' } })] },
          { label: 'カードを3枚引く', steps: [draw(3)] },
          { label: 'このターン、次に召喚する自分のクリーチャーのコストを3少なくし、スピードアタッカーを与える', steps: [act({ playerEffect: { mod: { kind: 'nextSummon', delta: -3, sa: true }, until: 'endOfTurn' } })] },
        ],
      },
    ]),
  ),

  // 11. エンドレス・フローズン・カーニバル(コストのかわりに、手札からスノーフェアリーを5体捨てて唱えてもよい)
  card(
    'dm26sd1-E11',
    spell(
      'エンドレス・フローズン・カーニバル',
      15,
      'LWN',
      [{ kind: 'altCost', id: 'snow5', label: '手札からスノーフェアリーを5体捨てる', cost: { discard: { n: 5, where: { race: 'スノーフェアリー' } } } }],
      [
        act({ move: { sel: { zone: 'battle', owner: 'opponent', type: 'element', where: { not: { type: 'creature' } } }, to: 'grave', cause: 'destroy' } }),
        act({ move: { sel: { zone: 'shield', owner: 'opponent', where: { faceUp: true } }, to: 'grave', cause: 'trash' } }),
        act({ tapLock: { sel: { zone: 'battle', owner: 'opponent', type: 'creature' } } }),
        act({ tapLock: { sel: { zone: 'mana', owner: 'opponent' } } }),
      ],
    ),
  ),
];
