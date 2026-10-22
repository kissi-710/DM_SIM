// デッキK「エンドレスガチンコバトル！ハチ公デッキ」(docs/decks-25oudou.md)の新規カード。
import type { CardDef } from '../../engine/types';
import {
  act, and, card, cip, civ, creature, destroy, draw, evolution, hyperEnergy, ifc, invasion, maybe, nameHas, oppCreature, poweredBreaker,
  race, select, selectUpTo, speedAttacker, spell, sTrigger, staticAb, trig, unlimited, wBreaker,
} from '../dsl';

/** ガチンコ・ジャッジに勝ったら(変数 $j に自分のカードが入る)、steps を行う */
const onJudgeWin = (steps: ReturnType<typeof act>[]) => [act({ judge: { as: '$j' } }), ifc({ nonEmpty: '$j' }, steps)];

export const DECK_K: CardDef[] = [
  // 1. 特攻の忠剣ハチ公(デッキに何枚入れてもよい)
  unlimited(
    card(
      'dm26sd1-K01',
      creature('特攻の忠剣ハチ公', 4, 'F', 3000, ['フレイム・コマンド', 'フレイム・モンスター', 'ハンター'], [
        speedAttacker(),
        trig(
          { on: { type: 'attackEnded' }, subject: 'self' },
          onJudgeWin([
            selectUpTo('$h', { zone: 'deck', owner: 'self', type: 'creature', where: nameHas('特攻の忠剣ハチ公') }, 1, { prompt: '山札から、バトルゾーンに出す《特攻の忠剣ハチ公》を選んでください(出さなくてもよい)' }),
            act({ put: { sel: '$h' } }),
            act({ shuffle: {} }),
          ]),
          { label: '攻撃の終わりに、ガチンコ・ジャッジ。勝ったら、山札から《特攻の忠剣ハチ公》を出してもよい' },
        ),
      ]),
    ),
  ),

  // 2. 熱き侵略 レッドゾーンZ
  card(
    'dm26sd1-K02',
    evolution('熱き侵略 レッドゾーンZ', 6, 'F', 11000, ['ソニック・コマンド', '侵略者'], and({ type: 'creature' }, civ('F')), [
      invasion('侵略[火のコマンド]', and(civ('F'), race('コマンド'))),
      wBreaker(),
      trig(
        { on: { type: 'evolved' }, subject: 'self', ifAtResolve: { onBase: { evolution: false } } },
        [select('$s', { zone: 'shield', owner: 'opponent' }, { prompt: '持ち主の墓地に置く、相手のシールドを選んでください(裏向き)' }), act({ move: { sel: '$s', to: 'grave', cause: 'trash' } })],
        { label: '進化ではないクリーチャーの上に置いた時、相手のシールドを1つ墓地に置く' },
      ),
    ]),
  ),

  // 3. D2V3 終断のレッドトロン / フォビドゥン・ハンド
  card(
    'dm26sd1-K03',
    creature('D2V3 終断のレッドトロン', 5, 'F', 5000, ['ソニック・コマンド', 'マスター・イニシャルズX'], [
      { kind: 'altCost', id: 'redtron', label: '召喚する時、手札を1枚捨ててもよい。そうしたら、召喚コストを2少なくする', cost: { discard: { n: 1 }, reduce: 2 } },
      cip([maybe([select('$t', oppCreature()), act({ battle: { a: '$self', b: '$t' } })], '相手のクリーチャーを1体選んで、このクリーチャーとバトルさせますか?')]),
    ]),
    spell('フォビドゥン・ハンド', 9, 'F', [sTrigger()], [
      select('$d', oppCreature({ power: { lte: 9999 } })),
      destroy('$d'),
      ifc({ count: { zone: 'battle', owner: 'self', type: 'field' }, gte: 1 }, [
        select('$e', oppCreature(), { prompt: '封印を付ける相手のクリーチャーを選んでください' }),
        act({ seal: { sel: '$e' } }),
      ]),
    ]),
  ),

  // 4. ストーム・ハイパーXX
  card(
    'dm26sd1-K04',
    creature('ストーム・ハイパーXX', 11, 'F', 0, ['アーマード・ドラゴン', 'フレイム・コマンド'], [
      sTrigger(),
      hyperEnergy(),
      poweredBreaker(6000),
      staticAb({ type: 'powerAddExpr', expr: { mul: [3000, { distinct: { sel: { zone: 'battle', owner: 'self', type: 'creature' }, by: 'cost' } }] } }),
      cip([destroy({ zone: 'battle', owner: 'opponent', type: 'creature', where: { power: { lt: { powerOf: '$self' } } } })]),
    ]),
  ),

  // 5. Q.Q.QX. / 終葬 5.S.D.
  card(
    'dm26sd1-K05',
    creature('Q.Q.QX.', 4, 'N', 4000, ['グランセクト'], [
      staticAb({ type: 'stab5sd' }),
      staticAb({ type: 'deckLock' }),
      trig({ on: { type: 'moved', from: 'battle' }, subject: 'self', lookBack: true }, [act({ shuffle: { who: 'opponent' } })], { label: '離れた時、相手は自身の山札をシャッフルする' }),
    ]),
    spell('終葬 5.S.D.', 8, 'N', [], [
      select('$t', oppCreature(), { prompt: '山札に横向きに刺させる相手のクリーチャーを選んでください' }),
      act({ stab: { sel: '$t', depth: 4 } }),
      act({ put: { sel: '$self' } }),
    ]),
  ),

  // 6. シビレアシダケ / インビンシブル・パワー
  card(
    'dm26sd1-K06',
    creature('シビレアシダケ', 2, 'N', 1000, ['バルーン・マッシュルーム'], [
      cip([maybe([select('$h', { zone: 'hand', owner: 'self' }, { prompt: 'マナゾーンに置く手札を選んでください' }), act({ move: { sel: '$h', to: 'mana', cause: 'effect' } })], '手札を1枚マナゾーンに置きますか?')]),
    ]),
    spell('インビンシブル・パワー', 13, 'N', [], [
      act({ addEffect: { sel: { zone: 'battle', owner: 'self', type: 'creature' }, mods: [{ kind: 'powerAdd', n: 8000 }, { kind: 'breaker', n: 3 }], until: 'endOfTurn' } }),
    ]),
  ),

  // 7. 青銅のバンビシカット / 「我が力、しかと見よ!」
  card(
    'dm26sd1-K07',
    creature('青銅のバンビシカット', 2, 'N', 1000, ['ドリームメイト', 'ハンター'], [cip(onJudgeWin([act({ moveTop: { n: 1, to: 'mana', cause: 'effect' } })]))]),
    spell('「我が力、しかと見よ!」', 9, 'F', [sTrigger()], [select('$t', oppCreature({ power: { lte: 12000 } })), destroy('$t'), ...onJudgeWin([draw(1)])]),
  ),
];

