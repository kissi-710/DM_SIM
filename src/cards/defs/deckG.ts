// デッキG「輝けボルシャック!火光アーマードデッキ」(docs/decks-25oudou.md)の新規カード。
import type { CardDef } from '../../engine/types';
import {
  act, and, blocker, card, cip, costGte, costLte, creature, destroy, draw, evolution, hyperEnergy, nameHas,
  not, notEvolution, onAttack, oppCreature, race, revolutionChange, select, selectUpTo, speedAttacker, spell, sTrigger, staticAb, tBreaker, trig,
  wBreaker,
} from '../dsl';

const ARMORED = 'アーマード';
const BORUSHAKKU = 'ボルシャック';

/** 相手のターンに出た時、そのターンに自分のシールドが2つ以上ブレイクされていなければ、このクリーチャーを破壊する */
const oppTurnDrawback = () =>
  cip([destroy('$self')], { turn: 'opponent', ifAtResolve: { not: { logged: { pattern: { type: 'shieldBroken', owner: 'self' }, min: 2 } } } });

export const DECK_G: CardDef[] = [
  // 1. 光鎧龍ホーリーグレイス
  card(
    'dm26sd1-G01',
    creature('光鎧龍ホーリーグレイス', 6, 'L', 6500, ['アーマード・アポロニア・ドラゴン'], [
      sTrigger(),
      wBreaker(),
      cip([act({ tap: { sel: oppCreature() } })]),
      oppTurnDrawback(),
    ]),
  ),

  // 2. 超竜ヴァルキリアス
  card(
    'dm26sd1-G02',
    evolution('超竜ヴァルキリアス', 9, 'F', 13000, ['アーマード・ドラゴン'], and({ type: 'creature' }, race('アーマード・ドラゴン')), [
      tBreaker(),
      cip(
        [select('$d', { zone: 'mana', owner: 'self', type: 'creature', where: and(race('ドラゴン'), notEvolution) }, { prompt: 'マナゾーンから出すドラゴン・クリーチャーを選んでください' }), act({ put: { sel: '$d' } })],
        { optional: true, label: 'ドラゴン・クリーチャーをマナゾーンから出す' },
      ),
    ]),
  ),

  // 3. ボルメテウス・サファイア・ドラゴン
  card(
    'dm26sd1-G03',
    creature('ボルメテウス・サファイア・ドラゴン', 10, 'F', 11000, ['アーマード・ドラゴン'], [
      speedAttacker(),
      staticAb({ type: 'powerAttacker', n: 3000 }),
      tBreaker(),
      staticAb({ type: 'burnShields' }),
    ]),
  ),

  // 4. GENJI・ハイパーXX
  card('dm26sd1-G04', creature('GENJI・ハイパーXX', 5, 'F', 5000, ['アーマード・ドラゴン', 'フレイム・コマンド', 'サムライ'], [hyperEnergy(), speedAttacker()])),

  // 5. アシスター・コッピ
  card(
    'dm26sd1-G05',
    creature('アシスター・コッピ', 2, 'F', 3000, ['アーマード・ファイアー・バード'], [
      staticAb({ type: 'powerAttacker', n: 2000 }),
      staticAb({ type: 'costDelta', delta: -1, cond: race(ARMORED), oncePerTurn: true }),
    ]),
  ),

  // 6. 竜皇神 ボルシャック・バクテラス
  card(
    'dm26sd1-G06',
    creature('竜皇神 ボルシャック・バクテラス', 10, 'LF', 17000, ['アーマード・ドラゴン'], [
      revolutionChange('革命チェンジ[コスト7以上の名前に《ボルシャック》とある多色クリーチャー]', and(costGte(7), { multicolor: true }, nameHas(BORUSHAKKU))),
      tBreaker(),
      cip([
        act({ lookTop: { n: 4, as: '$top' } }),
        selectUpTo('$a', { zone: 'deck', owner: 'self', of: '$top', type: 'creature', where: and(race(ARMORED), not(nameHas('バクテラス')), notEvolution) }, 99, { prompt: '出すアーマードを好きな数選んでください' }),
        act({ put: { sel: '$a' } }),
        act({ bottom: { of: '$top' } }),
      ]),
      staticAb({ type: 'grantKeyword', keyword: 'blocker', cond: not({ isSelf: true }) }),
      staticAb({ type: 'grantKeyword', keyword: 'speedAttacker', cond: not({ isSelf: true }) }),
      trig({ on: { type: 'stepStart', step: 'end' }, subject: 'any' }, [act({ untap: { sel: { zone: 'battle', owner: 'self', type: 'creature', notSelf: true } } })], { label: 'ターンの終わりに、自分の他のクリーチャーをすべてアンタップする' }),
    ]),
  ),

  // 7. チャラ・ルピア
  card(
    'dm26sd1-G07',
    creature('チャラ・ルピア', 2, 'LF', 1500, ['ファイアー・バード'], [staticAb({ type: 'costDelta', delta: -2, cond: and({ type: 'creature' }, race('ドラゴン')) })]),
  ),

  // 8. ボルシャック・ヴォルジャアク
  card(
    'dm26sd1-G08',
    creature('ボルシャック・ヴォルジャアク', 7, 'LF', 11000, ['アーマード・ドラゴン'], [
      revolutionChange('革命チェンジ[コスト5以上のアーマード]', and(costGte(5), race(ARMORED))),
      speedAttacker(),
      wBreaker(),
      trig({ on: { type: 'entered' }, subject: 'any', limit: { perTurn: 1 } }, [act({ addShield: { n: 1 } })], { optional: true, label: '各ターンに1度、クリーチャーが出た時、山札の上から1枚目をシールド化する' }),
      trig(
        { on: { type: 'moved', from: 'battle', cause: 'destroy' }, subject: 'self', lookBack: true },
        [
          selectUpTo('$b', { zone: 'hand', owner: 'self', type: 'creature', where: and(nameHas(BORUSHAKKU), costLte(7), notEvolution) }, 1, { prompt: '手札から出す、名前に《ボルシャック》とあるコスト7以下のクリーチャーを選んでください' }),
          act({ put: { sel: '$b' } }),
        ],
        { optional: true, label: '破壊された時、ボルシャックを手札から出す' },
      ),
      trig(
        { on: { type: 'stepStart', step: 'start', player: 'self' }, subject: 'any', if: { unused: 'shuukyoku' } },
        [
          act({ markUsed: { key: 'shuukyoku' } }),
          act({ playerEffect: { mod: { kind: 'cannotLose' }, until: 'nextTurnStart' } }),
          act({ breakShields: {} }),
        ],
        { optional: true, label: '終極宣言: 自分のシールドをすべてブレイクし、次の自分のターンのはじめまで負けない' },
      ),
    ]),
  ),

  // 9. 輝く革命 ボルシャック・フレア
  card(
    'dm26sd1-G09',
    creature('輝く革命 ボルシャック・フレア', 7, 'LF', 10500, ['アーマード・ドラゴン'], [
      revolutionChange('革命チェンジ[コスト5以上のアーマード]', and(costGte(5), race(ARMORED))),
      blocker(),
      speedAttacker(),
      wBreaker(),
      staticAb({ type: 'firstBattleWins' }),
      staticAb({ type: 'enterTappedFirst' }),
      trig({ on: { type: 'stepStart', step: 'end', player: 'self' }, subject: 'any' }, [act({ untap: { sel: '$self' } })], { label: '自分のターンの終わりに、このクリーチャーをアンタップする' }),
    ]),
  ),

  // 10. 飛ぶ革命 ヴァル・ボルシャック
  card(
    'dm26sd1-G10',
    creature('飛ぶ革命 ヴァル・ボルシャック', 5, 'LF', 5500, ['アーマード・ドラゴン'], [
      revolutionChange('革命チェンジ[アーマード]', race(ARMORED)),
      speedAttacker(),
      cip([
        selectUpTo('$c', { zone: 'battle', owner: 'any', type: 'creature', notSelf: true, chooseable: true }, 2, { prompt: 'タップまたはアンタップする他のクリーチャーを2体まで選んでください' }),
        {
          op: 'each',
          in: '$c',
          as: '$x',
          body: [
            {
              op: 'modes',
              pick: 1,
              options: [
                { label: 'タップする', steps: [act({ tap: { sel: '$x' } })] },
                { label: 'アンタップする', steps: [act({ untap: { sel: '$x' } })] },
              ],
            },
          ],
        },
      ]),
    ]),
  ),

  // 11. 頂上印鑑 パラキン8th / 「魔物が居るな……」
  card(
    'dm26sd1-G11',
    creature('頂上印鑑 パラキン8th', 5, 'F', 5000, ['ジュラシック・コマンド・ドラゴン', 'アーマードン'], [
      { kind: 'altCost', id: 'para', label: '召喚コストを1少なくする(ターンの終わりに破壊される)', cost: { reduce: 1 } },
      speedAttacker(),
      trig({ on: { type: 'stepStart', step: 'end', player: 'self' }, subject: 'any', if: { altUsed: 'para' } }, [destroy('$self')], { label: '召喚コストを少なくして出した場合、ターンの終わりに破壊される' }),
      onAttack([act({ untap: { sel: '$self' } }), draw(2)], { if: { count: { zone: 'hand', owner: 'self' }, lte: 1 } }),
    ]),
    spell('「魔物が居るな……」', 4, 'LN', [sTrigger()], [
      select('$t', { zone: 'battle', owner: 'opponent', type: 'creature', where: { tapped: false } }, { who: 'opponent', min: 2, max: 2, prompt: 'タップする、自身のアンタップしているクリーチャーを2体選んでください' }),
      act({ tap: { sel: '$t' } }),
      draw(1),
      select('$m', { zone: 'hand', owner: 'self' }, { prompt: 'マナゾーンに置く手札を選んでください' }),
      act({ move: { sel: '$m', to: 'mana', cause: 'effect' } }),
    ]),
  ),
];
