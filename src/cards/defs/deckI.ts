// デッキI「芸術の３ターンキル！火水マジックデッキ」(docs/decks-25oudou.md)の新規カード。
import type { Pattern } from '../../engine/ast';
import type { CardDef } from '../../engine/types';
import {
  act, and, bounce, card, chooseNumber, cip, costGte, costLte, creature, destroy, draw, gStrike, ifc, justDiver, maybe, notEvolution,
  oppCreature, race, revolutionChange, select, selectUpTo, speedAttacker, spell, sTrigger, staticAb, trig, wBreaker,
} from '../dsl';

const MAGIC = 'マジック';

/** マジック・フレンド・バースト: 出た時、自分の他のマジック・クリーチャーを1体タップしてもよい。そうしたら、呪文側を、バトルゾーンに置いたまま、コストを支払わずに唱える */
const friendBurst = () =>
  cip(
    [
      maybe(
        [
          select('$m', { zone: 'battle', owner: 'self', type: 'creature', notSelf: true, where: and({ not: { tapped: true } }, race(MAGIC)) }, { prompt: 'タップする、自分の他のマジック・クリーチャーを選んでください' }),
          act({ tap: { sel: '$m' } }),
          act({ castSide: { sel: '$self' } }),
        ],
        'マジック・フレンド・バースト: 他のマジック・クリーチャーをタップして、呪文側を唱えますか?',
      ),
    ],
    { label: 'マジック・フレンド・バースト' },
  );

/** メガ・ラスト・バースト: このクリーチャーが離れて、手札・マナゾーン・墓地に置かれた時、呪文側を、コストを支払わずに唱えてもよい */
const megaLastBurst = () => {
  const on: Pattern[] = (['hand', 'mana', 'grave'] as const).map((to) => ({ type: 'moved', from: 'battle', to }));
  return trig({ on, subject: 'self', lookBack: true }, [act({ castFree: { sel: '$self' } })], { optional: true, label: 'メガ・ラスト・バースト' });
};

