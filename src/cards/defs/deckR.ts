// デッキR「勝舞の魂クロスせよ！火光サムライデッキ」(docs/decks-25oudou.md)の新規カード。クロスギア・サムライ・メクレイドなど。
import type { Ability, StepDef } from '../../engine/ast';
import type { CardDef, Face } from '../../engine/types';
import {
  act, and, blocker, card, cip, civ, costGte, creature, destroy, draw, gStrike, ifc, isCreature, maybe, mekureido, myCreature, nameHas, onAttack,
  oppCreature, or, race, revolutionChange, select, spell, sTrigger, staticAb, trig, wBreaker,
} from '../dsl';
import { civsOf } from '../dsl';

const SAMURAI = 'サムライ';
const samurai = race(SAMURAI);
const DRAGON = 'ドラゴン';

/** クロスギア面(abilities はその能力) */
function crossgear(name: string, cost: number, civs: string, races: string[], abilities: Ability[]): Face {
  return { name, type: 'crossgear', cost, civs: civsOf(civs), races, abilities };
}

/** 「使ってもよい」(クロスギアなら、ジェネレートする)ための手順: 変数 v のカードを、コストを支払わずに使う */
const useFree = (v: string): StepDef[] => [
  ifc({ some: { var: v, where: { type: 'creature' } } }, [act({ summon: { sel: v } })], [
    ifc({ some: { var: v, where: { type: 'spell' } } }, [act({ castFree: { sel: v } })], [act({ put: { sel: v } })]),
  ]),
];

