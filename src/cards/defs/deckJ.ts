// デッキJ「めくりに命をかけろ！８軸ガチロボデッキ」(docs/decks-25oudou.md)の新規カード。
import type { CardDef } from '../../engine/types';
import {
  act, and, blocker, bounce, card, cip, civ, creature, destroy, draw, exLife, ifc, maybe, notEvolution, onAttack, oppCreature, select, selectUpTo,
  speedAttacker, spell, sTrigger, staticAb, tBreaker, trig, wBreaker, machFighter,
} from '../dsl';

export const DECK_J: CardDef[] = [
  // 1. ガチャンコ ガチロボ
  card(
    'dm26sd1-J01',
    creature('ガチャンコ ガチロボ', 6, 'W', 6000, ['グレートメカオー', '侵略者'], [
      wBreaker(),
      trig(
        { on: [{ type: 'entered' }, { type: 'attackDeclared' }], subject: 'self' },
        [
          act({ lookTop: { n: 3, as: '$t' } }),
          act({ reveal: { items: '$t' } }),
          ifc({ allSame: { var: '$t', where: { type: 'creature' } } }, [act({ put: { sel: '$t' } })], [act({ bottom: { of: '$t' } })]),
        ],
        { label: '山札の上から3枚を表向きにし、すべて同じコストのクリーチャーなら出す' },
      ),
      staticAb({ type: 'grantKeyword', keyword: 'cannotBeAttacked', cond: and({ type: 'creature' }, civ('W')) }, { shields: { lte: 2, who: 'opponent' } }),
      staticAb({ type: 'grantKeyword', keyword: 'unblockable', cond: and({ type: 'creature' }, civ('W')) }, { shields: { lte: 2, who: 'opponent' } }),
    ]),
  ),

  // 2. カブトリアル・クーガ / ミステリー・ディザスター
  card(
    'dm26sd1-J02',
    creature('カブトリアル・クーガ', 8, 'N', 13000, ['グランセクト'], [
      machFighter(),
      tBreaker(),
      trig({ on: { type: 'battleEnded', winner: 'self' }, subject: 'self' }, [
        act({ lookTop: { n: 3, as: '$t' } }),
        act({ reveal: { items: '$t' } }),
        selectUpTo('$c', { zone: 'deck', owner: 'self', of: '$t', type: 'creature' }, 1, { prompt: '手札に加えるクリーチャーを選んでください' }),
        act({ move: { sel: '$c', to: 'hand', cause: 'effect' } }),
        act({ move: { sel: { zone: 'deck', owner: 'self', of: '$t' }, to: 'mana', cause: 'effect' } }),
      ]),
    ]),
    spell('ミステリー・ディザスター', 5, 'N', [], [
      act({ shuffle: {} }),
      act({ lookTop: { n: 1, as: '$t' } }),
      act({ reveal: { items: '$t' } }),
      ifc({ some: { var: '$t', where: { type: 'creature' } } }, [act({ put: { sel: '$t' } })], [act({ move: { sel: '$t', to: 'mana', cause: 'effect' } })]),
    ]),
  ),

  // 3. 黒豆だんしゃく / 白米男しゃく
  card(
    'dm26sd1-J03',
    creature('黒豆だんしゃく', 8, 'N', 12000, ['グランセクト', 'スペシャルズ'], [
      tBreaker(),
      trig({ on: { type: 'entered', owner: 'opponent', cond: { hasCip: true } }, subject: 'any' }, [act({ move: { sel: '$ev.card', to: 'mana', cause: 'manaPlace' } })], {
        label: '相手の「出た時」で始まる能力を持つクリーチャーが出た時、そのクリーチャーをマナゾーンに置く',
      }),
    ]),
    spell('白米男しゃく', 3, 'N', [], [
      act({ moveTop: { n: 1, to: 'mana', cause: 'effect' } }),
      maybe([select('$m', { zone: 'mana', owner: 'self' }), bounce('$m')], 'カードを1枚、マナゾーンから手札に戻しますか?'),
    ]),
  ),

  // 4. 勝災電融王 ギュカウツ・マグル
  card(
    'dm26sd1-J04',
    creature('勝災電融王 ギュカウツ・マグル', 8, 'WFN', 15000, ['ディスペクター', 'アウトレイジMAX', 'ジ・アンサー'], [
      exLife(),
      tBreaker(),
      cip([
        act({ lookTop: { n: 4, as: '$t' } }),
        {
          op: 'select',
          as: '$m',
          from: { zone: 'deck', owner: 'self', of: '$t', type: 'creature', where: and({ multicolor: true }, notEvolution) },
          sumLte: 9,
          prompt: 'コストの合計が9以下になるように、出す多色クリーチャーを選んでください',
        },
        act({ put: { sel: '$m' } }),
        act({ bottom: { of: '$t' } }),
      ]),
    ]),
  ),

  // 5. 闇参謀グラン・ギニョール
  card(
    'dm26sd1-J05',
    creature('闇参謀グラン・ギニョール', 8, 'WD', 4000, ['デーモン・コマンド', 'チーム零'], [
      { kind: 'altCost', id: 'mugen2', label: 'ムゲンクライム2(クリーチャーを2体タップし、[水/闇(2)]を支払って、手札または墓地から使う)', cost: { from: ['hand', 'grave'], tapCreatures: 2, pay: 2 } },
      sTrigger(),
      cip([
        {
          op: 'modes',
          pick: 1,
          options: [
            { label: '他のクリーチャーを1体選び、持ち主の手札に戻す', steps: [select('$b', { zone: 'battle', owner: 'any', type: 'creature', notSelf: true, chooseable: true }), bounce('$b')] },
            {
              label: '山札の上から2枚を墓地に置いてもよい。そうしたら、その中から1枚を手札に戻す',
              steps: [
                maybe([
                  act({ moveTop: { n: 2, to: 'grave', cause: 'trash', as: '$g' } }),
                  select('$h', { zone: 'grave', owner: 'self', of: '$g' }, { prompt: '手札に戻す1枚を選んでください' }),
                  bounce('$h'),
                ], '山札の上から2枚を墓地に置きますか?'),
              ],
            },
          ],
        },
      ]),
    ]),
  ),

  // 6. 斬龍電融 オロチリュウセイ
  card(
    'dm26sd1-J06',
    creature('斬龍電融 オロチリュウセイ', 8, 'WFN', 17000, ['ディスペクター', 'サイバーロード', 'レッド・コマンド・ドラゴン'], [
      exLife(),
      tBreaker(),
      staticAb({ type: 'grantKeyword', keyword: 'speedAttacker', cond: { type: 'creature' } }),
      staticAb({ type: 'peekDeckTop' }),
      staticAb({ type: 'allowPlayFrom', from: 'deck', cond: { type: 'creature' }, oncePerTurn: true }),
    ]),
  ),

  // 7. ニコル・ボーラス
  card(
    'dm26sd1-J07',
    creature('ニコル・ボーラス', 8, 'WDF', 7000, ['エルダー・ドラゴン', 'プレインズ・ウォーカー'], [
      wBreaker(),
      cip([select('$d', { zone: 'hand', owner: 'opponent' }, { who: 'opponent', min: 7, max: 7, prompt: '捨てる手札を7枚選んでください' }), act({ move: { sel: '$d', to: 'grave', cause: 'discard' } })]),
      onAttack([select('$t', oppCreature()), destroy('$t')]),
    ]),
  ),

  // 8. 不死鳥縫合 ブラック・ビッグバン
  card(
    'dm26sd1-J08',
    creature('不死鳥縫合 ブラック・ビッグバン', 8, 'WDN', 13000, ['ディスペクター', 'フェニックス'], [
      exLife(),
      blocker(),
      tBreaker(),
      trig({ on: [{ type: 'entered' }, { type: 'attackDeclared' }], subject: 'self' }, [act({ moveTop: { n: 2, to: 'grave', cause: 'trash' } }), draw(2)], { label: '山札の上から2枚を墓地に置き、カードを2枚引く' }),
      staticAb({ type: 'noDeckOutLoss' }),
      {
        kind: 'replace',
        label: 'カードを引く時、山札にカードがなければ、かわりにクリーチャーを1体墓地から出してもよい',
        match: { type: 'drawEmpty' },
        apply: { type: 'steps', steps: [maybe([select('$g', { zone: 'grave', owner: 'self', type: 'creature', where: notEvolution }), act({ put: { sel: '$g' } })], 'クリーチャーを1体、墓地から出しますか?')] },
      },
    ]),
  ),

  // 9. 永遠のリュウセイ・カイザー
  card(
    'dm26sd1-J09',
    creature('永遠のリュウセイ・カイザー', 8, 'F', 8000, ['レッド・コマンド・ドラゴン', 'ハンター'], [
      wBreaker(),
      staticAb({ type: 'grantKeyword', keyword: 'speedAttacker', cond: { type: 'creature' } }),
      staticAb({ type: 'enterTapped' }),
      {
        kind: 'replace',
        label: '相手の効果で手札から捨てられる時、墓地に置くかわりに出す',
        optional: true,
        match: { type: 'moved', from: 'hand', cause: 'discard', byOpponent: true },
        apply: { type: 'steps', steps: [act({ put: { sel: '$self' } })] },
      },
    ]),
  ),

  // 10. ボルシャック・ガラワルド
  card(
    'dm26sd1-J10',
    creature('ボルシャック・ガラワルド', 8, 'F', 9000, ['アーマード・ドラゴン'], [
      { kind: 'selfCost', delta: { sub: [0, { count: { zone: 'battle', owner: 'any', type: 'creature' } }] }, floor: 1 },
      speedAttacker(),
      wBreaker(),
      trig(
        { on: [{ type: 'entered' }, { type: 'attackDeclared' }], subject: 'self' },
        [maybe([select('$t', oppCreature()), act({ battle: { a: '$self', b: '$t' } })], '相手のクリーチャーを1体選んで、このクリーチャーとバトルさせますか?')],
        { label: '出た時または攻撃する時、相手のクリーチャーとバトルさせてもよい' },
      ),
      trig({ on: { type: 'battleEnded', winner: 'self' }, subject: 'self' }, [maybe([draw(1)], 'カードを1枚引きますか?')], { label: 'バトルに勝った時、カードを1枚引いてもよい' }),
    ]),
  ),

  // 11. 閃光の精霊カンビアーレ
  card(
    'dm26sd1-J11',
    creature('閃光の精霊カンビアーレ', 8, 'L', 13000, ['エンジェル・コマンド'], [
      // 革命0: シールドゾーンから手札に加えた時、自分のシールドが1つもなければ、手札からコストを支払わずに召喚してもよい
      trig(
        { on: { type: 'moved', from: 'shield', to: 'hand' }, watch: ['hand'], subject: 'self', if: { shields: { eq: 0 } } },
        [act({ summon: { sel: '$self' } })],
        { optional: true, label: '革命0: シールドがなければ、手札から召喚する' },
      ),
      blocker(),
      tBreaker(),
      cip([act({ tapLock: { sel: { zone: 'battle', owner: 'opponent', type: 'creature' } } })]),
      onAttack([maybe([select('$e', { zone: 'battle', owner: 'opponent', type: 'element', chooseable: true }), act({ move: { sel: '$e', to: 'shield', cause: 'shieldize' } })], '相手のエレメントを1つシールド化しますか?')]),
    ]),
  ),
];

