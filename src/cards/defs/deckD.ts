// デッキD「目指せ全開ガ・リュミーズ水魔導具デッキ」(docs/decks-25oudou.md)の新規カード。
import type { Cond, Selector } from '../../engine/ast';
import type { CardDef } from '../../engine/types';
import {
  act, and, blocker, bounce, card, civ, costLte, creature, destroy, draw, exLife, field, ifc, justDiver, not, notEvolution,
  onAttack, oppCreature, or, race, select, selectUpTo, slayer, speedAttacker, spell, sTrigger, staticAb, tBreaker, trig, wBreaker,
} from '../dsl';

const DOGU = '魔導具';
const DORUSUZAKU = 'ドルスザク';

/** 無月の門系: 自分の魔導具(バトルゾーン)と墓地の魔導具カードを合計 n 個選び、その上にこのカードを手札・墓地から召喚する */
const guSelector: Selector = { zone: ['battle', 'grave'], owner: 'self', where: race(DOGU) };
function mugenGate(label: string, n: number, on: Cond | object | object[]): ReturnType<typeof trig> {
  return trig(
    { on: on as never, subject: 'any', watch: ['hand', 'grave'], if: { count: guSelector, gte: n } },
    [
      select('$g', guSelector, { min: n, max: n, prompt: `魔導具(バトルゾーン・墓地)を合計${n}つ選んでください(その上に重ねて召喚する)` }),
      act({ summonOnto: { sel: '$self', under: '$g' } }),
    ],
    { optional: true, label },
  );
}

/** 「このターン、そのクリーチャーは攻撃もブロックもできない」を次の自分のターンのはじめまで */
const lockOpp = (as: string) => act({ addEffect: { sel: as, mods: [{ kind: 'cannotAttack' }, { kind: 'cannotBlock' }], until: 'nextTurnStart' } });

