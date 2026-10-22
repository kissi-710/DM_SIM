// デッキY「進化王！闇自然ケンジ・キングダムデッキ」(docs/decks-25oudou.md)の新規カード。究極進化・スター進化・墓地から召喚する進化クリーチャーなど。
import type { Cond, StepDef } from '../../engine/ast';
import type { CardDef, Face } from '../../engine/types';
import {
  act, and, card, cip, civ, creature, evolution, gStrike, isCreature, machFighter, onAttack, or, race, select, selectUpTo, shinkalize, slayer, spell, sTrigger, tamaseed,
  tBreaker, trig, wBreaker,
} from '../dsl';

const REX = 'レクスターズ';
const evoCreature: Cond = and(isCreature, { evolution: true });
const REX_OR_NATURE: Cond = and(isCreature, or(race(REX), civ('N')));

/** スター進化(離れる時、かわりに一番上のカードだけが離れる) */
const star = (f: Face): Face => ({ ...f, star: true });
/** 究極進化 */
const ultimate = (f: Face): Face => ({ ...f, ultimate: true });

/** 山札の上から n 枚を見て、進化クリーチャーを手札に加え、残りを山札の下に置く(max: 加える数の上限) */
const evoSearch = (n: number, max: number, reveal: boolean): StepDef[] => [
  act({ lookTop: { n, as: '$t' } }),
  ...(reveal ? [act({ reveal: { items: '$t' } })] : []),
  selectUpTo('$e', { zone: 'deck', owner: 'self', of: '$t', type: 'creature', where: { evolution: true } }, max, { prompt: '手札に加える進化クリーチャーを選んでください' }),
  act({ move: { sel: '$e', to: 'hand', cause: 'effect' } }),
  act({ bottom: { of: '$t' } }),
];

export const DECK_Y: CardDef[] = [
  // 1. 星空に浮かぶニンギョ
  card(
    'dm26sd1-Y01',
    creature('星空に浮かぶニンギョ', 2, 'D', 1000, ['マフィ・ギャング', REX], [
      gStrike(),
      slayer(),
      {
        kind: 'replace',
        label: '相手のターン中、相手が自身の手札以外から自身のマナゾーンにカードを置く時、かわりに墓地に置く',
        match: { type: 'move', to: 'mana', notFrom: 'hand', owner: 'opponent', turn: 'opponent' },
        apply: { type: 'changeDest', to: 'grave' },
      },
    ]),
  ),

  // 2. 超神羅ギュンター・ペガサス
  card(
    'dm26sd1-Y02',
    ultimate(
      evolution('超神羅ギュンター・ペガサス', 5, 'N', 17000, ['ドリームメイト', 'ルナーズ・サンガイザー'], and(isCreature, { ultimate: true }), [
        { kind: 'permission', play: 'summon', from: 'mana' },
        tBreaker(),
        onAttack([
          {
            op: 'modes',
            pick: 1,
            options: [
              { label: '山札の上から3枚までマナゾーンに置く(3枚)', steps: [act({ moveTop: { n: 3, to: 'mana', cause: 'effect' } })] },
              { label: '山札の上から2枚をマナゾーンに置く', steps: [act({ moveTop: { n: 2, to: 'mana', cause: 'effect' } })] },
              { label: '山札の上から1枚をマナゾーンに置く', steps: [act({ moveTop: { n: 1, to: 'mana', cause: 'effect' } })] },
              { label: 'マナゾーンに置かない', steps: [] },
            ],
          },
          selectUpTo('$c', { zone: 'mana', owner: 'self', type: 'creature', where: { evolution: false } }, { count: { zone: 'mana', owner: 'self', type: 'creature' } }, { prompt: '出すクリーチャーを好きな数選んでください' }),
          act({ put: { sel: '$c', noTriggers: true } }),
        ], { label: '攻撃する時、自分の山札の上から3枚までマナゾーンに置く。その後、クリーチャーを好きな数、自分のマナゾーンから出す。これらのクリーチャーが出ることによって起こる効果はすべて無視する' }),
      ]),
    ),
  ),

  // 3. 晴舞龍 ズンドコ・モモキング
  card(
    'dm26sd1-Y03',
    star(
      evolution('晴舞龍 ズンドコ・モモキング', 2, 'N', 5000, ['ジョーカーズ', REX], REX_OR_NATURE, [
        cip([act({ moveTop: { n: 1, to: 'mana', cause: 'effect' } })]),
        trig({ on: { type: 'moved', from: 'battle' }, subject: 'self', lookBack: true }, [
          select('$m', { zone: 'mana', owner: 'self' }, { prompt: '手札に戻す、自分のマナゾーンのカードを選んでください' }),
          act({ move: { sel: '$m', to: 'hand', cause: 'effect' } }),
        ], { label: 'このカードが離れた時、カードを1枚、自分のマナゾーンから手札に戻す' }),
      ]),
    ),
  ),

  // 4. ツクっちょ <メイ様.Star>
  card(
    'dm26sd1-Y04',
    star(evolution('ツクっちょ <メイ様.Star>', 1, 'N', 5000, ['グランセクト', 'ドリームメイト', REX], REX_OR_NATURE, [machFighter()])),
  ),

  // 5. ヘルコプ太の心絵
  card(
    'dm26sd1-Y05',
    tamaseed('ヘルコプ太の心絵', 1, 'N', ['ジョーカーズ', REX], [shinkalize(), cip(evoSearch(4, 1, true))]),
  ),

  // 6. 進化設計図
  card('dm26sd1-Y06', spell('進化設計図', 2, 'N', [sTrigger()], evoSearch(6, 6, true))),

  // 7. 神羅ケンジ・キングダム
  card(
    'dm26sd1-Y07',
    ultimate(
      evolution('神羅ケンジ・キングダム', 4, 'DN', 6000, ['デーモン・コマンド', 'ドリームメイト', 'ルナティック・エンペラー'], evoCreature, [
        { kind: 'permission', play: 'summon', from: 'grave' },
        wBreaker(),
        cip([
          act({ moveTop: { n: 3, to: 'grave', cause: 'trash', as: '$g' } }),
          selectUpTo('$c', { zone: 'grave', owner: 'self', of: '$g', type: 'creature', where: { evolution: false } }, 1, { prompt: '出す、その3枚の中のクリーチャーを選んでください' }),
          act({ put: { sel: '$c' } }),
        ]),
      ]),
    ),
  ),
];

