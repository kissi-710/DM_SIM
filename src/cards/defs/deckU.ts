// デッキU「ツインパクトの極み！光水自然清永デッキ」(docs/decks-25oudou.md)の新規カード。ツインパクト・マナゾーンの文明・ブレイクの大量化など。
import type { Selector, StepDef } from '../../engine/ast';
import type { CardDef } from '../../engine/types';
import {
  act, and, blocker, bounce, card, cip, costGte, creature, draw, ifc, isCreature, justDiver, machFighter, maybe, select, selectUpTo, spell, sTrigger, staticAb, tBreaker,
  trig, wBreaker,
} from '../dsl';

const twin = { twin: true } as const;

/** 変数 v のカードを、コストを支払わずに使う(クリーチャーは召喚、呪文は唱える、それ以外は出す) */
const useFree = (v: string): StepDef[] => [
  ifc({ some: { var: v, where: { type: 'creature' } } }, [act({ summon: { sel: v } })], [
    ifc({ some: { var: v, where: { type: 'spell' } } }, [act({ castFree: { sel: v } })], [act({ put: { sel: v } })]),
  ]),
];

/** 山札の上から表向きにした3枚のうち、残り(実行されなかったもの)をすべてマナゾーンに置く */
const leftoverToMana = act({ move: { sel: { zone: 'deck', owner: 'self', of: '$top' }, to: 'mana', cause: 'effect' } });

