// デッキO「タマシード戦略の火光水ライオネルデッキ」(docs/decks-25oudou.md)の新規カード。
import type { Cond } from '../../engine/ast';
import type { CardDef, Face } from '../../engine/types';
import {
  act, and, anyCiv, card, cip, civ, costLte, creature, destroy, draw, evolution, gStrike, ifc, isCreature, maybe, myCreature, not, or, poweredBreaker, race, select,
  shinkalize, spell, sTrigger, staticAb, tamaseed, tBreaker, trig, wBreaker,
} from '../dsl';

const REX = 'レクスターズ';

/** スター進化(離れる時、かわりに一番上のカードだけが離れる) */
const star = (f: Face): Face => ({ ...f, star: true });

/** 自分の水の、クリーチャーまたはタマシードが合計3つ以上(シビルカウント3) */
const sibyl3Water: Cond = {
  cmp: {
    l: { add: [{ count: { zone: 'battle', owner: 'self', type: 'creature', where: civ('W') } }, { count: { zone: 'battle', owner: 'self', type: 'tamaseed', where: civ('W') } }] },
    op: '>=',
    r: 3,
  },
};

export const DECK_O: CardDef[] = [
  // 1. 「正義星帝」 <ライオネル.Star>
  card(
    'dm26sd1-O01',
    star(evolution('「正義星帝」 <ライオネル.Star>', 5, 'L', 9500, ['メタリカ', 'エンジェル・コマンド', REX], and(isCreature, or(race(REX), civ('L'))), [
      wBreaker(),
      cip([
        draw(1),
        maybe(
          [select('$t', { zone: 'hand', owner: 'self', type: 'tamaseed', where: civ('L') }, { prompt: '出す、手札の光のタマシードを選んでください' }), act({ put: { sel: '$t' } })],
          '光のタマシードを手札から出しますか?',
        ),
      ]),
      trig(
        { on: { type: 'entered', owner: 'self', cond: { type: 'tamaseed' } }, subject: 'any', limit: { perTurn: 1 } },
        [
          maybe(
            [
              select('$h', { zone: 'hand', owner: 'self', type: 'creature', where: and({ evolution: true }, costLte(6)) }, { prompt: '出す、手札のコスト6以下の進化クリーチャーを選んでください' }),
              select('$b', myCreature({ baseFor: '$h' }), { prompt: '進化元にする自分のクリーチャーを選んでください' }),
              act({ put: { sel: '$h', onto: '$b' } }),
            ],
            'コスト6以下の進化クリーチャーを手札から出しますか?',
          ),
        ],
        { label: '各ターンに1度、自分のタマシードが出た時、コスト6以下の進化クリーチャーを1体、自分の手札から出してもよい' },
      ),
    ])),
  ),

  // 2. MAX・ザ・ジョニー
  card('dm26sd1-O02', {
    ...creature('MAX・ザ・ジョニー', 6, 'L', 10000, ['ジョーカーズ', REX], [
      poweredBreaker(6000),
      {
        kind: 'replace',
        label: '自分がゲームに負ける時、かわりにこのクリーチャーを破壊する',
        optional: true,
        match: { type: 'gameLoss', player: 'self' },
        apply: { type: 'steps', steps: [destroy('$self')] },
      },
      {
        kind: 'replace',
        label: '自分がゲームに負ける時、かわりに自分の手札から《MAX・ザ・ジョニー》を1枚捨てる',
        optional: true,
        match: { type: 'gameLoss', player: 'self' },
        while: { count: { zone: 'hand', owner: 'self', where: { nameHas: 'MAX・ザ・ジョニー' } }, gte: 1 },
        apply: {
          type: 'steps',
          steps: [
            select('$d', { zone: 'hand', owner: 'self', where: { nameHas: 'MAX・ザ・ジョニー' } }, { prompt: '捨てる《MAX・ザ・ジョニー》を選んでください' }),
            act({ move: { sel: '$d', to: 'grave', cause: 'discard' } }),
          ],
        },
      },
      staticAb({ type: 'powerAddExpr', expr: { mul: [2000, { count: { zone: 'battle', owner: 'self', notSelf: true, where: or(race('ジョーカーズ'), race(REX)) } }] } }),
      trig({ on: { type: 'beforeBreak', selfAttacker: true }, subject: 'any' }, [{ op: 'repeat', times: { evLen: 'cards' }, body: [act({ addShield: { n: 1 } })] }], { label: '各ブレイクの前に、山札の上から1枚目をシールド化する' }),
      trig({ on: { type: 'attackEnded' }, subject: 'self', if: { shields: { gte: 10 } } }, [act({ win: {} })], { label: '攻撃の終わりに、自分のシールドが10以上あれば、自分はゲームに勝つ' }),
    ]),
    type: 'smaxEvolution',
  }),

  // 3. ジョーカーズの心絵
  card(
    'dm26sd1-O03',
    tamaseed('ジョーカーズの心絵', 8, 'L', ['ジョーカーズ', REX], [
      shinkalize(),
      cip([
        {
          op: 'forPlayers',
          body: [
            select('$keep', { zone: 'battle', owner: 'iter', type: 'creature' }, { who: 'iter', min: 0, max: 1, prompt: '残す、自分のクリーチャーを1体まで選んでください' }),
            { op: 'select', as: '$keep', who: 'iter', from: { zone: 'battle', owner: 'iter', type: 'tamaseed' }, min: 0, max: 1, append: true, prompt: '残す、自分のタマシードを1つまで選んでください' },
            {
              op: 'select',
              as: '$rest',
              who: 'iter',
              from: { zone: 'battle', owner: 'iter', type: 'element', where: or({ type: 'creature' }, { type: 'tamaseed' }), except: '$keep' },
              min: { count: { zone: 'battle', owner: 'iter', type: 'element', where: or({ type: 'creature' }, { type: 'tamaseed' }), except: '$keep' } },
              max: { count: { zone: 'battle', owner: 'iter', type: 'element', where: or({ type: 'creature' }, { type: 'tamaseed' }), except: '$keep' } },
            },
            act({ setVar: { as: '$n', value: { count: { zone: 'battle', owner: 'iter', type: 'element', where: or({ type: 'creature' }, { type: 'tamaseed' }), except: '$keep' } } } }),
            act({ shuffleIn: { sel: '$rest' } }),
            { op: 'repeat', times: { var: '$n' }, body: [act({ addShield: { n: 1, who: 'iter' } })] },
          ],
        },
      ]),
    ]),
  ),

  // 4. スロットンの心絵
  card(
    'dm26sd1-O04',
    tamaseed('スロットンの心絵', 5, 'L', ['ジョーカーズ', REX], [
      sTrigger(),
      shinkalize(),
      cip([
        {
          op: 'modes',
          pick: 1,
          options: [
            { label: 'カードを1枚引く', steps: [draw(1)] },
            {
              label: '光のコスト7以下の進化クリーチャーを1体、自分の手札から出す。次の自分のターンのはじめまで、そのクリーチャーに「ブロッカー」を与える',
              steps: [
                select('$h', { zone: 'hand', owner: 'self', type: 'creature', where: and({ evolution: true }, civ('L'), costLte(7)) }, { prompt: '出す、手札の光のコスト7以下の進化クリーチャーを選んでください' }),
                select('$b', myCreature({ baseFor: '$h' }), { prompt: '進化元にする自分のクリーチャーを選んでください' }),
                act({ put: { sel: '$h', onto: '$b', as: '$e' } }),
                act({ addEffect: { sel: '$e', mod: { kind: 'grant', keyword: 'blocker' }, until: 'nextTurnStart' } }),
              ],
            },
          ],
        },
      ]),
    ]),
  ),

  // 5. ゲラッチョの心絵
  card(
    'dm26sd1-O05',
    tamaseed('ゲラッチョの心絵', 2, 'L', ['ジョーカーズ', REX], [
      sTrigger(),
      shinkalize(),
      cip([
        draw(1),
        select('$t', { zone: 'battle', owner: 'opponent', type: 'creature', where: { tapped: false } }, { who: 'opponent', prompt: 'タップする、自分のアンタップしているクリーチャーを選んでください' }),
        act({ tap: { sel: '$t' } }),
      ]),
    ]),
  ),

  // 6. コーライルの海幻
  card(
    'dm26sd1-O06',
    tamaseed('コーライルの海幻', 4, 'W', ['サイバーロード', REX], [
      sTrigger(),
      shinkalize(),
      cip([
        select('$t', { zone: 'battle', owner: 'any', type: 'element', chooseable: true, where: or({ type: 'creature' }, { type: 'tamaseed' }) }, { prompt: '山札の下に置くクリーチャーまたはタマシードを選んでください' }),
        act({ move: { sel: '$t', to: 'deck', pos: 'bottom', cause: 'effect' } }),
        ifc({ some: { var: '$t', where: { ownedBy: 'self' } } }, [draw(1)], [act({ draw: { n: 1, who: 'opponent' } })]),
      ]),
    ]),
  ),

  // 7. ♪なぜ離れ どこへ行くのか 君は今
  card(
    'dm26sd1-O07',
    spell('♪なぜ離れ どこへ行くのか 君は今', 3, 'W', [], [
      {
        op: 'modes',
        pick: 1,
        options: [
          { label: '自分の墓地をシャッフルして、山札の下に置く', steps: [act({ graveToBottom: { who: 'self' } })] },
          { label: '相手の墓地をシャッフルして、山札の下に置く', steps: [act({ graveToBottom: { who: 'opponent' } })] },
        ],
      },
      draw(2),
    ], ['マジック・ソング']),
  ),

  // 8. AQ NETWORK
  card(
    'dm26sd1-O08',
    creature('AQ NETWORK', 5, 'W', 5000, ['マジック・リキッド・ピープル'], [
      sTrigger(),
      cip([
        maybe(
          [
            select('$h', { zone: 'hand', owner: 'self', where: and(or({ type: 'tamaseed' }, { type: 'spell' }), costLte(5)) }, { prompt: 'コストを支払わずに実行する、手札のコスト5以下のタマシードまたは呪文を選んでください' }),
            ifc({ some: { var: '$h', where: { type: 'spell' } } }, [act({ castFree: { sel: '$h' } })], [act({ put: { sel: '$h' } })]),
          ],
          'コスト5以下のタマシードまたは呪文を手札からコストを支払わずに実行しますか?',
        ),
      ]),
      staticAb({ type: 'grantKeyword', keyword: 'blocker', cond: { isSelf: true } }, sibyl3Water),
      {
        kind: 'replace',
        label: 'シビルカウント3: 破壊される時、かわりに手札に戻す',
        match: { type: 'moved', from: 'battle', cause: 'destroy' },
        while: sibyl3Water,
        apply: { type: 'changeDest', to: 'hand' },
      },
    ]),
  ),

  // 9. 理想と平和の決断
  card(
    'dm26sd1-O09',
    spell('理想と平和の決断', 4, 'LW', [sTrigger({ shields: { lte: 2 } })], [
      {
        op: 'modes',
        pick: 2,
        repeat: true,
        options: [
          {
            label: '自分の山札の上から2枚を表向きにする。その中から光のカードと水のカードをすべて手札に加え、残りを山札の下に置く',
            steps: [
              act({ lookTop: { n: 2, as: '$t' } }),
              act({ reveal: { items: '$t' } }),
              act({ move: { sel: { zone: 'deck', owner: 'self', of: '$t', where: anyCiv('LW') }, to: 'hand', cause: 'effect' } }),
              act({ bottom: { of: '$t' } }),
            ],
          },
          { label: '自分の山札の上から1枚をシールド化する', steps: [act({ addShield: { n: 1 } })] },
          {
            label: 'コスト3以下のエレメントを1つ選び、シールド化する',
            steps: [
              select('$e', { zone: 'battle', owner: 'any', type: 'element', chooseable: true, where: costLte(3) }, { prompt: 'シールド化するコスト3以下のエレメントを選んでください' }),
              act({ move: { sel: '$e', to: 'shield', cause: 'effect' } }),
            ],
          },
        ],
      },
    ]),
  ),

  // 10. アルカディアス・モモキング
  card(
    'dm26sd1-O10',
    star(evolution('アルカディアス・モモキング', 6, 'LF', 12500, ['ジョーカーズ・ドラゴン', 'エンジェル・コマンド', REX], and(isCreature, or(race(REX), civ('L'), civ('F'))), [
      tBreaker(),
      staticAb({ type: 'powerAddOthers', n: 2000, cond: race(REX) }),
      staticAb({ type: 'cannotCast', cond: not(civ('L')) }),
      staticAb({ type: 'enterTappedFirst' }),
    ])),
  ),

  // 11. 邪脳の魔法陣
  card(
    'dm26sd1-O11',
    tamaseed('邪脳の魔法陣', 5, 'LWD', ['デーモン・コマンド'], [
      gStrike(),
      shinkalize(),
      cip([
        maybe([act({ moveTop: { n: 3, to: 'grave', cause: 'trash' } })], '山札の上から3枚を墓地に置きますか?'),
        maybe(
          [
            select('$g', { zone: 'grave', owner: 'self', where: and(not({ type: 'creature' }), costLte(4)) }, { prompt: 'コストを支払わずに実行する、墓地のコスト4以下のクリーチャーではないカードを選んでください' }),
            ifc({ some: { var: '$g', where: { type: 'spell' } } }, [act({ castFree: { sel: '$g' } })], [act({ put: { sel: '$g' } })]),
          ],
          'コスト4以下のクリーチャーではないカードを墓地からコストを支払わずに実行しますか?',
        ),
      ]),
      trig({ on: { type: 'moved', from: 'hand', to: 'mana', owner: 'self' }, watch: ['mana'], subject: 'self' }, [act({ untap: { sel: '$self' } })], { label: 'このカードを自分の手札からマナゾーンに置いた時、アンタップする' }),
    ]),
  ),
];

