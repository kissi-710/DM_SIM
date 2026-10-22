// デッキS「相手を翻弄せよ！光闇メカ＆シノビデッキ」(docs/decks-25oudou.md)の新規カード。ニンジャ・チェンジ・ハイパー化・シールド化・離れないなど。
import type { Cond, Expr, Pattern } from '../../engine/ast';
import type { CardDef } from '../../engine/types';
import {
  act, and, blocker, breaker, card, cip, civ, costGte, costLte, creature, draw, hyperMode, hyperize, isCreature, log, maybe, mekureido, myCreature, onAttack,
  oppCreature, or, race, revolutionChange, select, selectUpTo, spell, staticAb, trig, wBreaker, yobinion,
} from '../dsl';

const MECHA = 'メカ';
const mecha = race(MECHA);

/** 自分の光の、クリーチャーまたはタマシードの数(シビルカウント・シェケダン用) */
const lightCount: Expr = {
  add: [
    { count: { zone: 'battle', owner: 'self', type: 'creature', where: civ('L') } },
    { count: { zone: 'battle', owner: 'self', type: 'tamaseed', where: civ('L') } },
  ],
};
const sibyl5: Cond = { cmp: { l: lightCount, op: '>=', r: 5 } };

/** ニンジャ・チェンジ N: 相手のクリーチャーが攻撃またはブロックした時、この攻撃中に自分が「ニンジャ」能力を使っていなければ、手札のこのクリーチャーと、自分のコスト N 以上のメカまたはシノビのクリーチャー1体を入れ替えてもよい */
const ninjaChange = (n: number) =>
  (
    [
      { type: 'attackDeclared', owner: 'opponent' },
      { type: 'blocked', owner: 'opponent' },
    ] as Pattern[]
  ).map((on) =>
    trig(
      { on, watch: ['hand'], subject: 'any', if: { not: { logged: { pattern: { type: 'ninjaChange' }, since: 'attackDeclared' } } } },
      [
        select('$nc', myCreature(and(costGte(n), or(mecha, race('シノビ')))), { prompt: '手札のこのクリーチャーと入れ替える、自分のメカまたはシノビを選んでください' }),
        log('ninjaChange'),
        act({ ninjaChange: { sel: '$nc' } }),
      ],
      { optional: true, label: `ニンジャ・チェンジ${n}` },
    ),
  );

/** メガ・ラスト・バースト */
const megaLastBurst = () => {
  const on: Pattern[] = (['hand', 'mana', 'grave'] as const).map((to) => ({ type: 'moved', from: 'battle', to }));
  return trig({ on, subject: 'self', lookBack: true }, [act({ castFree: { sel: '$self' } })], { optional: true, label: 'メガ・ラスト・バースト' });
};

