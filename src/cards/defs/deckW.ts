// デッキW「敵は周回遅れ！火水闇レッドゾーンデッキ」(docs/decks-25oudou.md)の新規カード。侵略・超次元ゾーン・パンドラ・シフト・封印など。
import type { CardDef } from '../../engine/types';
import {
  act, and, anyCiv, card, cip, civ, creature, destroy, draw, evolution, gStrike, invasion, isCreature, justDiver, maybe, nameHas, oppCreature, race, select,
  shinkalize, speedAttacker, staticAb, sTrigger, tamaseed, tBreaker, trig, wBreaker,
} from '../dsl';

const lowestPower = { zone: 'battle', owner: 'opponent', type: 'creature', where: { powerRank: { which: 'min', of: { zone: 'battle', owner: 'opponent', type: 'creature' } } } } as const;
const highestPower = { zone: 'battle', owner: 'opponent', type: 'creature', where: { powerRank: { which: 'max', of: { zone: 'battle', owner: 'opponent', type: 'creature' } } } } as const;

export const DECK_W: CardDef[] = [
  // 1. 終末の時計 ザ・クロック
  card('dm26sd1-W01', creature('終末の時計 ザ・クロック', 3, 'W', 3000, ['アウトレイジMAX'], [sTrigger(), cip([act({ skipRestOfTurn: {} })], { label: '出た時、ターンの残りをとばす' })])),

  // 2. 逆転の影ガレック(殿堂入り)
  card(
    'dm26sd1-W02',
    creature('逆転の影ガレック', 10, 'D', 5000, ['ゴースト'], [
      sTrigger(),
      cip([
        {
          op: 'modes',
          pick: 3,
          repeat: true,
          options: [
            {
              label: '相手のクリーチャーを1体選ぶ。このターン、そのクリーチャーのパワーを-3000する',
              steps: [select('$p', oppCreature()), act({ addEffect: { sel: '$p', mod: { kind: 'powerAdd', n: -3000 }, until: 'endOfTurn' } })],
            },
            { label: '自分の山札の上から3枚を墓地に置く', steps: [act({ moveTop: { n: 3, to: 'grave', cause: 'trash' } })] },
            {
              label: 'コスト3以下のクリーチャーを1体、自分の墓地から出す',
              steps: [select('$g', { zone: 'grave', owner: 'self', type: 'creature', where: and({ cost: { lte: 3 } }, { evolution: false }) }), act({ put: { sel: '$g' } })],
            },
          ],
        },
      ]),
    ]),
  ),

  // 3. 轟く侵略 レッドゾーン
  card(
    'dm26sd1-W03',
    evolution('轟く侵略 レッドゾーン', 6, 'F', 12000, ['ソニック・コマンド', '侵略者'], and(isCreature, civ('F')), [
      invasion('侵略[火のコマンド]', and(civ('F'), race('コマンド'))),
      tBreaker(),
      cip([destroy(highestPower)], { label: '出た時、相手のパワーが一番大きいクリーチャーをすべて破壊する' }),
    ]),
  ),

  // 4. 覇帝なき侵略 レッドゾーンF
  card(
    'dm26sd1-W04',
    evolution('覇帝なき侵略 レッドゾーンF', 6, 'F', 11000, ['ソニック・コマンド', '侵略者'], and(isCreature, civ('F')), [
      invasion('侵略[火のコマンド]', and(civ('F'), race('コマンド'))),
      wBreaker(),
      staticAb({ type: 'noGStrike' }),
      trig({ on: { type: 'attackEnded' }, subject: 'self', limit: { perTurn: 1 } }, [act({ untap: { sel: '$self' } }), act({ destroyTop: { sel: '$self' } })], {
        label: '各ターン、このクリーチャーの最初の攻撃の終わりに、このクリーチャーをアンタップし、一番上のカードを破壊する',
      }),
    ]),
  ),

  // 5. 龍装者 バルチュリス
  card(
    'dm26sd1-W05',
    creature('龍装者 バルチュリス', 5, 'F', 4000, ['ドラゴンギルド', 'ビートジョッキー'], [
      {
        kind: 'trigger',
        optional: true,
        label: '自分のクリーチャーが攻撃する時、このクリーチャーが自分の手札にあり、その攻撃がこのターン2度目のクリーチャーによる攻撃であれば、攻撃の後、このターン自分の《龍装者 バルチュリス》が出ていなければ、このクリーチャーを出してもよい',
        spec: {
          on: { type: 'attackEnded', owner: 'self' },
          watch: ['hand'],
          subject: 'any',
          if: and(
            { logged: { pattern: { type: 'attackEnded', owner: 'self' }, min: 2 } },
            { not: { logged: { pattern: { type: 'attackEnded', owner: 'self' }, min: 3 } } },
            { not: { logged: { pattern: { type: 'entered', owner: 'self', cond: nameHas('龍装者 バルチュリス') } } } },
          ),
        },
        steps: [act({ put: { sel: '$self' } })],
      },
      speedAttacker(),
    ]),
  ),

  // 6. 超次元の王家
  card(
    'dm26sd1-W06',
    creature('超次元の王家', 4, 'WF', 6000, ['エイリアン', 'ハンター', 'キング・コマンド'], [
      { kind: 'altCost', id: 'pandora', label: 'パンドラ・シフト: 実行するコストのかわりに[水/火(2)]を支払って、自分の超次元ゾーンに置く', cost: { pay: 2, toHyper: true } },
      { kind: 'permission', play: 'summon', from: 'hyper' },
      speedAttacker(),
      wBreaker(),
      trig({ on: [{ type: 'entered', self: true }, { type: 'moved', to: 'hyper', self: true }], watch: ['battle', 'hyper'], subject: 'any' }, [draw(2), select('$d', { zone: 'hand', owner: 'self' }, { prompt: '捨てる手札を選んでください' }), act({ move: { sel: '$d', to: 'grave', cause: 'discard' } })], {
        label: '出た時またはこのカードが自分の超次元ゾーンに置かれた時、カードを2枚引く。その後、自分の手札を1枚捨てる',
      }),
    ]),
  ),

  // 7. 再興王女プリン
  card(
    'dm26sd1-W07',
    creature('再興王女プリン', 4, 'WF', 4000, ['キング・コマンド', 'ハンター', 'エイリアン'], [
      speedAttacker(),
      justDiver(),
      trig({ on: { type: 'stepStart', step: 'start', player: 'self' }, subject: 'any' }, [
        maybe([
          act({ move: { sel: '$self', to: 'hyper', cause: 'effect' } }),
          select('$a', { zone: 'hyper', owner: 'self', type: 'creature', where: and(race('エイリアン'), { not: nameHas('再興王女プリン') }) }, { prompt: '出す、超次元ゾーンの《再興王女プリン》ではないエイリアン・クリーチャーを選んでください' }),
          act({ put: { sel: '$a' } }),
        ], 'このクリーチャーを自分の超次元ゾーンに置いて、エイリアン・クリーチャーを超次元ゾーンから出しますか?'),
      ], { label: '自分のターンのはじめに、このクリーチャーを自分の超次元ゾーンに置いてもよい。そうしたら、《再興王女プリン》ではないエイリアン・クリーチャーを1体、自分の超次元ゾーンから出す' }),
    ]),
  ),

  // 8. 禁断の轟速 ブラックゾーン
  card(
    'dm26sd1-W08',
    evolution('禁断の轟速 ブラックゾーン', 7, 'DF', 12000, ['ソニック・コマンド', 'S級侵略者'], and(isCreature, anyCiv('DF')), [
      invasion('S級侵略[轟速]', and(anyCiv('DF'), race('コマンド')), ['hand', 'grave', 'battle']),
      tBreaker(),
      cip([act({ seal: { sel: lowestPower } })], { label: '出た時、相手は自身のパワーが一番小さいクリーチャーすべてに封印を1つずつ付ける' }),
    ]),
  ),

  // 9. 影速 ザ・トリッパー
  card('dm26sd1-W09', creature('影速 ザ・トリッパー', 3, 'DF', 4000, ['ソニック・コマンド', 'ゴースト'], [speedAttacker(), staticAb({ type: 'oppManaTapped' })])),

  // 10. 邪心臓の魔法陣
  card(
    'dm26sd1-W10',
    tamaseed('邪心臓の魔法陣', 3, 'WDF', ['デーモン・コマンド'], [
      gStrike(),
      shinkalize(),
      cip([
        select('$d1', { zone: 'hand', owner: 'self' }, { prompt: '捨てる手札を選んでください' }),
        act({ move: { sel: '$d1', to: 'grave', cause: 'discard' } }),
        {
          op: 'modes',
          pick: 1,
          options: [
            { label: 'カードを3枚引く', steps: [draw(3)] },
            { label: 'カードを2枚引く', steps: [draw(2)] },
            { label: 'カードを1枚引く', steps: [draw(1)] },
            { label: 'カードを引かない', steps: [] },
          ],
        },
        select('$d2', { zone: 'hand', owner: 'self' }, { prompt: 'もう一度、捨てる手札を選んでください' }),
        act({ move: { sel: '$d2', to: 'grave', cause: 'discard' } }),
      ]),
      trig({ on: { type: 'moved', from: 'hand', to: 'mana', owner: 'self' }, watch: ['mana'], subject: 'self' }, [act({ untap: { sel: '$self' } })], { label: 'このカードを自分の手札からマナゾーンに置いた時、アンタップする' }),
    ]),
  ),
];