export const DECK_D: CardDef[] = [
  // 1. 月下卍壊 ガ・リュミーズ 卍(ドルスザク呪文。コスト99: 他の効果で、コストを支払わずに唱える)
  card(
    'dm26sd1-D01',
    spell(
      '月下卍壊 ガ・リュミーズ 卍',
      99,
      'W',
      [],
      [
        selectUpTo('$d', { zone: ['hand', 'grave'], owner: 'self', type: 'creature', where: race(DORUSUZAKU) }, 4, { prompt: 'コストを支払わずに召喚するドルスザクを選んでください(4体まで)' }),
        act({ summon: { sel: '$d' } }),
        act({ extraTurn: {} }),
      ],
      [DORUSUZAKU],
    ),
  ),

  // 2. 卍 新世壊 卍(無月フィールド)
  card(
    'dm26sd1-D02',
    field('卍 新世壊 卍', 2, 'W', [
      {
        kind: 'replace',
        label: '魔導具呪文を、墓地のかわりにこのフィールドの下に置いて、カードを1枚引く',
        optional: true,
        match: { type: 'afterCast', owner: 'self', cond: race(DOGU) },
        apply: { type: 'steps', steps: [act({ putUnder: { sel: '$ev.card', onto: '$self' } }), draw(1)] },
      },
      staticAb({ type: 'ignoreCastBan', cond: or(race(DOGU), race(DORUSUZAKU)) }),
      trig(
        { on: { type: 'stepStart', step: 'end', player: 'self' }, subject: 'any', if: and({ cmp: { l: { under: '$self' }, op: '>=', r: 4 } }, { unused: 'gate99' }) },
        [
          select('$s', { zone: ['hand', 'grave'], owner: 'self', type: 'spell', where: and(civ('W'), costLte(99)) }, { prompt: 'コストを支払わずに唱える水の呪文を選んでください' }),
          act({ markUsed: { key: 'gate99' } }),
          act({ castFree: { sel: '$s' } }),
        ],
        { optional: true, label: '無月の門99' },
      ),
    ]),
  ),

  // 3〜7. 堕呪(魔導具呪文)
  card('dm26sd1-D03', spell('堕呪 ゾメンザン', 1, 'W', [], [], [DOGU])),
  card(
    'dm26sd1-D04',
    spell(
      '堕呪 ゴンパドゥ',
      2,
      'W',
      [],
      [
        act({ lookTop: { n: 3, as: '$top' } }),
        select('$p', { zone: 'deck', owner: 'self', of: '$top' }, { prompt: '手札に加えるカードを選んでください' }),
        act({ move: { sel: '$p', to: 'hand', cause: 'effect' } }),
        act({ bottom: { of: '$top' } }),
      ],
      [DOGU],
    ),
  ),
  card(
    'dm26sd1-D05',
    spell(
      '堕呪 バレッドゥ',
      2,
      'W',
      [],
      [draw(2), select('$d', { zone: 'hand', owner: 'self' }, { prompt: '捨てる手札を選んでください' }), act({ move: { sel: '$d', to: 'grave', cause: 'discard' } })],
      [DOGU],
    ),
  ),
  card(
    'dm26sd1-D06',
    spell(
      '堕呪 ボックドゥ',
      2,
      'W',
      [sTrigger()],
      [
        // S・トリガー・プラス: 相手のターンに、そのターン中に自分のシールドが2つ以上ブレイクされていれば、S・トリガーで使った時にP能力(テキストの先頭)を得る
        ifc(and({ stUsed: true }, { turnOf: 'opponent' }, { logged: { pattern: { type: 'shieldBroken', owner: 'self' }, min: 2 } }), [
          select('$e', { zone: 'battle', owner: 'opponent', type: 'element', chooseable: true }, { prompt: 'P: 持ち主の手札に戻す相手のエレメントを選んでください' }),
          bounce('$e'),
        ]),
        select('$t', oppCreature(), { prompt: '次の自分のターンのはじめまで、攻撃もブロックもできなくする相手のクリーチャーを選んでください' }),
        lockOpp('$t'),
      ],
      [DOGU],
    ),
  ),
  card(
    'dm26sd1-D07',
    spell(
      '堕呪 エアヴォ',
      4,
      'W',
      [sTrigger()],
      [select('$e', { zone: 'battle', owner: 'any', type: 'element', chooseable: true, where: costLte(7) }, { prompt: '持ち主の手札に戻す、コスト7以下のバトルゾーンのカードを選んでください' }), bounce('$e')],
      [DOGU],
    ),
  ),

  // 8. 好詠音愛 クロカミ
  card(
    'dm26sd1-D08',
    creature('好詠音愛 クロカミ', 3, 'W', 2000, ['マジック・マーメイド'], [
      justDiver(),
      staticAb({ type: 'costDelta', delta: -1, cond: { type: 'spell' }, floor: 1 }),
      trig({ on: { type: 'cast', owner: 'self' }, subject: 'any' }, [select('$t', oppCreature(), { prompt: '次の自分のターンのはじめまで、攻撃もブロックもできなくする相手のクリーチャーを選んでください' }), lockOpp('$t')]),
    ]),
  ),

  // 9. 「無月」の頂 ＄スザーク＄
  card(
    'dm26sd1-D09',
    creature('「無月」の頂 ＄スザーク＄', 10, 'D', 15000, [DORUSUZAKU, 'マフィ・ギャング', 'ゼニス'], [
      mugenGate('無月の門・絶', 6, { type: 'stepStart', step: 'end' }),
      tBreaker(),
      trig({ on: [{ type: 'entered', via: 'summon' }, { type: 'attackDeclared' }], subject: 'self' }, [
        select('$t', oppCreature()),
        destroy('$t'),
        select('$d', { zone: 'hand', owner: 'opponent' }, { random: true }),
        act({ move: { sel: '$d', to: 'grave', cause: 'discard' } }),
      ]),
      trig({ on: { type: 'moved', to: 'grave', owner: 'opponent' }, subject: 'any' }, [draw(1)], { optional: true, label: '相手の墓地にカードが置かれた時、1枚引く' }),
    ]),
  ),

  // 10. 凶鬼98号 ガシャゴン / 堕呪 ブラッドゥ
  card(
    'dm26sd1-D10',
    creature('凶鬼98号 ガシャゴン', 3, 'D', 5000, ['マフィ・ギャング', DOGU], [
      blocker(),
      slayer(),
      onAttack([select('$d', { zone: 'hand', owner: 'self' }, { prompt: '捨てる手札を選んでください' }), act({ move: { sel: '$d', to: 'grave', cause: 'discard' } })]),
      trig({ on: { type: 'blocked', role: 'blocker' }, subject: 'self' }, [select('$d', { zone: 'hand', owner: 'self' }, { prompt: '捨てる手札を選んでください' }), act({ move: { sel: '$d', to: 'grave', cause: 'discard' } })]),
    ]),
    spell(
      '堕呪 ブラッドゥ',
      2,
      'W',
      [],
      [
        {
          op: 'modes',
          pick: 1,
          options: [
            { label: '自分', steps: [act({ shuffleIn: { sel: { zone: 'grave', owner: 'self' } } })] },
            { label: '相手', steps: [act({ shuffleIn: { sel: { zone: 'grave', owner: 'opponent' } } })] },
          ],
        },
        draw(1),
      ],
      [DOGU],
    ),
  ),

  // 11. ガル・ラガンザーク
  card(
    'dm26sd1-D11',
    creature('ガル・ラガンザーク', 8, 'WD', 9000, [DORUSUZAKU, 'マフィ・ギャング'], [
      mugenGate('夢幻無月の門', 4, [
        { type: 'entered', owner: 'self', cond: and({ type: 'creature' }, race(DOGU)) },
        { type: 'cast', owner: 'self', cond: race(DOGU) },
      ]),
      blocker(),
      wBreaker(),
      staticAb({ type: 'protectFromSpells' }),
      {
        kind: 'replace',
        label: '相手のターン中に相手のクリーチャーが召喚以外で出る時、かわりに墓地に置く',
        match: { type: 'enter', owner: 'opponent', turn: 'opponent', notVia: 'summon', cond: { type: 'creature' } },
        apply: { type: 'changeDest', to: 'grave' },
      },
    ]),
  ),

  // 12. 卍月 ガ・リュザーク 卍 / 「すべて見えているぞ!」
  card(
    'dm26sd1-D12',
    creature('卍月 ガ・リュザーク 卍', 9, 'D', 11000, ['マスター・ドルスザク', 'マフィ・ギャング'], [
      mugenGate('無月の門・絶', 6, { type: 'stepStart', step: 'end' }),
      staticAb({ type: 'untapLimit', n: 3 }),
      wBreaker(),
    ]),
    spell('「すべて見えているぞ！」', 5, 'W', [sTrigger()], [act({ playerEffect: { mod: { kind: 'oncePerTurnActs' }, until: 'nextTurnStart' } })]),
  ),

  // 13. 頂上混成 ガリュディアス・モモミーズ'22
  card(
    'dm26sd1-D13',
    creature("頂上混成 ガリュディアス・モモミーズ'22", 99, 'LWF', 99000, ['ディスペクター', 'ジョーカーズ・ドラゴン', DORUSUZAKU], [
      { kind: 'selfCost', delta: -90, cond: { count: { zone: 'grave', owner: 'self', where: not({ type: 'creature' }) }, gte: 4 } },
      exLife(),
      speedAttacker(),
      tBreaker(),
      staticAb({ type: 'cannotCast', cond: and({ type: 'spell' }, not(civ('L'))) }),
      trig(
        { on: { type: 'stepStart', step: 'end', player: 'self' }, subject: 'any' },
        [select('$c', { zone: 'hand', owner: 'self', type: 'creature', where: notEvolution }, { prompt: '手札から出すクリーチャーを選んでください' }), act({ put: { sel: '$c' } })],
        { optional: true, label: 'ターンの終わりに、クリーチャーを手札から出す' },
      ),
    ]),
  ),
];