export const DECK_S: CardDef[] = [
  // 1. 聖カオスマントラ
  card(
    'dm26sd1-S01',
    creature('聖カオスマントラ', 7, 'L', 9500, ['メカ・デル・ステラ', 'シノビ'], [
      ...ninjaChange(5),
      wBreaker(),
      trig({ on: [{ type: 'entered', self: true }, { type: 'attackDeclared', self: true }], subject: 'any' }, [act({ tap: { sel: { zone: 'battle', owner: 'opponent', type: 'creature' } } })], {
        label: '出た時または攻撃する時、相手のクリーチャーをすべてタップする',
      }),
      staticAb({ type: 'noAttackOnEntry' }),
    ]),
  ),

  // 2. ヴェネラック-F5
  card(
    'dm26sd1-S02',
    creature('ヴェネラック-F5', 2, 'L', 2000, ['メカ・デル・ディネロ'], [
      trig({ on: { type: 'entered', owner: 'opponent', paid: 0, cond: isCreature }, turn: 'opponent', subject: 'any' }, [
        maybe([act({ move: { sel: '$ev.card', to: 'shield', cause: 'effect' } })], 'そのクリーチャーをシールド化しますか?'),
      ], { label: '相手のターン中に、相手のクリーチャーが相手のマナゾーンのカードをタップせずに出た時、それをシールド化してもよい' }),
      trig({ on: { type: 'moved', from: 'battle' }, turn: 'opponent', subject: 'self', lookBack: true }, [
        select('$t', oppCreature(), { prompt: 'タップする相手のクリーチャーを選んでください' }),
        act({ tapLock: { sel: '$t' } }),
      ], { label: '相手のターン中に、このクリーチャーが離れた時、相手のクリーチャーを1体選び、タップする。次の相手のターンのはじめに、そのクリーチャーはアンタップしない' }),
    ]),
  ),

  // 3. 光器アメリア
  card(
    'dm26sd1-S03',
    creature('光器アメリア', 2, 'L', 500, ['メカ・デル・ソル'], [
      cip([act({ addShield: { n: 1 } }), act({ playerEffect: { mod: { kind: 'startShield' }, until: 'nextTurnStart' } })]),
    ]),
  ),

  // 4. 獲銀月 ペトローバ
  card(
    'dm26sd1-S04',
    creature('獲銀月 ペトローバ', 3, 'L', 3500, ['メカ・デル・ソル', '超化獣'], [
      blocker(),
      cip([act({ addEffect: { sel: '$self', mod: { kind: 'cannotLeave' }, until: 'nextTurnStart' } })], { label: '出た時、次の自分のターンのはじめまで、このクリーチャーは離れない' }),
      hyperize(1),
      staticAb({ type: 'powerAdd', n: 4000 }, hyperMode),
      breaker(2, hyperMode),
      onAttack([
        maybe([act({ addShield: { n: 1 } })], '山札の上から1枚をシールド化しますか?'),
        maybe([
          select('$h', { zone: 'hand', owner: 'self', type: 'creature', where: { cost: { lte: { count: { zone: 'shield', owner: 'self' } } } } }, { prompt: '出す、手札の、自分のシールドの数以下のコストを持つクリーチャーを選んでください' }),
          act({ put: { sel: '$h' } }),
        ], 'シールドの数以下のコストを持つクリーチャーを手札から出しますか?'),
      ], { if: hyperMode, label: 'ハイパーモード: 攻撃する時、山札の上から1枚をシールド化してもよい。その後、シールドの数以下のコストを持つクリーチャーを手札から出してもよい' }),
    ]),
  ),

  // 5. 忍鎖の聖沌 94nm4
  card(
    'dm26sd1-S05',
    creature('忍鎖の聖沌 94nm4', 3, 'L', 2000, ['メカ・デル・ステラ', 'シノビ'], [
      onAttack([maybe([act({ addShield: { n: 1 } })], '山札の上から1枚をシールド化しますか?')], { label: '攻撃する時、山札の上から1枚をシールド化してもよい' }),
      trig({ on: { type: 'moved', to: 'shield', owner: 'self' }, subject: 'any', limit: { perTurn: 1 } }, mekureido(MECHA, 5), { label: '各ターンに1度、自分のシールドゾーンにカードを置いた時、メカ・メクレイド5する' }),
    ]),
  ),

  // 6. ゴールド・フラウム
  card(
    'dm26sd1-S06',
    creature('ゴールド・フラウム', 4, 'L', 4500, ['メカ・デル・ディネロ', 'メカ・エンジェル・コマンド'], [
      blocker(),
      yobinion(),
      cip([maybe([act({ addShield: { n: 1 } })], '山札の上から1枚目をシールド化しますか?')]),
    ]),
  ),

  // 7. ハイパー・エン・ゲルス
  card(
    'dm26sd1-S07',
    creature('ハイパー・エン・ゲルス', 4, 'L', 4500, ['メカ・エンジェル・コマンド', '超化獣'], [
      trig({ on: { type: 'beforeBreak', selfAttacker: true }, subject: 'any' }, [
        { op: 'repeat', times: { evLen: 'cards' }, body: [maybe([act({ addShield: { n: 1 } })], '山札の上から1枚目をシールド化しますか?')] },
      ], { label: '各ブレイクの前に、山札の上から1枚目をシールド化してもよい' }),
      trig({ on: { type: 'stepStart', step: 'end', player: 'self' }, subject: 'any' }, [
        selectUpTo('$u', { zone: 'battle', owner: 'self', type: 'creature' }, 3, { prompt: 'アンタップする自分のクリーチャーを3体まで選んでください' }),
        act({ untap: { sel: '$u' } }),
      ], { label: '自分のターンの終わりに、自分のクリーチャーを3体までアンタップする' }),
      hyperize(1),
      staticAb({ type: 'powerAdd', n: 5000 }, hyperMode),
      breaker(2, hyperMode),
      staticAb({ type: 'cannotLeaveOwn', cond: isCreature }, and(hyperMode, { shields: { gte: 7 } })),
    ]),
  ),

  // 8. シェケダン・ドメチアーレ
  card(
    'dm26sd1-S08',
    creature('シェケダン・ドメチアーレ', 5, 'L', 5500, ['メカ・デル・ディネロ'], [
      blocker(),
      cip([maybe([draw(lightCount)], '自分の光のクリーチャーまたは光のタマシード1つにつき、カードを1枚引きますか?')]),
      staticAb({ type: 'costDelta', delta: -2, cond: and(or({ type: 'creature' }, { type: 'tamaseed' }), civ('L')), floor: 1 }),
      staticAb({ type: 'powerAdd', n: 10000 }, sibyl5),
      breaker(3, sibyl5),
      onAttack([
        maybe([select('$t', oppCreature()), act({ move: { sel: '$t', to: 'shield', cause: 'effect' } })], '相手のクリーチャーを1体選び、シールド化しますか?'),
      ], { if: sibyl5, label: 'シビルカウント5: 攻撃する時、相手のクリーチャーを1体選び、シールド化してもよい' }),
    ]),
  ),

  // 9. アーテル・ゴルギーニ
  card(
    'dm26sd1-S09',
    creature('アーテル・ゴルギーニ', 5, 'D', 6000, ['メカ・デル・ディネロ', 'スーパーカー・ドラゴン'], [
      blocker(),
      wBreaker(),
      cip([
        {
          op: 'modes',
          pick: 2,
          repeat: true,
          options: [
            {
              label: '相手のクリーチャーを1体選ぶ。このターン、そのクリーチャーのパワーを-4000する',
              steps: [select('$p', oppCreature()), act({ addEffect: { sel: '$p', mod: { kind: 'powerAdd', n: -4000 }, until: 'endOfTurn' } })],
            },
            { label: '自分の山札の上から4枚を墓地に置く', steps: [act({ moveTop: { n: 4, to: 'grave', cause: 'trash' } })] },
            {
              label: 'コスト4以下のクリーチャーを1体、自分の墓地から出す',
              steps: [select('$g', { zone: 'grave', owner: 'self', type: 'creature', where: and(costLte(4), { evolution: false }) }), act({ put: { sel: '$g' } })],
            },
          ],
        },
      ]),
      {
        kind: 'replace',
        label: 'このクリーチャーが離れる時、かわりに自分の他のクリーチャーを1体破壊してもよい',
        optional: true,
        match: { type: 'leave', cond: { isSelf: true } },
        while: { count: { zone: 'battle', owner: 'self', type: 'creature', notSelf: true }, gte: 1 },
        apply: { type: 'steps', steps: [select('$o', { zone: 'battle', owner: 'self', type: 'creature', notSelf: true }, { prompt: 'かわりに破壊する、自分の他のクリーチャーを選んでください' }), act({ move: { sel: '$o', to: 'grave', cause: 'destroy', noReplace: true } })] },
      },
    ]),
  ),

  // 10. アシステスト・アルデッド
  card(
    'dm26sd1-S10',
    creature('アシステスト・アルデッド', 3, 'D', 2000, ['メカ・デル・ステラ'], [
      cip([draw(1)], { if: { count: { zone: 'battle', owner: 'self', type: 'creature', notSelf: true, where: mecha }, gte: 1 }, label: '出た時、自分の他のメカがあれば、カードを1枚引く' }),
      staticAb({ type: 'costDelta', delta: -1, cond: mecha, floor: 1 }),
      {
        kind: 'replace',
        label: 'ウルトラ・セイバー: 自分のメカが離れる時、かわりにこのクリーチャーを破壊してもよい',
        optional: true,
        match: { type: 'leave', owner: 'self', cond: and(isCreature, mecha, { not: { isSelf: true } }) },
        // 置換で破壊するクリーチャーには、さらに置換を重ねない(ウルトラ・セイバーどうしの循環を避ける)
        apply: { type: 'steps', steps: [act({ move: { sel: '$self', to: 'grave', cause: 'destroy', noReplace: true } })] },
      },
    ]),
  ),

  // 11. ブラジェスコ-W1
  card(
    'dm26sd1-S11',
    creature('ブラジェスコ-W1', 2, 'D', 1000, ['メカ・デル・ディネロ'], [
      cip([select('$t', oppCreature()), act({ addEffect: { sel: '$t', mod: { kind: 'powerAdd', n: -3000 }, until: 'endOfTurn' } })]),
    ]),
  ),

  // 12. 千羽忍革 ボジソワカ
  card(
    'dm26sd1-S12',
    creature('千羽忍革 ボジソワカ', 7, 'LD', 10500, ['メカ・デル・ステラ', 'シノビ'], [
      revolutionChange('革命チェンジ[コスト5以上のメカ]', and(costGte(5), mecha)),
      blocker(),
      wBreaker(),
      cip([maybe([act({ moveTop: { n: 4, to: 'grave', cause: 'trash' } })], '山札の上から4枚を墓地に置きますか?')]),
      trig({ on: { type: 'stepStart', step: 'end', player: 'self' }, subject: 'any' }, [
        selectUpTo('$h', { zone: 'hand', owner: 'self', type: 'creature', where: and(costLte(4), { evolution: false }) }, 1, { prompt: '出す、手札のコスト4以下のクリーチャーを選んでください(出さなくてもよい)' }),
        act({ put: { sel: '$h', as: '$e1' } }),
        selectUpTo('$g', { zone: 'grave', owner: 'self', type: 'creature', where: and(costLte(4), { evolution: false }) }, 1, { prompt: '出す、墓地のコスト4以下のクリーチャーを選んでください(出さなくてもよい)' }),
        act({ put: { sel: '$g', as: '$e2' } }),
        act({ addEffect: { sel: '$e1', mod: { kind: 'grant', keyword: 'blocker' }, until: 'nextTurnStart' } }),
        act({ addEffect: { sel: '$e2', mod: { kind: 'grant', keyword: 'blocker' }, until: 'nextTurnStart' } }),
      ], { label: '自分のターンの終わりに、自分のコスト4以下のクリーチャーを手札と墓地から最大1体ずつ出してもよい。次の自分のターンのはじめまで、それらに「ブロッカー」を与える' }),
    ]),
  ),

  // 13. ドラン・ゴル・ゲルス / 豪龍の記憶
  card(
    'dm26sd1-S13',
    creature('ドラン・ゴル・ゲルス', 5, 'LD', 4500, ['メカ・エンジェル・コマンド'], [
      revolutionChange('革命チェンジ[メカ]', mecha),
      cip([
        maybe([act({ breakShields: { n: 1 } })], '自分のシールドを1つブレイクしますか?'),
        maybe([
          select('$h', { zone: 'hand', owner: 'self', type: 'creature', where: and(mecha, costLte(3), { evolution: false }) }, { prompt: '出す、手札のコスト3以下のメカを選んでください' }),
          act({ put: { sel: '$h' } }),
        ], 'コスト3以下のメカを手札から出しますか?'),
      ]),
      megaLastBurst(),
    ]),
    spell('豪龍の記憶', 5, 'L', [], [
      act({ addShield: { n: 1, as: '$sh' } }),
      act({ grantShieldTrigger: { sel: '$sh' } }),
    ], ['メカ・デル・テック']),
  ),
];

