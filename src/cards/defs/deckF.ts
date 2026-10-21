// デッキF「相手の隙に一撃必殺!水闇手札破壊デッキ」(docs/decks-25oudou.md)の新規カード。
import type { CardDef } from '../../engine/types';
import {
  act, and, blocker, bounce, breaker, card, cip, costLte, creature, destroy, draw, hyperMode, hyperize, justDiver, maybe, notEvolution, race,
  select, selectUpTo, shinkalize, sTrigger, staticAb, tamaseed, trig, wBreaker,
} from '../dsl';

const DEATHPUPPET = 'デスパペット';

/** 相手の手札を1枚、見ないで選び(無作為)、捨てさせる */
const oppDiscardRandom = (as = '$od') => [select(as, { zone: 'hand', owner: 'opponent' }, { random: true }), act({ move: { sel: as, to: 'grave', cause: 'discard' } })];

/** Vチャロン: プレイヤー1人の、手札を山札の下に置いて同じ枚数引き、シールドを山札の下に置いて同じ枚数をシールド化する */
const vChalon = (who: 'self' | 'opponent') => [
  act({ move: { sel: { zone: 'hand', owner: who }, to: 'deck', pos: 'bottom', cause: 'effect', as: '$h' } }),
  act({ draw: { n: { var: '$h' }, who: who === 'self' ? 'controller' : 'opponent' } }),
  act({ move: { sel: { zone: 'shield', owner: who }, to: 'deck', pos: 'bottom', cause: 'effect', as: '$s' } }),
  act({ moveTop: { n: { var: '$s' }, to: 'shield', who: who === 'self' ? 'controller' : 'opponent', cause: 'addShield' } }),
];

