// デッキQ「地上戦は最強！水自然ジャイアントデッキ」(docs/decks-25oudou.md)の新規カード。
import type { CardDef } from '../../engine/types';
import {
  act, and, blocker, bounce, card, cip, costGte, costLte, creature, draw, evolution, gStrike, hyperEnergy, ifc, isCreature, justDiver, machFighter, maybe,
  mekureido, not, onAttack, oppCreature, race, revolutionChange, select, selectUpTo, spell, sTrigger, staticAb, tBreaker, trig, wBreaker,
} from '../dsl';

const GIANT = 'ジャイアント';
const giant = race(GIANT);
/** 自分の他のジャイアントがいる */
const myGiants = { zone: 'battle', owner: 'self', type: 'creature', where: giant } as const;

const NOT_ATTACK_OR_BLOCK = [{ kind: 'cannotAttack' }, { kind: 'cannotBlock' }] as const;

export const DECK_Q: CardDef[] = [
  // 1. アシステスト・シネラリア
  card(
    'dm26sd1-Q01',
    creature('アシステスト・シネラリア', 3, 'W', 2000, ['ジャイアント・スノーフェアリー'], [
      cip([draw(1)], { if: { count: { zone: 'battle', owner: 'self', type: 'creature', notSelf: true, where: giant }, gte: 1 }, label: '出た時、自分の他のジャイアントがあれば、カードを1枚引く' }),
      staticAb({ type: 'costDelta', delta: -1, cond: giant, floor: 1 }),
      {
        kind: 'replace',
        label: 'ウルトラ・セイバー: 自分のジャイアントが離れる時、かわりにこのクリーチャーを破壊してもよい',
        optional: true,
        match: { type: 'leave', owner: 'self', cond: and(isCreature, giant, not({ isSelf: true })) },
        // 置換で破壊するクリーチャーには、さらに置換を重ねない(ウルトラ・セイバーどうしの循環を避ける)
        apply: { type: 'steps', steps: [act({ move: { sel: '$self', to: 'grave', cause: 'destroy', noReplace: true } })] },
      },
    ]),
  ),

  // 2. ナイター・ファイアフライ
  card(
    'dm26sd1-Q02',
    creature('ナイター・ファイアフライ', 6, 'W', 4000, ['ジャイアント・インセクト'], [
      sTrigger(),
      cip([
        select('$b', oppCreature(), { prompt: '持ち主の手札に戻す相手のクリーチャーを選んでください' }),
        bounce('$b'),
        select('$e', oppCreature(), { prompt: '次の自分のターンのはじめまで、攻撃もブロックもできなくする相手のクリーチャーを選んでください' }),
        act({ addEffect: { sel: '$e', mods: NOT_ATTACK_OR_BLOCK, until: 'nextTurnStart' } }),
      ]),
    ]),
  ),

  // 3. 五番龍 レイクポーチャー ParZero
  card(
    'dm26sd1-Q03',
    creature('五番龍 レイクポーチャー ParZero', 5, 'W', 8000, ['ジャイアント・ドラゴン'], [
      blocker(),
      justDiver(),
      wBreaker(),
      cip([
        act({ lookTop: { n: 6, as: '$t' } }),
        select('$p', { zone: 'deck', owner: 'self', of: '$t' }, { min: 2, max: 2, prompt: '手札に加えるカードを2枚選んでください' }),
        act({ move: { sel: '$p', to: 'hand', cause: 'effect' } }),
        act({ bottom: { of: '$t' } }),
        selectUpTo('$h', { zone: 'hand', owner: 'self' }, 1, { prompt: '表向きにする手札を選んでください(表向きにしなくてもよい)' }),
        act({ reveal: { items: '$h' } }),
        ifc({ nonEmpty: '$h' }, [
          selectUpTo('$o', oppCreature({ cost: { eq: { costOf: '$h' } } }), 1, { prompt: '持ち主の手札に戻す、同じコストの相手のクリーチャーを選んでください' }),
          bounce('$o'),
        ]),
      ]),
    ]),
  ),

  // 4. キャディ・ビートル
  card(
    'dm26sd1-Q04',
    creature('キャディ・ビートル', 2, 'N', 1000, ['ジャイアント・インセクト'], [
      {
        kind: 'replace',
        label: '相手のターン中、相手が自身のマナゾーンのカードの枚数よりコストが大きいクリーチャーを出す時、かわりにマナゾーンに置く',
        match: { type: 'enter', owner: 'opponent', turn: 'opponent', cond: and(isCreature, { cost: { gt: { count: { zone: 'mana', owner: 'opponent' } } } }) },
        apply: { type: 'changeDest', to: 'mana' },
      },
      {
        kind: 'replace',
        label: 'このクリーチャーが破壊される時、墓地に置くかわりにマナゾーンに置く',
        match: { type: 'moved', from: 'battle', cause: 'destroy' },
        apply: { type: 'changeDest', to: 'mana' },
      },
    ]),
  ),

  // 5. とこしえの超人
  card(
    'dm26sd1-Q05',
    creature('とこしえの超人', 1, 'N', 4000, ['ジャイアント'], [
      gStrike(),
      staticAb({ type: 'cannotAttackPlayer' }),
      {
        kind: 'replace',
        label: '相手が自身の手札以外からカードを出す時、かわりにマナゾーンに置く',
        match: { type: 'enter', owner: 'opponent', notFrom: 'hand' },
        apply: { type: 'changeDest', to: 'mana' },
      },
    ]),
  ),

  // 6. 爆翠月 アカネ
  card(
    'dm26sd1-Q06',
    creature('爆翠月 アカネ', 5, 'N', 5000, ['ジャイアント・スノーフェアリー'], [
      hyperEnergy(),
      machFighter(),
      trig({ on: { type: 'battleEnded', winner: 'self' }, subject: 'self' }, [
        maybe([act({ moveTop: { n: 1, to: 'mana', cause: 'effect' } })], '山札の上から1枚目をマナゾーンに置きますか?'),
        maybe([select('$m', { zone: 'mana', owner: 'self' }, { prompt: '手札に戻すマナゾーンのカードを選んでください' }), act({ move: { sel: '$m', to: 'hand', cause: 'effect' } })], 'カードを1枚、マナゾーンから手札に戻しますか?'),
      ], { label: 'バトルに勝った時、山札の上から1枚目をマナゾーンに置いてもよい。その後、カードを1枚マナゾーンから手札に戻してもよい' }),
    ]),
  ),

  // 7. チアスカーレット アカネ
  card(
    'dm26sd1-Q07',
    creature('チアスカーレット アカネ', 5, 'N', 7000, ['ジャイアント・スノーフェアリー'], [
      machFighter(),
      wBreaker(),
      staticAb({ type: 'allowPlayFrom', from: 'mana', cond: and(isCreature, giant), oncePerTurn: true }),
      trig({ on: { type: 'entered', owner: 'self', via: 'summon', from: 'mana' }, turn: 'own', subject: 'any' }, [act({ moveTop: { n: 1, to: 'mana', cause: 'effect' } })], {
        label: '自分のターン中、ジャイアント・クリーチャーをマナゾーンから召喚したら、山札の上から1枚をマナゾーンに置く',
      }),
      onAttack([
        maybe(
          [
            select('$g', { zone: 'battle', owner: 'self', type: 'creature', notSelf: true, where: giant }, { prompt: 'マナゾーンに置く、自分の他のジャイアントを選んでください' }),
            act({ move: { sel: '$g', to: 'mana', cause: 'manaPlace' } }),
            ...mekureido(GIANT, 8),
          ],
          '自分の他のジャイアントを1つマナゾーンに置いて、ジャイアント・メクレイド8しますか?',
        ),
      ], { label: '攻撃する時、自分の他のジャイアントを1つ、マナゾーンに置いてもよい。そうしたら、ジャイアント・メクレイド8する' }),
    ]),
  ),

  // 8. 完璧妖精マリニャンX
  card(
    'dm26sd1-Q08',
    creature('完璧妖精マリニャンX', 5, 'N', 8000, ['ジャイアント・スノーフェアリー'], [
      { kind: 'permission', play: 'summon', from: 'mana' },
      machFighter(),
      wBreaker(),
      {
        kind: 'replace',
        label: '相手のクリーチャーが出て、その能力がトリガーする時、自分のスノーフェアリーが5つ以上あれば、かわりにその能力はトリガーしない',
        match: { type: 'abilityTriggered', causeType: 'entered', controller: 'opponent' },
        while: { count: { zone: 'battle', owner: 'self', type: 'creature', where: race('スノーフェアリー') }, gte: 5 },
        apply: { type: 'cancelTrigger' },
      },
    ]),
  ),

  // 9. 超球の超人 / 父なるタッチダウン
  card(
    'dm26sd1-Q09',
    creature('超球の超人', 8, 'N', 12000, ['ジャイアント'], [
      machFighter(),
      tBreaker(),
      trig({ on: { type: 'battleEnded', winner: 'self' }, subject: 'self' }, [
        maybe([select('$s', { zone: 'shield', owner: 'opponent' }, { prompt: '持ち主のマナゾーンに置く、相手のシールドを選んでください(裏向き)' }), act({ move: { sel: '$s', to: 'mana', cause: 'manaPlace' } })], '相手のシールドを1つ、持ち主のマナゾーンに置きますか?'),
      ], { label: 'バトルに勝った時、相手のシールドを1つ選び、持ち主のマナゾーンに置いてもよい' }),
      staticAb({ type: 'cannotPlay', cond: and(not({ type: 'creature' }), costLte(5)) }),
    ]),
    spell('父なるタッチダウン', 5, 'N', [], [
      select('$t', oppCreature()),
      act({ move: { sel: '$t', to: 'mana', cause: 'manaPlace' } }),
      maybe([
        select('$g', { zone: 'mana', owner: 'self', type: 'creature', where: and({ cost: { lt: { costOf: '$t' } } }, { evolution: false }) }, { prompt: '出す、マナゾーンのクリーチャーを選んでください' }),
        act({ put: { sel: '$g' } }),
      ], 'そのクリーチャーよりコストが小さいクリーチャーを1体、マナゾーンから出しますか?'),
    ], ['ジャイアント・スキル']),
  ),

  // 10. 超重竜 ゴルファンタジスタ
  card(
    'dm26sd1-Q10',
    creature('超重竜 ゴルファンタジスタ', 7, 'WN', 12000, ['ジャイアント・ドラゴン'], [
      revolutionChange('革命チェンジ[コスト5以上のジャイアント]', and(costGte(5), giant)),
      tBreaker(),
      staticAb({ type: 'grantKeyword', keyword: 'unblockable', cond: and(isCreature, giant) }),
      cip([
        maybe(
          [
            select('$g', { zone: 'mana', owner: 'self', type: 'creature', where: and(giant, costLte(6), { evolution: false }) }, { prompt: '出す、マナゾーンのコスト6以下のジャイアント・クリーチャーを選んでください' }),
            act({ put: { sel: '$g' } }),
          ],
          'コスト6以下のジャイアント・クリーチャーを1体、マナゾーンから出しますか?',
        ),
      ]),
      trig(
        { on: { type: 'stepStart', step: 'start', player: 'self' }, subject: 'any', if: { unused: 'shuukyoku-q10' } },
        [
          act({ markUsed: { key: 'shuukyoku-q10' } }),
          maybe([draw({ count: { zone: 'hand', owner: 'self' } })], '自分の手札と同じ枚数のカードを引きますか?'),
          maybe([act({ moveTop: { n: { count: { zone: 'mana', owner: 'self' } }, to: 'mana', cause: 'effect' } })], '自分のマナゾーンにあるカードと同じ枚数のカードを、山札の上からマナゾーンに置きますか?'),
        ],
        { optional: true, label: '終極宣言: 手札と同じ枚数のカードを引き、マナゾーンと同じ枚数のカードを山札の上からマナゾーンに置く' },
      ),
    ]),
  ),

  // 11. 銀河竜 ゴルファンタジスタ
  card(
    'dm26sd1-Q11',
    creature('銀河竜 ゴルファンタジスタ', 7, 'WN', 13000, ['ジャイアント・ドラゴン'], [
      revolutionChange('革命チェンジ[コスト5以上のジャイアント]', and(costGte(5), giant)),
      tBreaker(),
      trig({ on: { type: 'entered', owner: 'opponent', cond: isCreature }, subject: 'any' }, [act({ addEffect: { sel: '$ev.card', mods: NOT_ATTACK_OR_BLOCK, until: 'nextTurnStart' } })], {
        label: '相手のクリーチャーが出た時、次の自分のターンのはじめまで、そのクリーチャーは攻撃もブロックもできない',
      }),
      staticAb({ type: 'battleProxy', cond: and(isCreature, giant) }),
    ]),
  ),

  // 12. チアスペース アカネ
  card(
    'dm26sd1-Q12',
    creature('チアスペース アカネ', 5, 'WN', 5000, ['ジャイアント・スノーフェアリー'], [
      gStrike(),
      revolutionChange('革命チェンジ[ジャイアント]', giant),
      machFighter(),
      cip([
        act({ lookTop: { n: 2, as: '$t' } }),
        select('$h', { zone: 'deck', owner: 'self', of: '$t' }, { prompt: '手札に加えるカードを選んでください' }),
        act({ move: { sel: '$h', to: 'hand', cause: 'effect' } }),
        act({ move: { sel: { zone: 'deck', owner: 'self', of: '$t' }, to: 'mana', cause: 'effect' } }),
      ]),
    ]),
  ),

  // 13. 終の怒流牙 ドルゲユキムラ
  card(
    'dm26sd1-Q13',
    evolution('終の怒流牙 ドルゲユキムラ', 8, 'WN', 17000, [GIANT, 'アースイーター', 'シノビ'], and(isCreature, giant), [
      { kind: 'altCost', id: 'gzero', label: 'G・ゼロ: バトルゾーンに自分のジャイアントが4枚以上あれば、コストを支払わずに召喚してもよい', when: { count: myGiants, gte: 4 }, cost: {} },
      tBreaker(),
      cip([
        selectUpTo('$m', { zone: 'mana', owner: 'self', type: 'creature' }, 3, { prompt: '手札に戻す、マナゾーンのクリーチャーを3体まで選んでください' }),
        act({ move: { sel: '$m', to: 'hand', cause: 'effect' } }),
        selectUpTo('$h', { zone: 'hand', owner: 'self' }, 3, { prompt: 'タップしてマナゾーンに置く手札を3枚まで選んでください' }),
        act({ move: { sel: '$h', to: 'mana', cause: 'effect', tapped: true } }),
      ]),
    ]),
  ),
];
