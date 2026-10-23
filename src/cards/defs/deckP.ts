// デッキP「コンボで連鎖！自然単グランセクトデッキ」(docs/decks-25oudou.md)の新規カード。
import type { CardDef } from '../../engine/types';
import {
  act, and, breaker, card, cip, civ, costLte, creature, draw, guardman, ifc, isCreature, machFighter, maybe, onAttack, oppCreature, select, selectUpTo, spell, sTrigger, staticAb,
  tBreaker, trig,
} from '../dsl';

const BIG = { power: { gte: 12000 } } as const;
/** 自分のパワー12000以上のクリーチャーの数 */
const bigCount = { count: { zone: 'battle', owner: 'self', type: 'creature', where: BIG } } as const;

export const DECK_P: CardDef[] = [
  // 1. 水上第九院 シャコガイル
  card(
    'dm26sd1-P01',
    creature('水上第九院 シャコガイル', 9, 'W', 13000, ['ムートピア'], [
      tBreaker(),
      cip([act({ shuffleIn: { sel: { zone: 'grave', owner: 'self' } } })]),
      trig({ on: { type: 'stepStart', step: 'start', player: 'opponent' }, subject: 'any' }, [
        draw(5),
        select('$d', { zone: 'hand', owner: 'self' }, { min: { min: [3, { count: { zone: 'hand', owner: 'self' } }] }, max: 3, prompt: '捨てる手札を3枚選んでください' }),
        act({ move: { sel: '$d', to: 'grave', cause: 'discard' } }),
      ], { label: '相手のターンのはじめに、カードを5枚引き、自分の手札を3枚捨てる' }),
      {
        kind: 'replace',
        label: '自分の山札の最後の1枚を引いたことによって自分がゲームに負ける時、かわりに勝つ',
        match: { type: 'gameLoss', player: 'self', reason: 'deckOutDraw' },
        apply: { type: 'steps', steps: [act({ win: {} })] },
      },
    ]),
  ),

  // 2. 天風のゲイル・ヴェスパー
  card(
    'dm26sd1-P02',
    creature('天風のゲイル・ヴェスパー', 10, 'N', 12000, ['グランセクト'], [
      { kind: 'selfCost', delta: { mul: [-2, bigCount] }, floor: 1 },
      tBreaker(),
      staticAb({ type: 'costDelta', delta: { mul: [-2, bigCount] }, cond: and(isCreature, { zoneIs: 'hand' }), floor: 1 }),
    ]),
  ),

  // 3. ジーク・ナハトファルター
  card(
    'dm26sd1-P03',
    creature('ジーク・ナハトファルター', 11, 'N', 18000, ['グランセクト'], [
      trig({ on: { type: 'stepStart', step: 'start', player: 'self' }, watch: ['mana'], subject: 'any' }, [maybe([act({ move: { sel: '$self', to: 'hand', cause: 'bounce' } })], 'このクリーチャーを手札に戻しますか?')], {
        label: '自分のターンのはじめに、このクリーチャーを自分のマナゾーンから手札に戻してもよい',
      }),
      breaker(4),
      trig({ on: { type: 'entered', owner: 'self', cond: and(isCreature, BIG) }, subject: 'any' }, [
        act({ moveTop: { n: 2, to: 'mana', cause: 'effect' } }),
        select('$m', { zone: 'mana', owner: 'self', type: 'creature' }, { prompt: '手札に戻す、マナゾーンのクリーチャーを選んでください' }),
        act({ move: { sel: '$m', to: 'hand', cause: 'effect' } }),
      ], { label: '自分のパワー12000以上のクリーチャーが出た時、山札の上から2枚をマナゾーンに置き、クリーチャーを1体マナゾーンから手札に戻す' }),
    ]),
  ),

  // 4. デデカブラ
  card('dm26sd1-P04', creature('デデカブラ', 1, 'N', 12000, ['グランセクト'], [staticAb({ type: 'cannotAttack' })])),

  // 5. ヴァム・ウィングダム / ソニック・ダンス
  card(
    'dm26sd1-P05',
    creature('ヴァム・ウィングダム', 2, 'N', 12000, ['グランセクト'], [
      staticAb({ type: 'cannotAttack' }, { not: { logged: { pattern: { type: 'attackDeclared', owner: 'self', cond: BIG } } } }),
      onAttack([maybe([act({ castSide: { sel: '$self' } })], 'スマッシュ・バースト: 呪文側をバトルゾーンに置いたまま、コストを支払わずに唱えますか?')], { label: 'スマッシュ・バースト' }),
      tBreaker(),
    ]),
    spell('ソニック・ダンス', 3, 'N', [], [select('$t', oppCreature({ power: { lte: 7000 } })), act({ move: { sel: '$t', to: 'mana', cause: 'manaPlace' } })]),
  ),

  // 6. 界王類咆哮目 ジュラノキル / ジュラスティック・ハウル
  card(
    'dm26sd1-P06',
    creature('界王類咆哮目 ジュラノキル', 1, 'N', 12000, ['ジュラシック・コマンド・ドラゴン'], [staticAb({ type: 'cannotAttack' })]),
    spell('ジュラスティック・ハウル', 3, 'N', [], [
      act({ move: { sel: { zone: 'battle', owner: 'opponent', type: 'creature', where: { cost: { gt: { count: { zone: 'mana', owner: 'opponent' } } } } }, to: 'mana', cause: 'manaPlace' } }),
    ]),
  ),

  // 7. デスマッチ・ビートル
  card(
    'dm26sd1-P07',
    creature('デスマッチ・ビートル', 2, 'N', 13000, ['ジャイアント・インセクト'], [
      guardman(),
      staticAb({ type: 'cannotAttack' }),
      trig({ on: { type: 'entered', owner: 'opponent', paid: 0 }, turn: 'opponent', subject: 'any' }, [
        maybe([act({ battle: { a: '$self', b: '$ev.card' } })], '相手のクリーチャーと、このクリーチャーをバトルさせますか?'),
      ], { label: '相手のターン中に、相手のクリーチャーがコストを支払わずに出た時、このクリーチャーとそのクリーチャーをバトルさせてもよい' }),
    ]),
  ),

  // 8. ジャンボ・ラパダイス
  card(
    'dm26sd1-P08',
    spell('ジャンボ・ラパダイス', 2, 'N', [sTrigger()], [
      act({ lookTop: { n: 4, as: '$t' } }),
      act({ reveal: { items: '$t' } }),
      act({ move: { sel: { zone: 'deck', owner: 'self', of: '$t', type: 'creature', where: BIG }, to: 'hand', cause: 'effect' } }),
      act({ bottom: { of: '$t' } }),
    ]),
  ),

  // 9. ナ・チュラルゴ・デンジャー / ナチュラル・トラップ
  card(
    'dm26sd1-P09',
    creature('ナ・チュラルゴ・デンジャー', 7, 'N', 12000, ['グランセクト', 'ジャイアント'], [
      machFighter(),
      tBreaker(),
      trig({ on: [{ type: 'entered', self: true }, { type: 'cast', owner: 'self', cond: { nameHas: 'トラップ' } }], subject: 'any' }, [
        maybe(
          [
            select('$h', { zone: ['hand', 'mana'], owner: 'self', type: 'creature', where: and(civ('N'), costLte(6)) }, { prompt: '出す、手札またはマナゾーンの自然のコスト6以下のクリーチャーを選んでください' }),
            act({ put: { sel: '$h' } }),
          ],
          '自然のコスト6以下のクリーチャーを手札またはマナゾーンから出しますか?',
        ),
      ], { label: 'このクリーチャーが出た時または自分が名前に《トラップ》とある呪文を唱えた時、自然のコスト6以下のクリーチャーを1体、自分の手札またはマナゾーンから出してもよい' }),
    ]),
    spell('ナチュラル・トラップ', 6, 'N', [sTrigger()], [select('$t', oppCreature()), act({ move: { sel: '$t', to: 'mana', cause: 'manaPlace' } })]),
  ),

  // 10. コレンココ・タンク / ボント・プラントボ
  card(
    'dm26sd1-P10',
    creature('コレンココ・タンク', 6, 'N', 12000, ['グランセクト'], [
      guardman(),
      staticAb({ type: 'cannotAttackPlayer' }),
      cip([
        act({ lookTop: { n: 3, as: '$top' } }),
        act({ reveal: { items: '$top' } }),
        selectUpTo('$b', { zone: 'deck', owner: 'self', of: '$top', type: 'creature', where: BIG }, 3, { prompt: '手札に加えるパワー12000以上のクリーチャーを好きな数選んでください' }),
        act({ move: { sel: '$b', to: 'hand', cause: 'effect' } }),
        act({ move: { sel: { zone: 'deck', owner: 'self', of: '$top' }, to: 'mana', cause: 'effect', tapped: true } }),
      ]),
    ]),
    spell('ボント・プラントボ', 3, 'N', [], [
      act({ moveTop: { n: 1, to: 'mana', cause: 'effect', as: '$m' } }),
      ifc({ some: { var: '$m', where: and({ type: 'creature' }, BIG) } }, [act({ moveTop: { n: 1, to: 'mana', cause: 'effect' } })]),
    ]),
  ),

  // 11. 環嵐! ホールインワン・ヘラクレス(タマシード/クリーチャー。自分の自然のクリーチャーまたは自然のタマシードが合計4つ未満の間は、クリーチャーとして扱わず、タマシードとして扱う)
  card('dm26sd1-P11', {
    ...creature('環嵐! ホールインワン・ヘラクレス', 4, 'N', 12000, ['ジャイアント・インセクト', 'ACE'], [
      tBreaker(),
      cip([
        {
          op: 'modes',
          pick: 1,
          options: [
            { label: '自分の墓地をシャッフルして山札の下に置く', steps: [act({ graveToBottom: { who: 'self' } })] },
            { label: '相手の墓地をシャッフルして山札の下に置く', steps: [act({ graveToBottom: { who: 'opponent' } })] },
          ],
        },
      ]),
      staticAb({ type: 'allowPlayFrom', from: 'mana', cond: isCreature, oncePerTurn: true }),
      onAttack([
        select('$t', oppCreature()),
        act({ move: { sel: '$t', to: 'mana', cause: 'manaPlace' } }),
        act({ moveTop: { n: 2, to: 'mana', cause: 'effect' } }),
      ], { label: '攻撃する時、相手のクリーチャーを1体選んで持ち主のマナゾーンに置く。その後、山札の上から2枚までマナゾーンに置く' }),
    ]),
    // 自分の自然のクリーチャーまたは自然のタマシードが合計4つ以上なければ、バトルゾーンにあるこのタマシードはクリーチャーとして扱わない
    tamaseedUnless: { cmp: { l: { add: [{ count: { zone: 'battle', owner: 'self', type: 'creature', where: civ('N') } }, { count: { zone: 'battle', owner: 'self', type: 'tamaseed', where: civ('N') } }] }, op: '>=', r: 4 } },
  }),
];
