// デッキX「墓地を増やせ！火闇自然墓地ソースデッキ」(docs/decks-25oudou.md)の新規カード。超無限墓地進化・フシギバース・墓地の枚数でコストを減らすなど。
import type { Ability, Cond, Expr } from '../../engine/ast';
import type { CardDef } from '../../engine/types';
import {
  act, and, breaker, card, cip, creature, destroy, draw, evolution, isCreature, machFighter, maybe, onAttack, oppCreature, select, selectUpTo,
  speedAttacker, spell, sTrigger, staticAb, tBreaker, trig, wBreaker, yobinion,
} from '../dsl';

const graveCreatures: Expr = { count: { zone: 'grave', owner: 'self', type: 'creature' } };
/** 自分の墓地にあるクリーチャー1体につきコストを1少なくする(0以下にならない) */
const graveCost = (): Ability => ({ kind: 'selfCost', delta: { mul: [-1, graveCreatures] }, floor: 1 });
/** フシギバース: 自分のクリーチャーを1体タップしてマナゾーンに置き、[base]からそのクリーチャーのコストを引いた数を支払って、このクリーチャーを自分の墓地から召喚してもよい(min 未満にならない) */
const fushigi = (base: number, min: number, label: string): Ability => ({ kind: 'altCost', id: 'fushigi', label, cost: { from: ['grave'], fushigi: { base, min } } });
const never: Cond = { not: { true: true } };