export const DECK_F: CardDef[] = [
  // 1. Vチャロン(無色)
  card(
    'dm26sd1-F01',
    creature('Vチャロン', 7, '', 8000, ['ジョーカーズ'], [
      wBreaker(),
      cip([
        {
          op: 'modes',
          pick: 1,
          options: [
            { label: '自分', steps: vChalon('self') },
            { label: '相手', steps: vChalon('opponent') },
          ],
        },
      ]),
    ]),
  ),

  // 2. 異端流し オニカマス
  card(
    'dm26sd1-F02',
    creature('異端流し オニカマス', 2, 'W', 2000, ['ムートピア'], [
      staticAb({ type: 'cannotBeChosen' }),
      trig(
        { on: { type: 'entered', owner: 'opponent', notVia: 'summon' }, subject: 'any', turn: 'opponent' },
        [act({ move: { sel: '$ev.card', to: 'hand', cause: 'bounce' } })],
        { optional: true, label: '相手が召喚以外で出したクリーチャーを手札に戻す' },
      ),
    ]),
  ),

  // 3. 終止の時計 ザ・ミュート(S・トリガー・プラス)
  card(
    'dm26sd1-F03',
    creature('終止の時計 ザ・ミュート', 3, 'W', 3000, ['マジック・アウトレイジMAX'], [
      sTrigger(),
      cip([act({ playerEffect: { mod: { kind: 'cannotAttackAny' }, until: 'endOfTurn' } })], {
        label: 'P: このターン、相手はクリーチャーで攻撃できない',
        ifAtResolve: and({ stUsed: true }, { turnOf: 'opponent' }, { logged: { pattern: { type: 'shieldBroken', owner: 'self' }, min: 2 } }),
      }),
      cip([maybe([draw(2), select('$d', { zone: 'hand', owner: 'self' }, { prompt: '捨てる手札を選んでください' }), act({ move: { sel: '$d', to: 'grave', cause: 'discard' } })], 'カードを2枚引き、手札を1枚捨てますか?')]),
    ]),
  ),

  // 4. 斬隠蒼頭龍バイケン
  card(
    'dm26sd1-F04',
    creature('斬隠蒼頭龍バイケン', 6, 'W', 6000, ['ポセイディア・ドラゴン', 'シノビ'], [
      wBreaker(),
      {
        kind: 'replace',
        label: '相手のターンに手札から捨てられる時、墓地に置くかわりに出す',
        optional: true,
        match: { type: 'moved', from: 'hand', cause: 'discard', turn: 'opponent' },
        apply: {
          type: 'steps',
          steps: [
            act({ put: { sel: '$self' } }),
            maybe([select('$b', { zone: 'battle', owner: 'any', type: 'creature', chooseable: true }), bounce('$b')], 'クリーチャーを1体、持ち主の手札に戻しますか?'),
          ],
        },
      },
      trig({ on: { type: 'ninjaStrike', owner: 'self' }, subject: 'any' }, [draw(1)], { optional: true, label: 'ニンジャ・ストライクを使った時、カードを1枚引く' }),
    ]),
  ),

  // 5. 特攻人形ジェニー
  card(
    'dm26sd1-F05',
    creature('特攻人形ジェニー', 2, 'D', 1000, [DEATHPUPPET], [
      cip([maybe([destroy('$self'), ...oppDiscardRandom()], 'このクリーチャーを破壊して、相手の手札を1枚捨てさせますか?')]),
    ]),
  ),

  // 6. 解体人形ジェニー
  card(
    'dm26sd1-F06',
    creature('解体人形ジェニー', 4, 'D', 1000, [DEATHPUPPET], [
      cip([select('$d', { zone: 'hand', owner: 'opponent' }, { prompt: '相手の手札を見て、捨てさせる1枚を選んでください' }), act({ move: { sel: '$d', to: 'grave', cause: 'discard' } })]),
    ]),
  ),

  // 7. カレイコの黒像(タマシード)
  card(
    'dm26sd1-F07',
    tamaseed('カレイコの黒像', 3, 'D', ['オラクル', 'レクスターズ'], [
      shinkalize(),
      {
        kind: 'replace',
        label: '山札から手札以外のゾーンに置かれる時、かわりに墓地に置く',
        match: { type: 'move', from: 'deck', notTo: 'hand', owner: 'any' },
        apply: { type: 'changeDest', to: 'grave' },
      },
    ]),
  ),

  // 8. 冥土人形ヴァミリア・バレル(超化獣)
  card(
    'dm26sd1-F08',
    creature('冥土人形ヴァミリア・バレル', 3, 'WD', 3000, [DEATHPUPPET, '超化獣'], [
      blocker(),
      cip([
        select('$e', { zone: 'battle', owner: 'opponent', type: 'element', chooseable: true }, { prompt: '持ち主の手札に戻す相手のエレメントを選んでください' }),
        bounce('$e'),
        ...oppDiscardRandom(),
      ]),
      hyperize(1),
      // ハイパーモード 6000
      staticAb({ type: 'powerAdd', n: 3000 }, hyperMode),
      breaker(2, hyperMode),
      trig(
        { on: { type: 'moved', to: 'hand', cause: 'draw', owner: 'opponent' }, subject: 'any', nthMin: 2, if: hyperMode },
        [select('$h', { zone: 'hand', owner: 'opponent' }, { who: 'opponent', prompt: '捨てる手札を選んでください' }), act({ move: { sel: '$h', to: 'grave', cause: 'discard' } })],
        { label: 'ハイパーモード: 相手が2枚目以降のカードを引いた時、相手は手札を1枚捨てる' },
      ),
    ]),
  ),

  // 9. 龍后人形メアリー・ジェニー
  card(
    'dm26sd1-F09',
    creature('龍后人形メアリー・ジェニー', 5, 'WD', 6000, [DEATHPUPPET, 'ドラゴンの花嫁'], [
      justDiver(),
      wBreaker(),
      staticAb({ type: 'grantKeyword', keyword: 'blocker', cond: race(DEATHPUPPET) }),
      cip([
        maybe([act({ moveTop: { n: 2, to: 'grave', cause: 'trash' } })], '山札の上から2枚を墓地に置きますか?'),
        selectUpTo('$c', { zone: 'grave', owner: 'self', type: 'creature', where: and(race(DEATHPUPPET), costLte(4), notEvolution) }, 1, { prompt: '墓地から出すコスト4以下のデスパペットを選んでください(出さなくてもよい)' }),
        act({ put: { sel: '$c' } }),
      ]),
      trig(
        { on: { type: 'moved', from: 'battle', owner: 'self', cond: race(DEATHPUPPET) }, subject: 'any', lookBack: true },
        [
          maybe([draw(1)], 'カードを1枚引きますか?'),
          select('$h', { zone: 'hand', owner: 'opponent' }, { who: 'opponent', prompt: '捨てる手札を選んでください' }),
          act({ move: { sel: '$h', to: 'grave', cause: 'discard' } }),
        ],
        { label: '自分のデスパペットが離れた時' },
      ),
    ]),
  ),
];