export const DECK_R: CardDef[] = [
  // 1. 悪魔世界の閃光
  card(
    'dm26sd1-R01',
    spell('悪魔世界の閃光', 6, 'L', [sTrigger()], [
      // ヨビニオン: 山札の上から、この呪文よりコストが小さいクリーチャーが出るまで表向きにしてもよい。そのクリーチャーを出す。残りをシャッフルして山札の下に置く
      maybe([
        act({ revealUntil: { as: '$found', rest: '$rest', cond: and({ type: 'creature' }, { evolution: false }, { cost: { lt: { costOf: '$self' } } }) } }),
        act({ put: { sel: '$found' } }),
        act({ shuffleBottom: { of: '$rest' } }),
      ], 'ヨビニオン: 山札の上から、この呪文よりコストが小さいクリーチャーが出るまで表向きにして、そのクリーチャーを出しますか?'),
      act({ untap: { sel: { zone: 'battle', owner: 'self', type: 'creature' } } }),
      act({ addEffect: { sel: { zone: 'battle', owner: 'self', type: 'creature' }, mod: { kind: 'grant', keyword: 'blocker' }, until: 'nextTurnStart' } }),
    ]),
  ),

  // 2. 戦術の天才 マロク
  card(
    'dm26sd1-R02',
    creature('戦術の天才 マロク', 2, 'L', 2500, ['スターノイド', 'マシン・イーター', 'アーマード・サムライ'], [
      trig({ on: { type: 'stepStart', step: 'start', player: 'self' }, subject: 'any', if: { hasGear: true } }, [
        ...mekureido(SAMURAI, 5),
        ifc({ some: { var: '$mc', where: { type: 'crossgear' } } }, [
          maybe([select('$ct', myCreature()), act({ cross: { gear: '$mc', to: '$ct' } })], 'こうして出したクロスギアを、自分のクリーチャー1体にコストを支払わずにクロスしますか?'),
        ]),
      ], { label: '自分のターンのはじめに、このクリーチャーにクロスギアがクロスされていれば、サムライ・メクレイド5する' }),
      {
        kind: 'replace',
        label: 'エスケープ: このクリーチャーが破壊される時、墓地に置くかわりに自分のシールドを1つ手札に加えてもよい(「S・トリガー」は使えない)',
        optional: true,
        match: { type: 'moved', from: 'battle', cause: 'destroy' },
        while: { count: { zone: 'shield', owner: 'self' }, gte: 1 },
        apply: { type: 'steps', steps: [select('$s', { zone: 'shield', owner: 'self' }, { prompt: '手札に加えるシールドを選んでください(裏向き)' }), act({ move: { sel: '$s', to: 'hand', cause: 'effect' } })] },
      },
    ]),
  ),

  // 3. 鎧機天 シロフェシー
  card(
    'dm26sd1-R03',
    creature('鎧機天 シロフェシー', 4, 'L', 6500, ['アーマード・メカ・セレス'], [
      revolutionChange('革命チェンジ[コスト3以上のアーマードまたはコスト3以上のメカ]', and(costGte(3), or(race('アーマード'), race('メカ')))),
      blocker(),
      wBreaker(),
      trig({ on: { type: 'entered', via: 'revolutionChange' }, subject: 'self' }, [act({ playerEffect: { mod: { kind: 'cannotCastLte', n: 5 }, until: 'nextTurnStart' } })], {
        label: '「革命チェンジ」によって出た時、次の自分のターンのはじめまで、相手はコスト5以下の呪文を唱えられない',
      }),
      trig({ on: { type: 'stepStart', step: 'end', player: 'self' }, subject: 'any' }, [act({ untap: { sel: '$self' } })], { label: '自分のターンの終わりに、このクリーチャーをアンタップする' }),
    ]),
  ),

  // 4. ボルメテウス・武者・ドラゴン「武偉」
  card(
    'dm26sd1-R04',
    creature('ボルメテウス・武者・ドラゴン「武偉」', 4, 'F', 6000, ['アーマード・ドラゴン', 'アーマード・サムライ'], [
      cip([
        maybe([
          select('$g', { zone: 'hand', owner: 'self', type: 'crossgear' }, { prompt: 'コストを支払わずにジェネレートする、手札のクロスギアを選んでください' }),
          act({ put: { sel: '$g' } }),
        ], '侍流ジェネレート: 手札のクロスギアを1枚、コストを支払わずにジェネレートしますか?'),
      ], { label: '侍流ジェネレート' }),
      wBreaker(),
      trig({ on: [{ type: 'entered', self: true }, { type: 'attackDeclared', self: true }], subject: 'any' }, [
        maybe([
          act({ breakShields: { n: 1 } }),
          select('$t', oppCreature({ power: { lte: 6000 } })),
          destroy('$t'),
        ], '自分のシールドを1つブレイクして、相手のパワー6000以下のクリーチャーを1体破壊しますか?'),
      ], { label: '出た時または攻撃する時、自分のシールドを1つブレイクしてもよい。そうしたら、相手のパワー6000以下のクリーチャーを1体選び、破壊する' }),
    ]),
  ),

  // 5. 竜装 ゴウソク・タキオンアーマー
  card(
    'dm26sd1-R05',
    crossgear('竜装 ゴウソク・タキオンアーマー', 2, 'F', ['アーマード・ドラゴン', 'アーマード・サムライ'], [
      staticAb({ type: 'costDelta', delta: -1, cond: { type: 'crossgear' }, floor: 1 }),
      staticAb({ type: 'costDelta', delta: -1, cond: and(isCreature, samurai), floor: 1 }),
      staticAb({ type: 'hostPowerAdd', n: 1000 }),
    ]),
  ),

  // 6. 竜装 ザンゲキ・マッハアーマー
  card(
    'dm26sd1-R06',
    crossgear('竜装 ザンゲキ・マッハアーマー', 4, 'F', [SAMURAI], [
      staticAb({ type: 'costDelta', delta: -1, cond: and(isCreature, or(race(DRAGON), samurai)), floor: 1 }, { crossed: false }),
      staticAb({ type: 'powerAddOthers', n: 2000, cond: or(race(DRAGON), samurai) }, { hostIs: or(race(DRAGON), samurai) }),
      staticAb({ type: 'grantKeyword', keyword: 'speedAttacker', cond: and(isCreature, or(race(DRAGON), samurai)) }, { hostIs: or(race(DRAGON), samurai) }),
      // このクロスギアをコストを支払わずに名前に《ボルメテウス・武者・ドラゴン》とあるクリーチャーにクロスしてもよい(クロスのコストが 0)
      staticAb({ type: 'freeCrossTo', cond: and(isCreature, nameHas('ボルメテウス・武者・ドラゴン')) }),
    ]),
  ),

  // 7. 爆炎ホワイトグレンオー
  card(
    'dm26sd1-R07',
    creature('爆炎ホワイトグレンオー', 5, 'F', 5000, ['フレイム・モンスター', SAMURAI], [staticAb({ type: 'grantKeyword', keyword: 'speedAttacker', cond: and(isCreature, samurai) })]),
  ),

  // 8. ヴァルキリアス・武者・ムサシ「弐天」
  card(
    'dm26sd1-R08',
    creature('ヴァルキリアス・武者・ムサシ「弐天」', 5, 'LF', 6000, ['アーマード・ドラゴン', 'アーマード・サムライ'], [
      gStrike(),
      wBreaker(),
      cip([
        select('$d', { zone: 'battle', owner: 'opponent', type: 'element', chooseable: true, where: { cost: { lte: { count: { zone: 'battle', owner: 'self', type: 'element', where: civ('F') } } } } }, { prompt: '破壊する、自分の火のエレメントの数以下のコストの相手のエレメントを選んでください' }),
        destroy('$d'),
        maybe([draw({ count: { zone: 'battle', owner: 'self', type: 'element', where: civ('L') } })], '自分の光のエレメント1つにつき、カードを1枚引きますか?'),
      ]),
      onAttack([
        maybe([
          select('$h', { zone: 'hand', owner: 'self', where: and({ evolution: false }, or(samurai, race('アーマード')), { cost: { lte: { count: { zone: 'hand', owner: 'self' } } } }) }, { prompt: 'コストを支払わずに使う、手札のサムライまたはアーマードを選んでください' }),
          ...useFree('$h'),
        ], '手札の枚数以下のコストを持つ進化ではないサムライまたはアーマードを1枚、コストを支払わずに使いますか?'),
      ], { label: '攻撃する時、自分の手札から、手札の枚数以下のコストを持つ進化ではない、サムライまたはアーマードを1枚、コストを支払わずに使ってもよい' }),
    ]),
  ),

  // 9. 竜牙 リュウジン・ドスファング
  card(
    'dm26sd1-R09',
    crossgear('竜牙 リュウジン・ドスファング', 5, 'LF', ['アーマード・ドラゴン', 'アーマード・サムライ'], [
      trig({ on: [{ type: 'entered', self: true }, { type: 'attackDeclared', hostAttacker: true }], subject: 'any' }, mekureido(SAMURAI, 5), { label: 'このクロスギアが出た時、またはこれをクロスしたクリーチャーが攻撃する時、サムライ・メクレイド5する' }),
      // このクロスギアをコストを支払わずにサムライ・クリーチャーにクロスしてもよい(クロスのコストが 0)
      staticAb({ type: 'freeCrossTo', cond: and(isCreature, samurai) }),
    ]),
  ),
];

