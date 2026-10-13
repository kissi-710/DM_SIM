// カードごとのファズテスト: 各カードを、ランダムな盤面のランダムなゾーンに置き、ランダムに最後まで(または上限まで)進める。
// どの手順でも「例外が出ない・不変条件が保たれる・合法手が尽きない」ことを確かめる。失敗時はシードを表示するので再現できる。
import { describe, expect, it } from 'vitest';
import { CARD_LIST } from '../../src/cards';
import { legalActions, step } from '../../src/engine/engine';
import { checkInvariants } from '../../src/engine/invariants';
import { mulberry } from '../../src/sim/playGame';
import { buildState, reg, type Setup } from '../scenario';

const POOL = CARD_LIST.map((c) => c.id).filter((id) => id !== 'dummy' && id !== '?');
const ZONES = ['hand', 'mana', 'battle', 'grave', 'shield', 'deck'] as const;
type Zone = (typeof ZONES)[number];

const isCreature = (id: string) => reg.defs[id].faces.some((f) => f.type !== 'spell');

function randomSetup(rand: () => number, must: string, mustZone: Zone, mustPlayer: 0 | 1): Setup {
  const pick = () => POOL[Math.floor(rand() * POOL.length)];
  const n = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const side = (p: 0 | 1) => {
    const hand = Array.from({ length: n(0, 6) }, pick);
    const mana = Array.from({ length: n(0, 11) }, pick).map((c) => ({ c, tapped: rand() < 0.3 }));
    const battle = Array.from({ length: n(0, 4) }, pick)
      .filter(isCreature)
      .map((c) => ({ c, tapped: rand() < 0.4, sick: rand() < 0.3 }));
    const grave = Array.from({ length: n(0, 5) }, pick);
    const shield: string[] = Array.from({ length: n(0, 5) }, () => (rand() < 0.5 ? pick() : 'dummy'));
    const deck: string[] = Array.from({ length: n(8, 22) }, () => (rand() < 0.4 ? pick() : 'dummy'));
    return { hand, mana, battle, grave, shield, deck } as any;
  };
  const setup: Setup = {
    p0: side(0),
    p1: side(1),
    active: 0,
    step: (['mana', 'main', 'main', 'attack'] as const)[Math.floor(rand() * 4)],
    turn: n(1, 12) * 2 - 1,
    seed: Math.floor(rand() * 1e9),
  };
  const z = (setup as any)[mustPlayer === 0 ? 'p0' : 'p1'];
  if (mustZone === 'battle' && !isCreature(must)) mustZone = 'hand';
  if (mustZone === 'battle') z.battle.push({ c: must, tapped: rand() < 0.4, sick: false });
  else if (mustZone === 'mana') z.mana.push({ c: must, tapped: false });
  else z[mustZone].push(must);
  return setup;
}

function run(seed: number, must: string, zone: Zone, player: 0 | 1, maxSteps = 160): { steps: number; over: boolean } {
  const rand = mulberry(seed);
  const setup = randomSetup(rand, must, zone, player);
  let s = buildState(setup, reg);
  const errs0 = checkInvariants(s);
  if (errs0.length) throw new Error(`初期状態が不正 seed=${seed}: ${errs0.join(' / ')}`);
  let steps = 0;
  while (s.winner === null && steps < maxSteps) {
    const legal = legalActions(s, reg);
    if (legal.length === 0) throw new Error(`合法手がありません seed=${seed} ${must}@${zone}/${player} step=${steps} pending=${JSON.stringify(s.pending)}`);
    const a = legal[Math.floor(rand() * legal.length)];
    try {
      s = step(s, a, reg).state;
    } catch (e: any) {
      throw new Error(`例外 seed=${seed} ${must}@${zone}/${player} step=${steps} action=${JSON.stringify(a)}: ${e?.message ?? e}`);
    }
    const errs = checkInvariants(s);
    if (errs.length) throw new Error(`不変条件違反 seed=${seed} ${must}@${zone}/${player} step=${steps} action=${JSON.stringify(a)}: ${errs.join(' / ')}`);
    steps++;
  }
  return { steps, over: s.winner !== null };
}

describe('カードごとのファズ(ランダムな盤面・ランダムな手)', () => {
  for (const id of POOL) {
    const name = reg.defs[id].name;
    it(`${name}: どのゾーンに置いても、ランダムに進めて破綻しない`, () => {
      let total = 0;
      for (let i = 0; i < ZONES.length * 2; i++) {
        const zone = ZONES[i % ZONES.length];
        const player = (Math.floor(i / ZONES.length) % 2) as 0 | 1;
        const r = run(1000 * (POOL.indexOf(id) + 1) + i, id, zone, player);
        total += r.steps;
      }
      expect(total).toBeGreaterThan(0);
    });
  }

  it('同じシードなら、同じ結果(再現性)', () => {
    const a = run(424242, 'dm24rp4-S02', 'hand', 0);
    const b = run(424242, 'dm24rp4-S02', 'hand', 0);
    expect(a).toEqual(b);
  });

  it('全カード混在の盤面を、多数のシードで最後まで進める(広域ファズ)', () => {
    let finished = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const id = POOL[seed % POOL.length];
      const r = run(900000 + seed, id, ZONES[seed % ZONES.length], (seed % 2) as 0 | 1, 250);
      if (r.over) finished++;
    }
    // 打ち切りだけでなく、決着まで進むものがある(進行が止まっていない)
    expect(finished).toBeGreaterThan(10);
  });
});
