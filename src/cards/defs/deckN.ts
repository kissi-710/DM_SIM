// デッキN「ジョーの一撃必殺旅路ジョーカーズデッキ」(docs/decks-25oudou.md)の新規カード。
import type { Ability } from '../../engine/ast';
import type { CardDef } from '../../engine/types';
import {
  act, and, blocker, card, cip, civ, costGte, costLte, creature, destroy, draw, gBreaker, gStrike, ifc, machFighter, manaHas, maybe, myCreature,
  onAttack, oppCreature, race, revolutionChange, select, selectUpTo, speedAttacker, spell, sTrigger, staticAb, trig, wBreaker,
} from '../dsl';

const JOKERS = 'ジョーカーズ';
const joker = race(JOKERS);

/** J・O・E 2(コストを2少なくして召喚してもよい。こうして出したら、ターンの終わりに山札の下に置き、カードを1枚引く) */
const joe = (): Ability => ({ kind: 'altCost', id: 'joe', label: 'J・O・E 2', cost: { reduce: 2, endBottomDraw: true } });

export const DECK_N: CardDef[] = [
  // 1. ジョギラゴン&ジョニー 〜Jの旅路〜
  card(
    'dm26sd1-N01',
    creature('ジョギラゴン&ジョニー 〜Jの旅路〜', 8, '', 10000, ['ジョーカーズ・ドラゴン'], [
      revolutionChange('革命チェンジ[コスト5以上のジョーカーズ]', and(costGte(5), joker)),
      wBreaker(),
      cip([
        draw(1),
        select('$d', { zone: 'hand', owner: 'self' }, { prompt: '捨てる手札を選んでください' }),
        act({ move: { sel: '$d', to: 'grave', cause: 'discard' } }),
        ifc({ some: { var: '$d', where: and({ type: 'creature' }, joker) } }, [
          maybe([act({ useCip: { sel: '$d' } })], '捨てたジョーカーズ・クリーチャーの「出た時」で始まる能力を1つ使いますか?'),
        ]),
      ]),
      staticAb({ type: 'oneSpellPerTurn' }),
    ]),
  ),

  // 2. めっちゃ!デンヂャラスG3 / ケッシング・ゼロ
  card(
    'dm26sd1-N02',
    creature('めっちゃ! デンヂャラスG3', 10, '', 21300, ['ジョーカーズ'], [
      gBreaker(),
      cip([
        maybe(
          [
            select('$g', myCreature(), { min: 3, max: 3, prompt: '「G・ブレイカー」を与える自分のクリーチャーを3体選んでください' }),
            act({ addEffect: { sel: '$g', mod: { kind: 'breaker', n: 99 }, until: 'endOfTurn' } }),
          ],
          '「シールドいらねえー!」と言って、自分のクリーチャー3体に「G・ブレイカー」を与えますか?',
        ),
      ]),
    ]),
    spell('ケッシング・ゼロ', 5, '', [sTrigger()], [
      maybe([act({ playerEffect: { mod: { kind: 'ignoreAll' }, until: 'endOfTurn' } })], '「気に入らねぇやつは消す」と言って、このターン、相手のクリーチャーすべての能力を無視しますか?'),
    ]),
  ),

  // 3. ヘルトッQ
  card(
    'dm26sd1-N03',
    creature('ヘルトッQ', 5, '', 5050, ['ジョーカーズ'], [
      staticAb({ type: 'attackPlayerOnEntry' }),
      cip([maybe([draw({ count: { zone: 'battle', owner: 'self', type: 'creature', where: joker } })], '自分のジョーカーズ・クリーチャー1体につき、カードを1枚引きますか?')]),
    ]),
  ),

  // 4. カツラデランス / 「アフロ行きま〜す!!」
  card(
    'dm26sd1-N04',
    creature('カツラデランス', 7, 'F', 7000, ['ジョーカーズ'], [
      wBreaker(),
      cip([
        act({ moveBottom: { n: 1, to: 'grave', cause: 'trash', as: '$b' } }),
        ifc({ some: { var: '$b', where: and({ type: 'creature' }, joker, costLte(6)) } }, [act({ put: { sel: '$b' } })]),
      ]),
    ]),
    spell('「アフロ行きま〜す!!」', 2, 'F', [], [
      select('$d', { zone: 'hand', owner: 'self' }, { prompt: '捨てる手札を選んでください' }),
      act({ move: { sel: '$d', to: 'grave', cause: 'discard' } }),
      draw(2),
    ], ['ジョーカーズ']),
  ),

  // 5. プリプリズン
  card(
    'dm26sd1-N05',
    creature('プリプリズン', 5, 'F', 1000, ['ジョーカーズ'], [
      sTrigger(),
      cip([
        act({ lookTop: { n: 4, as: '$top' } }),
        act({ reveal: { items: '$top' } }),
        selectUpTo('$j', { zone: 'deck', owner: 'self', of: '$top', type: 'creature', where: joker }, 1, { prompt: '手札に加えるジョーカーズ・クリーチャーを選んでください' }),
        act({ move: { sel: '$j', to: 'hand', cause: 'effect' } }),
        act({ bottom: { of: '$top' } }),
      ]),
      cip(
        [
          maybe(
            [
              select('$h', { zone: 'hand', owner: 'self', type: 'creature', where: and(joker, costLte(7)) }, { prompt: '出す、手札のコスト7以下のジョーカーズ・クリーチャーを選んでください' }),
              act({ put: { sel: '$h' } }),
            ],
            '革命0: 手札からコスト7以下のジョーカーズ・クリーチャーを出しますか?',
          ),
        ],
        { if: { shields: { eq: 0 } }, label: '革命0' },
      ),
    ]),
  ),

  // 6. チキン・タッ太
  card(
    'dm26sd1-N06',
    creature('チキン・タッ太', 6, 'F', 5000, ['ジョーカーズ'], [
      joe(),
      speedAttacker(),
      cip([select('$t', oppCreature({ hasKw: 'blocker' }), { prompt: '破壊する、「ブロッカー」を持つ相手のクリーチャーを選んでください' }), destroy('$t')]),
    ]),
  ),

  // 7. モモダチ モンキッド
  card(
    'dm26sd1-N07',
    creature('モモダチ モンキッド', 3, 'N', 1000, ['ジョーカーズ', 'チーム切札'], [
      {
        kind: 'altCost',
        id: 'kirifuda',
        label: 'キリフダッシュ[自然(2)]',
        cost: { pay: 2 },
      },
      trig(
        {
          on: { type: 'attackEnded', owner: 'self', broke: true },
          watch: ['hand'],
          subject: 'any',
          if: { count: { zone: 'mana', owner: 'self', where: and(civ('N'), { tapped: false }) }, gte: 2 },
        },
        [act({ play: { sel: '$self', alt: 'kirifuda' } })],
        { optional: true, label: 'キリフダッシュ[自然(2)]' },
      ),
      cip([act({ moveTop: { n: 1, to: 'mana', cause: 'effect' } })]),
    ]),
  ),

  // 8. タイムピョンチキ / オラオラ・ジョーカーズ
  card(
    'dm26sd1-N08',
    creature('タイムピョンチキ', 4, 'N', 5000, ['ジョーカーズ', 'レクスターズ'], [
      machFighter(),
      trig({ on: { type: 'battleEnded', winner: 'self' }, subject: 'self' }, [
        maybe(
          [
            act({ moveTop: { n: 2, to: 'mana', cause: 'effect' } }),
            select('$m', { zone: 'mana', owner: 'self' }, { prompt: '手札に戻すマナゾーンのカードを選んでください' }),
            act({ move: { sel: '$m', to: 'hand', cause: 'effect' } }),
          ],
          '山札の上から2枚をマナゾーンに置き、カードを1枚マナゾーンから手札に戻しますか?',
        ),
      ]),
    ]),
    spell('オラオラ・ジョーカーズ', 3, 'N', [], [
      act({ moveTop: { n: 1, to: 'mana', cause: 'effect', as: '$m' } }),
      ifc({ some: { var: '$m', where: joker } }, [draw(1)]),
    ], ['ジョーカーズ']),
  ),

  // 9. MMM-ジョーキング
  card(
    'dm26sd1-N09',
    creature('MMM-ジョーキング', 5, 'LN', 6000, ['ジョーカーズ・ドラゴン', 'レクスターズ'], [
      {
        kind: 'trigger',
        label: '相手のクリーチャーが自分を攻撃する時、自分のシールドが1つもなく、マナゾーンに光と自然文明があれば、このクリーチャーを手札から出してもよい',
        optional: true,
        spec: { on: { type: 'attackDeclared', owner: 'opponent', targetKind: 'player' }, watch: ['hand'], subject: 'any', if: and({ shields: { eq: 0 } }, manaHas('LN')) },
        steps: [act({ put: { sel: '$self' } })],
      },
      blocker(),
      machFighter(),
      wBreaker(),
      onAttack([
        draw(1),
        maybe(
          [
            select('$h', { zone: 'hand', owner: 'self', where: and({ any: [{ type: 'creature' }, { type: 'tamaseed' }] }, costLte(4)) }, { prompt: '出す、手札のコスト4以下のクリーチャーまたはタマシードを選んでください' }),
            act({ put: { sel: '$h' } }),
          ],
          '手札からコスト4以下のクリーチャーまたはタマシードを出しますか?',
        ),
      ]),
    ]),
  ),

  // 10. 我ら、モモダチ三人衆!!!
  card(
    'dm26sd1-N10',
    creature('我ら、モモダチ三人衆!!!', 3, 'FN', 3000, ['ジョーカーズ', 'レクスターズ'], [
      gStrike(),
      cip([act({ moveTop: { n: 1, to: 'mana', cause: 'effect' } })]),
      trig({ on: { type: 'stepStart', step: 'start', player: 'self' }, subject: 'any' }, [
        maybe([select('$s', { zone: 'shield', owner: 'self' }, { prompt: '手札に加えるシールドを選んでください' }), act({ move: { sel: '$s', to: 'hand', cause: 'effect' } })], '自分のシールドを1つ手札に加えますか?(「S・トリガー」は使えない)'),
      ]),
    ]),
  ),
];