export const DECK_U: CardDef[] = [
  // 1. 全虹帝 ミノガミ / ハザード・パクト
  card(
    'dm26sd1-U01',
    creature('全虹帝 ミノガミ', 5, 'N', 5000, ['グランセクト'], [
      machFighter(),
      cip([
        select('$g', { zone: 'grave', owner: 'self', where: twin }, { prompt: 'マナゾーンに置く、墓地のツインパクトカードを選んでください' }),
        act({ move: { sel: '$g', to: 'mana', cause: 'manaPlace' } }),
      ]),
      trig({ on: { type: 'attackDeclared', self: true }, subject: 'any' }, [
        maybe([
          select('$m', { zone: 'mana', owner: 'self', type: 'creature', where: and({ cost: { lt: { count: { zone: 'mana', owner: 'self', where: twin } } } }, { evolution: false }) }, { prompt: '出す、マナゾーンのクリーチャーを選んでください' }),
          act({ put: { sel: '$m' } }),
        ], 'マナゾーンにあるツインパクトカードの枚数よりコストの小さいクリーチャーを、マナゾーンから出しますか?'),
      ], { label: '攻撃する時、自分のマナゾーンにあるツインパクトカードの枚数よりコストの小さいクリーチャーを1体、マナゾーンから出してもよい' }),
    ]),
    spell('ハザード・パクト', 3, 'N', [], [
      act({ moveTop: { n: 1, to: 'mana', cause: 'effect', as: '$m' } }),
      ifc({ some: { var: '$m', where: twin } }, [draw(1)]),
    ]),
  ),

  // 2. キングダム・オウ禍武斗 / 轟破天九十九語
  card(
    'dm26sd1-U02',
    creature('キングダム・オウ禍武斗', 9, 'N', 14000, ['グランセクト'], [
      machFighter(),
      tBreaker(),
      trig({ on: { type: 'battleEnded', winner: 'self' }, subject: 'self' }, [act({ breakOpp: { n: 9 } })], { label: '破天九語: バトルに勝った時、相手のシールドを9つブレイクする' }),
    ]),
    spell('轟破天九十九語', 10, 'N', [], [
      {
        op: 'forPlayers',
        body: [act({ put: { sel: { zone: 'mana', owner: 'iter', type: 'creature', where: { evolution: false } }, noTriggers: true } })],
      },
    ]),
  ),

  // 3. 天雷龍姫エリザベス / インビンシブル・フォートレス
  card(
    'dm26sd1-U03',
    creature('天雷龍姫エリザベス', 5, 'L', 5000, ['アポロニア・ドラゴン', 'メカ・デル・ソル', 'ナイト'], [staticAb({ type: 'spellShieldTrigger' })]),
    spell('インビンシブル・フォートレス', 13, 'F', [], [
      selectUpTo('$s', { zone: 'shield', owner: 'opponent' }, 3, { prompt: '持ち主の墓地に置く相手のシールドを3つまで選んでください(裏向き)' }),
      act({ move: { sel: '$s', to: 'grave', cause: 'trash' } }),
    ]),
  ),

  // 4. 怪盗妖精カサブランカ / 「信じていたのに裏切られるなんて!」
  card(
    'dm26sd1-U04',
    creature('怪盗妖精カサブランカ', 3, 'N', 2000, ['スノーフェアリー'], [
      cip([act({ moveTop: { n: 1, to: 'mana', cause: 'effect' } })]),
      staticAb({ type: 'manaAllCivs' }),
      trig({ on: { type: 'moved', from: 'hand', to: 'mana', owner: 'self' }, subject: 'any' }, [act({ untap: { sel: '$ev.card' } })], { label: 'カードを自分の手札からマナゾーンに置いた時、そのカードをアンタップする' }),
    ]),
    spell('「信じていたのに裏切られるなんて!」', 6, 'W', [sTrigger()], [bounce({ zone: 'battle', owner: 'any', type: 'creature', where: costGte(5) })]),
  ),

  // 5. 五輪の求道者 清永
  card(
    'dm26sd1-U05',
    creature('五輪の求道者 清永', 6, 'LWN', 8500, ['ドリームメイト', 'サムライ', 'ウィザード'], [
      blocker(),
      machFighter(),
      justDiver(),
      wBreaker(),
      trig({ on: { type: 'attackDeclared', self: true }, subject: 'any' }, [
        act({ lookTop: { n: 3, as: '$top' } }),
        act({ reveal: { items: '$top' } }),
        ifc({ distinctCosts: '$top' }, [
          selectUpTo('$e', { zone: 'deck', owner: 'self', of: '$top', type: 'element', where: { cost: { lte: 9 } } } as Selector, 3, { prompt: 'コストを支払わずに実行する、コスト9以下のエレメントを好きな数選んでください' }),
          ...useFree('$e'),
          leftoverToMana,
        ], [
          // 「残りをすべてマナゾーンに置く」は独立した文: 異なるコストでなかった時も、3枚ともマナゾーンに置く(台帳 L26。GameConfig.kiyonagaLeftoverOnFail で切替)
          ifc({ cfg: 'kiyonagaLeftoverOnFail' }, [leftoverToMana]),
        ]),
      ], { label: '攻撃する時、山札の上から3枚を表向きにする。それらがすべて異なるコストなら、その中から、コスト9以下のエレメントを好きな数、コストを支払わずに実行してもよい。残りをすべてマナゾーンに置く' }),
    ]),
  ),

  // 6. アカシック・ゼノン
  card(
    'dm26sd1-U06',
    creature('アカシック・ゼノン', 5, 'WFN', 7000, ['サイバーロード', 'ジ・アンサー'], [
      wBreaker(),
      cip([act({ moveTop: { n: 1, to: 'mana', cause: 'effect' } })], { if: { count: { zone: 'battle', owner: 'self', type: 'creature', where: twin }, gte: 1 }, label: '出た時、自分のツインパクト・クリーチャーがあれば、山札の上から1枚目をマナゾーンに置く' }),
      staticAb({ type: 'grantKeyword', keyword: 'speedAttacker', cond: and(isCreature, twin) }),
      trig({ on: { type: 'attackDeclared', owner: 'self', cond: twin }, subject: 'any', limit: { perTurn: 1 } }, [
        maybe([act({ castSide: { sel: '$ev.card' } })], '攻撃するクリーチャーの呪文側を、バトルゾーンに置いたまま、コストを支払わずに唱えますか?'),
      ], { label: '各ターンに一度、自分のツインパクト・クリーチャーが攻撃する時、そのクリーチャーの呪文側を、バトルゾーンに置いたままコストを支払わずに唱えてもよい' }),
    ]),
  ),
];