export const DECK_X: CardDef[] = [
  // 1. 超神星DOOM・ドラゲリオン
  card(
    'dm26sd1-X01',
    evolution('超神星DOOM・ドラゲリオン', 12, 'D', 12000, ['フェニックス', 'デーモン・コマンド', 'ドラゴン・ゾンビ'], never, [
      { kind: 'altCost', id: 'graveEvo', label: '超無限墓地進化: クリーチャーを1体以上自分の墓地から選び、このクリーチャーをその上に重ねつつ出す(選んだ数だけコストを少なくする)', cost: { graveEvolve: true } },
      tBreaker(),
      onAttack([
        maybe([
          act({ dropUnder: { sel: '$self', n: 1, to: 'grave' } }),
          select('$t', oppCreature(), { prompt: 'このターン、パワーを-9000する相手のクリーチャーを選んでください' }),
          act({ addEffect: { sel: '$t', mod: { kind: 'powerAdd', n: -9000 }, until: 'endOfTurn' } }),
          selectUpTo('$g', { zone: 'grave', owner: 'self', type: 'creature', where: { evolution: false } }, 1, { prompt: '出す、墓地の進化ではないクリーチャーを選んでください' }),
          act({ put: { sel: '$g' } }),
        ], 'メテオバーン: このクリーチャーの下にあるカードを1枚墓地に置きますか?'),
      ], { label: 'メテオバーン' }),
    ]),
  ),

  // 2. 大魔王 ウラギリダムス
  card(
    'dm26sd1-X02',
    creature('大魔王 ウラギリダムス', 13, 'D', 13000, ['マフィ・ギャング', 'デーモン・コマンド'], [
      graveCost(),
      tBreaker(),
      trig({ on: [{ type: 'entered', self: true }, { type: 'stepStart', step: 'start', player: 'self' }], subject: 'any', if: { count: { zone: 'grave', owner: 'self', type: 'creature' }, gte: 5 } }, [
        maybe([
          select('$u', { zone: 'grave', owner: 'self', type: 'creature' }, { min: 5, max: 5, prompt: 'このクリーチャーの下に重ねるクリーチャーを5体選んでください' }),
          act({ putUnder: { sel: '$u', onto: '$self' } }),
          select('$d', oppCreature(), { prompt: '破壊する相手のクリーチャーを選んでください' }),
          destroy('$d'),
        ], '墓地のクリーチャーを5体、このクリーチャーの下に重ねますか?'),
      ], { label: 'このクリーチャーが出た時または自分のターンのはじめに、クリーチャーを5体自分の墓地から選び、このクリーチャーの下に重ねてもよい。そうしたら、相手のクリーチャーを1体破壊する' }),
      {
        kind: 'replace',
        label: 'このクリーチャーが離れる時、かわりにこのクリーチャーの下に重ねたカードを5枚、山札の下に置いてもよい',
        optional: true,
        match: { type: 'leave', cond: { isSelf: true } },
        while: { cmp: { l: { under: '$self' }, op: '>=', r: 5 } },
        apply: { type: 'steps', steps: [act({ dropUnder: { sel: '$self', n: 5, to: 'deck' } })] },
      },
      {
        kind: 'replace',
        label: '自分がゲームに負ける時、かわりにこのクリーチャーの下に重ねたカードを5枚、山札の下に置いてもよい',
        optional: true,
        match: { type: 'gameLoss', player: 'self' },
        while: { cmp: { l: { under: '$self' }, op: '>=', r: 5 } },
        apply: { type: 'steps', steps: [act({ dropUnder: { sel: '$self', n: 5, to: 'deck' } })] },
      },
    ]),
  ),

  // 3. 龍装鬼 オブザ08号 / 終焉の開闢
  card(
    'dm26sd1-X03',
    creature('龍装鬼 オブザ08号', 9, 'D', 8000, ['ドラゴンギルド', 'マフィ・ギャング'], [
      graveCost(),
      cip([
        select('$t', oppCreature(), { prompt: 'このターン、パワーを下げる相手のクリーチャーを選んでください' }),
        act({ addEffect: { sel: '$t', mod: { kind: 'powerAdd', n: { mul: [-1000, graveCreatures] } }, until: 'endOfTurn' } }),
      ]),
      wBreaker(),
    ]),
    spell('終焉の開闢', 3, 'D', [], [
      act({ moveTop: { n: 3, to: 'grave', cause: 'trash' } }),
      select('$r', { zone: 'grave', owner: 'self', type: 'creature' }, { prompt: '手札に戻す、墓地のクリーチャーを選んでください' }),
      act({ move: { sel: '$r', to: 'hand', cause: 'effect' } }),
    ]),
  ),

  // 4. ドアノッカ=ノアドッカ / 「…開けるか?」
  card(
    'dm26sd1-X04',
    creature('ドアノッカ=ノアドッカ', 7, 'D', 4000, ['アビスロイヤル'], [
      sTrigger(),
      cip([
        { op: 'repeat', times: 2, body: [select('$t', oppCreature(), { prompt: 'このターン、パワーを-4000する相手のクリーチャーを選んでください' }), act({ addEffect: { sel: '$t', mod: { kind: 'powerAdd', n: -4000 }, until: 'endOfTurn' } })] },
      ]),
    ]),
    spell('「…開けるか?」', 2, 'D', [], [select('$t', oppCreature()), act({ addEffect: { sel: '$t', mod: { kind: 'powerAdd', n: -4000 }, until: 'endOfTurn' } })], ['アビスへの誘い']),
  ),

  // 5. 暴走龍 5000GT
  card(
    'dm26sd1-X05',
    creature('暴走龍 5000GT', 12, 'F', 12000, ['アウトレイジ'], [
      graveCost(),
      speedAttacker(),
      tBreaker(),
      cip([destroy({ zone: 'battle', owner: 'any', type: 'creature', where: { power: { lte: 5000 } } })], { label: '出た時、サイキック・クリーチャーをすべて破壊する。その後、パワー5000以下のクリーチャーをすべて破壊する' }),
      staticAb({ type: 'cannotSummonAll', cond: and(isCreature, { power: { lte: 5000 } }) }),
    ]),
  ),

  // 6. ヨビニオン・フレイムバーン
  card(
    'dm26sd1-X06',
    creature('ヨビニオン・フレイムバーン', 4, 'F', 4000, ['アーマード・ドラゴン'], [
      speedAttacker(),
      yobinion(),
      cip([maybe([select('$d', { zone: 'hand', owner: 'self' }, { prompt: '捨てる手札を選んでください' }), act({ move: { sel: '$d', to: 'grave', cause: 'discard' } }), draw(2)], '手札を1枚捨てて、カードを2枚引きますか?')]),
    ]),
  ),

  // 7. 大樹王 ギガンディダノス
  card(
    'dm26sd1-X07',
    creature('大樹王 ギガンディダノス', 12, 'DN', 50000, ['ジャイアント・ドラゴン', '不死樹王国'], [
      breaker(98),
      cip([act({ move: { sel: { zone: 'hand', owner: 'opponent' }, to: 'mana', cause: 'manaPlace' } })], { label: '出た時、相手は自身の手札をすべてマナゾーンに置く' }),
      staticAb({ type: 'protectPlayerFromWeaker' }),
      fushigi(14, 2, 'フシギバース[闇/自然(14)]'),
    ]),
  ),

  // 8. ブラキオ龍樹
  card(
    'dm26sd1-X08',
    creature('ブラキオ龍樹', 11, 'N', 23000, ['ジャイアント・ドラゴン', '不死樹王国'], [
      breaker(4),
      {
        kind: 'replace',
        label: '相手のクリーチャーが出て、相手のクリーチャーの能力がトリガーする時、かわりにその能力はトリガーしない',
        match: { type: 'abilityTriggered', causeType: 'entered', controller: 'opponent' },
        apply: { type: 'cancelTrigger' },
      },
      fushigi(13, 1, 'フシギバース[自然(13)]'),
    ]),
  ),

  // 9. ドマンモ龍樹
  card(
    'dm26sd1-X09',
    creature('ドマンモ龍樹', 7, 'DN', 12000, ['ジャイアント・ドラゴン', '不死樹王国'], [
      tBreaker(),
      staticAb({ type: 'allowPlayFrom', from: 'mana', cond: isCreature, oncePerTurn: true }),
      trig({ on: { type: 'entered', owner: 'self', cond: isCreature }, subject: 'other' }, [
        select('$d', { zone: 'hand', owner: 'opponent' }, { who: 'opponent', prompt: '捨てる自分の手札を選んでください' }),
        act({ move: { sel: '$d', to: 'grave', cause: 'discard' } }),
      ], { label: '自分の他のクリーチャーがバトルゾーンに出た時、相手は自身の手札を1枚選び、捨てる' }),
      fushigi(10, 2, 'フシギバース[闇/自然(10)]'),
    ]),
  ),

  // 10. ネオ・ボルシャック・ドラゴン / ボルシャックゾーン
  card(
    'dm26sd1-X10',
    creature('ネオ・ボルシャック・ドラゴン', 8, 'F', 11000, ['アーマード・ドラゴン'], [staticAb({ type: 'powerAttacker', n: 4000 }), tBreaker()]),
    spell('ボルシャックゾーン', 2, 'N', [], [act({ moveTop: { n: 1, to: 'mana', cause: 'effect' } })]),
  ),

  // 11. 鬼札アバクと鬼札王国
  card(
    'dm26sd1-X11',
    creature('鬼札アバクと鬼札王国', 3, 'DFN', 13000, ['デモニオ'], [
      { kind: 'permission', play: 'summon', from: 'grave' },
      speedAttacker(),
      machFighter(),
      tBreaker(),
      cip([act({ moveTop: { n: 5, to: 'grave', cause: 'trash' } }), destroy('$self')], {
        ifAtResolve: { cmp: { l: { add: [{ count: { zone: 'shield', owner: 'self' } }, { count: { zone: 'shield', owner: 'opponent' } }] }, op: '>', r: 6 } },
        label: '出た時、山札の上から5枚を墓地に置く。その後、このクリーチャーを破壊する(鬼タイム: 自分と相手のシールドの数が合計6つ以下なら、無視する)',
      }),
    ]),
  ),
];