export const DECK_I: CardDef[] = [
  // 1. AQvibrato
  card('dm26sd1-I01', creature('AQvibrato', 2, 'W', 1000, ['マジック・リキッド・ピープル'], [cip([draw(1)])])),

  // 2. アシスター・Mogi林檎
  card(
    'dm26sd1-I02',
    creature('アシスター・Mogi林檎', 2, 'W', 2000, ['マジック・マーフォーク'], [justDiver(), staticAb({ type: 'costDelta', delta: -1, cond: race(MAGIC), oncePerTurn: true })]),
  ),

  // 3. 歌舞音愛 ヒメカット / ♪蛙の子 遭えるの何処? 好きと謂ひて
  card(
    'dm26sd1-I03',
    creature('歌舞音愛 ヒメカット', 2, 'W', 2000, ['マジック・マーメイド'], [
      friendBurst(),
      trig(
        { on: { type: 'moved', to: 'hand', cause: 'draw', owner: 'opponent' }, subject: 'any', turn: 'opponent', nthMin: 2 },
        [draw(1)],
        { optional: true, label: '相手のターン中に、相手が2枚目以降のカードを引いた時、カードを1枚引く' },
      ),
    ]),
    spell('♪蛙の子 遭えるの何処? 好きと謂ひて', 4, 'W', [], [selectUpTo('$b', { zone: 'battle', owner: 'opponent', type: 'element', chooseable: true }, 2, { prompt: '持ち主の手札に戻す相手のエレメントを2つまで選んでください' }), bounce('$b')], ['マジック・ソング']),
  ),

  // 4. ボン・キゴマイム / ♪やせ蛙 ラッキーナンバー ここにあり
  card(
    'dm26sd1-I04',
    creature('ボン・キゴマイム', 3, 'W', 4000, ['マジック・マーフォーク'], [
      trig({ on: { type: 'entered', owner: 'opponent' }, subject: 'any' }, [
        act({ addEffect: { sel: '$ev.card', mod: { kind: 'cannotAttack' }, until: 'endOfTurn' } }),
        ifc({ eventIs: { paid: 0 } }, [maybe([draw(1)], 'カードを1枚引きますか?')]),
      ]),
    ]),
    spell(
      '♪やせ蛙 ラッキーナンバー ここにあり',
      2,
      'W',
      [],
      [chooseNumber('$n', 0, 12), act({ playerEffect: { mod: { kind: 'cannotActCost', n: { var: '$n' } }, until: 'nextTurnStart' } })],
      ['マジック・ソング'],
    ),
  ),

  // 5. 同期の妖精 / ド浮きの動悸
  card(
    'dm26sd1-I05',
    creature('同期の妖精', 2, 'W', 2000, ['ジャイアント・スノーフェアリー'], [staticAb({ type: 'mustBeChosen' }), megaLastBurst()]),
    spell('ド浮きの動悸', 4, 'W', [sTrigger()], [select('$t', oppCreature()), bounce('$t'), draw(1)], ['ジャイアント・スキル']),
  ),

  // 6. 単騎連射 マグナム
  card(
    'dm26sd1-I06',
    creature('単騎連射 マグナム', 3, 'F', 3000, ['アウトレイジ'], [
      {
        kind: 'replace',
        label: '自分のターンに相手のクリーチャーが出る時、かわりに墓地に置く',
        match: { type: 'enter', owner: 'opponent', turn: 'own', cond: { type: 'creature' } },
        apply: { type: 'changeDest', to: 'grave' },
      },
    ]),
  ),

  // 7. Napo獅子-Vi無粋 / ♪オレの歌 聞けよ聞かなきゃ 殴り合い
  card(
    'dm26sd1-I07',
    creature('Napo獅子-Vi無粋', 5, 'F', 6000, ['マジック・ニトロ・ドラゴン'], [
      { kind: 'selfCost', delta: -1, cond: { count: { zone: 'battle', owner: 'self', type: 'creature', where: race(MAGIC) }, gte: 1 } },
      speedAttacker(),
      wBreaker(),
      cip([
        selectUpTo('$d', { zone: 'hand', owner: 'self' }, 2, { prompt: '捨てる手札を2枚まで選んでください' }),
        act({ move: { sel: '$d', to: 'grave', cause: 'discard', as: '$dd' } }),
        act({ draw: { n: { add: [{ var: '$dd' }, 1] } } }),
      ]),
      megaLastBurst(),
    ]),
    spell('♪オレの歌 聞けよ聞かなきゃ 殴り合い', 3, 'F', [], [destroy({ zone: 'battle', owner: 'opponent', type: 'element', where: costLte(2) })], ['マジック・ソング']),
  ),

  // 8. 調律師ピーカプ / ♪音速で 本番中に チューニング
  card(
    'dm26sd1-I08',
    creature('調律師ピーカプ', 4, 'F', 4000, ['マジック・マシン・イーター'], [speedAttacker(), megaLastBurst()]),
    spell(
      '♪音速で 本番中に チューニング',
      3,
      'F',
      [],
      [
        select('$c', { zone: 'battle', owner: 'self', type: 'creature' }, { prompt: 'スピードアタッカーを与える自分のクリーチャーを選んでください' }),
        act({ addEffect: { sel: '$c', mods: [{ kind: 'grant', keyword: 'speedAttacker' }, { kind: 'untapAfterAttack' }], until: 'endOfTurn' } }),
      ],
      ['マジック・ソング'],
    ),
  ),

  // 9. 瞬閃と疾駆と双撃の決断
  card(
    'dm26sd1-I09',
    spell('瞬閃と疾駆と双撃の決断', 3, 'F', [], [
      {
        op: 'modes',
        pick: 2,
        repeat: true,
        options: [
          {
            label: 'コスト3以下のクリーチャーを1体、自分の手札から出す',
            steps: [selectUpTo('$p', { zone: 'hand', owner: 'self', type: 'creature', where: and(costLte(3), notEvolution) }, 1), act({ put: { sel: '$p' } })],
          },
          {
            label: 'このターン、自分のクリーチャー1体に「スピードアタッカー」を与える',
            steps: [select('$s', { zone: 'battle', owner: 'self', type: 'creature' }), act({ addEffect: { sel: '$s', mod: { kind: 'grant', keyword: 'speedAttacker' }, until: 'endOfTurn' } })],
          },
          {
            label: '自分のクリーチャーを1体選ぶ。このターン、そのクリーチャーの最初の攻撃の終わりにアンタップする',
            steps: [select('$u', { zone: 'battle', owner: 'self', type: 'creature' }), act({ addEffect: { sel: '$u', mod: { kind: 'untapAfterAttack' }, until: 'endOfTurn' } })],
          },
        ],
      },
    ]),
  ),

  // 10. 芸魔王将 カクメイジン
  card(
    'dm26sd1-I10',
    creature('芸魔王将 カクメイジン', 7, 'WF', 10000, ['マジック・ドラゴン', 'ゲーム・コマンド'], [
      revolutionChange('革命チェンジ[コスト5以上のマジック]', and(costGte(5), race(MAGIC))),
      wBreaker(),
      staticAb({ type: 'grantKeyword', keyword: 'speedAttacker', cond: and({ type: 'creature' }, race(MAGIC)) }),
      trig(
        { on: { type: 'beforeBreak', selfAttacker: true }, subject: 'any' },
        [
          {
            op: 'repeat',
            times: { evLen: 'cards' },
            body: [
              maybe(
                [
                  select('$s', { zone: ['hand', 'grave'], owner: 'self', type: 'spell', where: costLte({ count: { zone: 'mana', owner: 'self' } }) }, { prompt: 'コストを支払わずに唱える呪文を選んでください(墓地のかわりに山札の下に置く)' }),
                  act({ castFree: { sel: '$s', after: 'deckBottom' } }),
                ],
                '各ブレイクの前に、呪文を無料で唱えますか?',
              ),
            ],
          },
        ],
        { label: '各ブレイクの前に、呪文を無料で唱えてもよい' },
      ),
    ]),
  ),

  // 11. 芸魔隠狐 カラクリバーシ
  card(
    'dm26sd1-I11',
    creature('芸魔隠狐 カラクリバーシ', 5, 'WF', 4000, ['マジック・モンスター', 'ゲーム・コマンド'], [
      gStrike(),
      revolutionChange('革命チェンジ[マジック]', race(MAGIC)),
      speedAttacker(),
      cip([
        maybe([
          draw(1),
          selectUpTo('$s', { zone: 'hand', owner: 'self', type: 'spell', where: costLte(3) }, 1, { prompt: 'コストを支払わずに唱えるコスト3以下の呪文を選んでください(唱えなくてもよい)' }),
          act({ castFree: { sel: '$s' } }),
        ], 'カードを1枚引き、コスト3以下の呪文を無料で唱えますか?'),
      ]),
    ]),
  ),
];
