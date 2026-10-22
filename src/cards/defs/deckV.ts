// デッキV「手札を無くせ!火自然ギャラクシーデッキ」(docs/decks-25oudou.md)の新規カード。G・G・G・G・ゼロ・飛行・クリーチャーをマナとして使うなど。
import type { Cond } from '../../engine/ast';
import type { CardDef } from '../../engine/types';
import {
  act, and, breaker, card, cip, creature, destroy, draw, hyperMode, hyperize, ifc, isCreature, manaHas, nameHas, onAttack, oppCreature, race, select, selectUpTo,
  speedAttacker, spell, sTrigger, staticAb, trig, wBreaker,
} from '../dsl';

const FAIRY = 'スノーフェアリー';
/** 自分の手札が(このカードを除いて)n 枚以下 */
const handOthersLte = (n: number): Cond => ({ count: { zone: 'hand', owner: 'self', notSelf: true }, lte: n });
const power6000 = oppCreature({ power: { lte: 6000 } });

export const DECK_V: CardDef[] = [
  // 1. “逆悪襲”ブランド
  card(
    'dm26sd1-V01',
    creature('“逆悪襲”ブランド', 7, 'F', 9000, ['ビートジョッキー'], [
      { kind: 'selfCost', delta: -6, cond: handOthersLte(1), floor: 1 },
      speedAttacker(),
      wBreaker(),
      cip([select('$t', power6000, { prompt: '破壊する、相手のパワー6000以下のクリーチャーを選んでください' }), destroy('$t')]),
    ]),
  ),

  // 2. “轟轟轟”ブランド(殿堂入り)
  card(
    'dm26sd1-V02',
    creature('“轟轟轟”ブランド', 7, 'F', 9000, ['ビートジョッキー'], [
      { kind: 'altCost', id: 'ggg', label: 'マスターG・G・G: 自分の手札がこのカードだけなら、コストを支払わずに召喚してもよい', when: handOthersLte(0), cost: {} },
      speedAttacker(),
      wBreaker(),
      cip([
        ifc(manaHas('F'), [
          draw(1),
          selectUpTo('$d', { zone: 'hand', owner: 'self' }, { count: { zone: 'hand', owner: 'self' } }, { prompt: '捨てる手札を好きな枚数選んでください(捨てなくてもよい)' }),
          act({ move: { sel: '$d', to: 'grave', cause: 'discard' } }),
          selectUpTo('$o', power6000, { len: '$d' }, { prompt: '破壊する、相手のパワー6000以下のクリーチャーを選んでください(捨てた手札1枚につき1体)' }),
          destroy('$o'),
        ]),
      ]),
    ]),
  ),

  // 3. グレイト“S-駆”
  card(
    'dm26sd1-V03',
    creature('グレイト“S-駆”', 1, 'F', 1000, ['ビートジョッキー'], [
      staticAb({ type: 'grantKeyword', keyword: 'speedAttacker', cond: { isSelf: true } }, { count: { zone: 'hand', owner: 'self' }, lte: 1 }),
      trig({ on: { type: 'stepStart', step: 'end', player: 'self' }, subject: 'any', if: { selfTapped: false } }, [act({ move: { sel: '$self', to: 'hand', cause: 'bounce' } })], {
        label: '自分のターンの終わりに、このクリーチャーがアンタップしていたら、手札に戻す',
      }),
    ]),
  ),

  // 4. 弾丸超邪 クロスファイア
  card(
    'dm26sd1-V04',
    creature('弾丸超邪 クロスファイア', 7, 'F', 7000, ['マジック・アウトレイジMAX'], [
      {
        kind: 'altCost',
        id: 'gzero',
        label: 'G・ゼロ: 自分のクリーチャーが4体以上あり、自分の《弾丸超邪 クロスファイア》がなければ、コストを支払わずに召喚してもよい',
        when: and({ count: { zone: 'battle', owner: 'self', type: 'creature' }, gte: 4 }, { count: { zone: 'battle', owner: 'self', type: 'creature', where: nameHas('弾丸超邪 クロスファイア') }, eq: 0 }),
        cost: {},
      },
      speedAttacker(),
      wBreaker(),
      onAttack([
        ifc(manaHas('F'), [
          selectUpTo('$o', { zone: 'battle', owner: 'self', type: 'creature', notSelf: true }, 1, { prompt: 'このターン、「スピードアタッカー」を与える自分の他のクリーチャーを選んでください' }),
          act({ addEffect: { sel: '$o', mod: { kind: 'grant', keyword: 'speedAttacker' }, until: 'endOfTurn' } }),
        ]),
      ], { label: '攻撃する時、自分のマナゾーンに火文明があれば、このターン、自分の他のクリーチャー1体に「スピードアタッカー」を与える' }),
    ]),
  ),

  // 5. ブレイズ・ハイパー・クロー
  card(
    'dm26sd1-V05',
    creature('ブレイズ・ハイパー・クロー', 1, 'F', 1000, ['アーマード・ドラゴノイド', '超化獣'], [
      staticAb({ type: 'cannotAttack' }, { count: { zone: 'battle', owner: 'self', type: 'creature', where: { tapped: true } }, lte: 1 }),
      hyperize(1),
      staticAb({ type: 'powerAdd', n: 5000 }, hyperMode),
      breaker(2, hyperMode),
      onAttack([
        select('$d', { zone: 'hand', owner: 'self' }, { prompt: '捨てる手札を選んでください' }),
        act({ move: { sel: '$d', to: 'grave', cause: 'discard' } }),
        draw(1),
      ], { if: hyperMode, label: 'ハイパーモード: 攻撃する時、自分の手札を1枚捨て、カードを1枚引く' }),
    ]),
  ),

  // 6. 完璧妖精サエポヨX
  card(
    'dm26sd1-V06',
    creature('完璧妖精サエポヨX', 2, 'N', 2000, [FAIRY, '超化獣'], [
      staticAb({ type: 'costDelta', delta: -1, cond: race(FAIRY), oncePerTurn: true, floor: 1 }),
      hyperize(1),
      staticAb({ type: 'powerAdd', n: 3000 }, hyperMode),
      staticAb({ type: 'allowPlayFrom', from: 'mana', cond: isCreature, oncePerTurn: true }, hyperMode),
    ]),
  ),

  // 7. ベイB セガーレ
  card(
    'dm26sd1-V07',
    creature('ベイB セガーレ', 1, 'N', 6000, ['ミルクボーイ'], [
      staticAb({ type: 'cannotAttack' }),
      {
        kind: 'replace',
        label: '相手が自身のマナゾーンのカードの枚数よりコストが大きいクリーチャーを出す時、相手はそれをかわりにマナゾーンに置き、その後、自分はこのクリーチャーをマナゾーンに置く',
        match: { type: 'enter', owner: 'opponent', cond: and(isCreature, { cost: { gt: { count: { zone: 'mana', owner: 'opponent' } } } }) },
        apply: { type: 'changeDest', to: 'mana', then: [act({ move: { sel: '$self', to: 'mana', cause: 'manaPlace' } })] },
      },
    ]),
  ),

  // 8. 極楽鳥
  card('dm26sd1-V08', creature('極楽鳥', 2, 'N', 1000, ['マナ・バード'], [staticAb({ type: 'flying' }), staticAb({ type: 'cannotBreak' }), staticAb({ type: 'tapAsMana' })])),

  // 9. 清浄のカルマ インカ / オキヨメ・水晶チャージャー
  card(
    'dm26sd1-V09',
    creature('清浄のカルマ インカ', 2, 'N', 2000, ['オラクル・セレス', FAIRY], [
      {
        kind: 'replace',
        label: '相手のクリーチャーは、相手の手札以外から出ない',
        match: { type: 'enter', owner: 'opponent', notFrom: 'hand' },
        apply: { type: 'stay' },
      },
    ]),
    (() => {
      const f = spell('オキヨメ・水晶チャージャー', 3, 'N', [], [
        {
          op: 'modes',
          pick: 1,
          options: [
            { label: '自分の墓地を山札に加えてシャッフルする', steps: [act({ shuffleIn: { sel: { zone: 'grave', owner: 'self' } } })] },
            { label: '相手の墓地を山札に加えてシャッフルする', steps: [act({ shuffleIn: { sel: { zone: 'grave', owner: 'opponent' } } })] },
          ],
        },
      ]);
      return { ...f, abilities: [{ kind: 'replace' as const, label: '水晶チャージャー', match: { type: 'moved', cause: 'cast' }, apply: { type: 'changeDest' as const, to: 'mana' as const } }, ...f.abilities] };
    })(),
  ),

  // 10. 冒険妖精ポレキチ
  card(
    'dm26sd1-V10',
    creature('冒険妖精ポレキチ', 2, 'N', 3000, [FAIRY], [
      cip([
        select('$m', { zone: 'mana', owner: 'self', type: 'creature' }, { prompt: 'このターン、マナゾーンから召喚してもよい、自分のクリーチャーを選んでください' }),
        act({ allowSummon: { sel: '$m' } }),
      ]),
    ]),
  ),

  // 11. 応援妖精エール / 「みんな一緒に応援してね!」
  card(
    'dm26sd1-V11',
    creature('応援妖精エール', 2, 'N', 2000, [FAIRY], [
      cip([selectUpTo('$u', { zone: 'mana', owner: 'self' }, 2, { prompt: 'アンタップする自分のマナゾーンのカードを2枚まで選んでください' }), act({ untap: { sel: '$u' } })]),
    ]),
    spell('「みんな一緒に応援してね!」', 4, 'F', [sTrigger()], [
      select('$d', { zone: 'hand', owner: 'self' }, { prompt: '捨てる手札を選んでください' }),
      act({ move: { sel: '$d', to: 'grave', cause: 'discard' } }),
      selectUpTo('$a', power6000, 1, { prompt: '破壊する、相手のパワー6000以下のクリーチャーを選んでください' }),
      destroy('$a'),
      ifc({ some: { var: '$d', where: race(FAIRY) } }, [selectUpTo('$b', power6000, 1, { prompt: 'もう1体、破壊する相手のパワー6000以下のクリーチャーを選んでください' }), destroy('$b')]),
    ]),
  ),
];

