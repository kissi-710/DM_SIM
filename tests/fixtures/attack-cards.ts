// 攻撃まわりのイベント・手続き(バトルする時・バトルの後・ブレイクする前に・呪文の置換・使用宣言)を試すための、テスト用のカード。
// テスト(tests/rules/attack-events.test.ts)と、Rust 版の差分テスト用の正解データ(scripts/dump-fixtures.ts)で使う。
import type { CardDef } from '../../src/engine/types';

export const step = (label: string) => [{ op: 'act', act: { setVar: { as: '$x', value: label } } }];
const bounceOpponent = [
  { op: 'select', as: '$t', from: { zone: 'battle', owner: 'opponent', type: 'creature' }, min: 1, max: 1 },
  { op: 'act', act: { move: { sel: '$t', to: 'hand', cause: 'bounce' } } },
];

function card(id: string, name: string, abilities: any[], o: Partial<{ cost: number; power: number; spell: boolean }> = {}): CardDef {
  return {
    id,
    name,
    faces: [
      {
        name,
        type: o.spell ? 'spell' : 'creature',
        cost: o.cost ?? 1,
        civs: ['nature'],
        ...(o.spell ? {} : { power: o.power ?? 1000 }),
        races: [],
        abilities,
      },
    ],
  } as unknown as CardDef;
}

export const ATTACK_TEST_CARDS: CardDef[] = [
  // 「バトルする時」に、相手(攻撃クリーチャー)を手札に戻す。
  card('t-bs-bounce', 'Tバトル前バウンス', [
    { kind: 'trigger', label: 'T:バトルする時', spec: { on: { type: 'battleStarted', role: 'defender' }, subject: 'any' }, steps: bounceOpponent },
  ]),
  // 「バトルの後」に、印を残す(攻撃クリーチャーとして)
  card('t-after', 'Tバトル後', [
    { kind: 'trigger', label: 'T:バトルの後', spec: { on: { type: 'afterBattle', role: 'attacker' }, subject: 'any', watch: ['battle', 'grave'] }, steps: step('after') },
  ], { power: 5000 }),
  // 「相手がブレイクする前に」、攻撃クリーチャーを手札に戻す
  card('t-before-break', 'Tブレイク前バウンス', [
    { kind: 'trigger', label: 'T:ブレイクする前に', spec: { on: { type: 'beforeBreak', owner: 'opponent' }, subject: 'any' }, steps: bounceOpponent },
  ]),
  // 攻撃する時に、印を残す(攻撃クリーチャーとして)
  card('t-atk', 'T攻撃', [
    { kind: 'trigger', label: 'T:攻撃する時', spec: { on: { type: 'attackDeclared' }, subject: 'self' }, steps: step('attack') },
  ], { power: 3000 }),
  // 相手の攻撃宣言に、手札から宣言して使う(非ターン・プレイヤー側の使用宣言)
  card('t-ntp-declare', 'T宣言', [
    { kind: 'trigger', optional: true, label: 'T:相手の攻撃に宣言', spec: { on: { type: 'attackDeclared', owner: 'opponent' }, watch: ['hand'], subject: 'any' }, steps: step('declared') },
  ]),
  // 自分の攻撃宣言の時に、相手のクリーチャーすべてに「ブロックを強制する」を与える(507.1b)
  card('t-force', 'Tブロック強制', [
    {
      kind: 'trigger',
      label: 'T:ブロック強制',
      spec: { on: { type: 'attackDeclared', owner: 'self' }, subject: 'any' },
      steps: [
        { op: 'act', act: { addEffect: { sel: { zone: 'battle', owner: 'opponent', type: 'creature' }, mods: [{ kind: 'mustBlock' }], until: 'endOfTurn' } } },
      ],
    },
  ]),
  // 唱えた後、墓地のかわりにマナゾーンに置く(チャージャー)
  card('t-charger', 'Tチャージャー', [
    { kind: 'spell', steps: [] },
    { kind: 'replace', label: '墓地に置くかわりにマナゾーンに置く', match: { type: 'moved', cause: 'cast' }, apply: { type: 'changeDest', to: 'mana' } },
  ], { spell: true }),
];

