// 効果によるバトル・バトル時の無限パワー・タップして出る・召喚封じ・「パワーが自身より小さい」条件を試すための、テスト用のカード。
// テスト(tests/engine/effect-battle.test.ts)で使う。実在のカード(革命5cザーディ)の能力と同じ原始操作を、小さなカードで固定する。
import type { CardDef } from '../../src/engine/types';

function card(id: string, name: string, abilities: any[], o: Partial<{ cost: number; power: number; civs: string[]; races: string[] }> = {}): CardDef {
  return {
    id,
    name,
    faces: [{ name, type: 'creature', cost: o.cost ?? 1, civs: o.civs ?? ['nature'], power: o.power ?? 1000, races: o.races ?? [], abilities }],
  } as unknown as CardDef;
}

const opponentCreature = { zone: 'battle', owner: 'opponent', type: 'creature', chooseable: true };

export const BATTLE_TEST_CARDS: CardDef[] = [
  // 出た時、相手のクリーチャーを1体選んでバトルする(強制)
  card(
    'tb-fighter',
    'Tバトラー',
    [
      {
        kind: 'trigger',
        label: 'T:出た時バトル',
        spec: { on: { type: 'entered' }, subject: 'self' },
        steps: [
          { op: 'select', as: '$t', from: opponentCreature, min: 1, max: 1 },
          { op: 'act', act: { battle: { a: '$self', b: '$t' } } },
        ],
      },
    ],
    { power: 3000 },
  ),
  // バトル中のパワーが無限
  card('tb-inf', 'T無限', [{ kind: 'static', mod: { type: 'infinitePowerInBattle' } }], { power: 1000 }),
  card('tb-slayer', 'Tスレイヤー', [{ kind: 'keyword', name: 'slayer' }], { power: 500 }),
  card('tb-big', 'T大型', [], { power: 9000, cost: 7 }),
  card('tb-mid', 'T中型', [], { power: 5000, cost: 5 }),
  card('tb-small', 'T小型', [], { power: 1000, cost: 1 }),
  // 相手の踏み倒し(コストを支払わずに出た)を見て、それとバトルしてもよい
  card(
    'tb-watch',
    'T踏み倒し監視',
    [
      {
        kind: 'trigger',
        optional: true,
        label: 'T:踏み倒しにバトル',
        spec: { on: { type: 'entered', owner: 'opponent', paid: 0 }, subject: 'any' },
        steps: [{ op: 'act', act: { battle: { a: '$self', b: '$eventCard' } } }],
      },
    ],
    { power: 9000 },
  ),
  // 自分の多色クリーチャーが出た時(各ターン1回)
  card('tb-multi', 'T多色監視', [
    {
      kind: 'trigger',
      label: 'T:多色が出た',
      spec: { on: { type: 'entered', owner: 'self', attackerCond: { multicolor: true } }, subject: 'any', limit: { perTurn: 1 } },
      steps: [{ op: 'act', act: { setVar: { as: '$x', value: 'multi' } } }],
    },
  ]),
  card('tb-two', 'T二色', [], { cost: 2, civs: ['fire', 'nature'], power: 2000 }),
  card('tb-fire', 'T火', [], { civs: ['fire'] }),
  // 相手の、自分のマナの枚数よりコストが小さいクリーチャーは、タップして出る
  card('tb-tapin', 'Tタップイン', [
    { kind: 'static', mod: { type: 'entersTapped', cond: { cost: { lt: { count: { zone: 'mana', owner: 'self' } } } } } },
  ]),
  // 出た時、次の、相手のターンの終わりまで、相手はコスト4以下のクリーチャーを召喚できない
  card('tb-lock', 'T召喚封じ', [
    {
      kind: 'trigger',
      label: 'T:召喚封じ',
      spec: { on: { type: 'entered' }, subject: 'self' },
      steps: [{ op: 'act', act: { playerEffect: { mod: { kind: 'cannotSummon', maxCost: 4 }, until: 'nextOpponentTurnEnd' } } }],
    },
  ]),
  // 出た時、自身よりパワーが小さいクリーチャーをすべて持ち主のマナゾーンに置く
  card(
    'tb-sweep',
    'T一掃',
    [
      {
        kind: 'trigger',
        label: 'T:一掃',
        spec: { on: { type: 'entered' }, subject: 'self' },
        steps: [
          {
            op: 'act',
            act: { move: { sel: { zone: 'battle', owner: 'any', type: 'creature', where: { powerLtSelf: true } }, to: 'mana', cause: 'manaPlace' } },
          },
        ],
      },
    ],
    { power: 6000 },
  ),
  // ニンジャ・ストライク3(相手の攻撃またはブロックの時、マナが3枚以上なら、手札から無料で召喚。ターンの終わりに山札の下)
  card('tn-ninja', 'Tシノビ', [{ kind: 'keyword', name: 'ninjaStrike', n: 3 }], { cost: 6, power: 2000, civs: ['water'], races: ['シノビ'] }),
  // G城(実行すると表向きのシールドになる)。表向きでシールドに置かれた時、山札の上1枚をタップしてマナに置く。表向きの間、相手の召喚以外の出現をマナに置換
  {
    id: 'tc-castle',
    name: 'T城',
    faces: [
      {
        name: 'T城',
        type: 'castle',
        cost: 3,
        civs: ['nature'],
        abilities: [
          {
            kind: 'trigger',
            label: 'T:城が置かれた時',
            spec: { on: { type: 'moved', to: 'shield', up: true }, subject: 'self', watch: ['shield'] },
            steps: [{ op: 'act', act: { moveTop: { n: 1, to: 'mana', cause: 'boost', tapped: true } } }],
          },
          { kind: 'static', mod: { type: 'nonSummonEntryToMana' } },
        ],
      },
    ],
  } as unknown as CardDef,
];
