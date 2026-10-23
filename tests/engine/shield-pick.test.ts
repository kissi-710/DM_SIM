// ブレイクするシールドの選択(docs/effects.md 第10章 B0)。
// 裏向きのシールドは見分けがつかないので、従来どおり無作為に割る(質問しない)。
// 見分けのつくシールド(EXライフ)がある時だけ、攻撃側がどれを割るかを選ぶ。
import { describe, expect, it } from 'vitest';
import { chooseShieldPick } from '../../src/ai/shieldPick';
import { shieldClasses, shieldPickChoices } from '../../src/engine/procs';
import { validateAnswer } from '../../src/engine/legal';
import { Sim, reg } from '../scenario';

const KEENARI = '終末縫合王 ザ=キラー・キーナリー'; // T・ブレイカー・EXライフ
const ZARDI = '龍風混成 ザーディクリカ'; // W・ブレイカー・EXライフ
const MARURU = 'ヨビニオン・マルル'; // 攻撃役(ブレイカーなし = 1枚)

const exOf = (sim: Sim, p: 0 | 1) => sim.s.players[p].shield.filter((u) => sim.s.cards[u].ex);

describe('ブレイクするシールドの選択', () => {
  it('見分けのつくシールドがなければ、質問せずに無作為に割る(従来どおり)', () => {
    const sim = new Sim({ p0: { battle: [MARURU] }, p1: { shield: 5 } });
    sim.attack(MARURU, 'player');
    expect(sim.s.pending?.why).not.toBe('pickShield');
    expect(sim.count(1, 'shield')).toBe(4);
  });

  it('EXライフのシールドがあると、攻撃側が割るシールドを選ぶ', () => {
    const sim = new Sim({ p0: { battle: [MARURU] }, p1: { battle: [{ c: ZARDI, ex: true }], shield: 4 } });
    sim.attack(MARURU, 'player');
    const p = sim.pending;
    expect(p.why).toBe('pickShield');
    expect(p.player).toBe(0); // 選ぶのは攻撃側
    expect(p.input).toMatchObject({ shape: 'pick', min: 1, max: 1 });
    expect((p.input as { candidates: number[] }).candidates.length).toBe(5);
  });

  it('EXライフのシールドを選んで割れる(身代わりを失う)', () => {
    const sim = new Sim({ p0: { battle: [MARURU] }, p1: { battle: [{ c: ZARDI, ex: true }], shield: 4 } });
    sim.attack(MARURU, 'player');
    const ex = exOf(sim, 1)[0];
    sim.answer([ex]);
    sim.drain();
    expect(sim.s.cards[ex].zone).toBe('hand');
    expect(sim.count(1, 'shield')).toBe(4);
    expect(exOf(sim, 1).length).toBe(0);
  });

  it('EXライフのシールドを避けて、通常のシールドを割れる(EXが残る)', () => {
    const sim = new Sim({ p0: { battle: [MARURU] }, p1: { battle: [{ c: ZARDI, ex: true }], shield: 4 } });
    sim.attack(MARURU, 'player');
    const ex = exOf(sim, 1)[0];
    const plain = (sim.pending.input as { candidates: number[] }).candidates.find((u) => u !== ex)!;
    sim.answer([plain]);
    sim.drain();
    expect(sim.s.cards[plain].zone).toBe('hand');
    expect(sim.s.cards[ex].zone).toBe('shield');
    expect(sim.count(1, 'shield')).toBe(4);
  });

  it('割る枚数がシールドの枚数以上なら、選ぶ余地がないので質問しない', () => {
    const sim = new Sim({ p0: { battle: [KEENARI] }, p1: { battle: [{ c: ZARDI, ex: true }], shield: 1 } });
    sim.attack(KEENARI, 'player'); // T・ブレイカー: シールド2枚(通常1 + EX 1)は全部割れる
    expect(sim.s.pending?.why).not.toBe('pickShield');
    expect(sim.count(1, 'shield')).toBe(0);
  });

  it('割る枚数と違う数、候補にない札は答えにできない。候補の中なら好きな組み合わせを選べる', () => {
    const sim = new Sim({ p0: { battle: [KEENARI] }, p1: { battle: [{ c: ZARDI, ex: true }], shield: 4 } });
    sim.attack(KEENARI, 'player');
    const p = sim.pending;
    expect(p.input).toMatchObject({ min: 3, max: 3 });
    const cands = (p.input as { candidates: number[] }).candidates;
    expect(validateAnswer(p, cands.slice(0, 2))).not.toBeNull();
    expect(validateAnswer(p, [cands[0], cands[1], 9999])).not.toBeNull();
    expect(validateAnswer(p, [cands[4], cands[2], cands[0]])).toBeNull();
  });

  it('合法手は、見分けのつく違いごとに1つ(通常のシールドの選び方は数えない)', () => {
    const sim = new Sim({ p0: { battle: [KEENARI] }, p1: { battle: [{ c: ZARDI, ex: true }], shield: 4 } });
    sim.attack(KEENARI, 'player');
    const ex = exOf(sim, 1)[0];
    const legal = sim.legal();
    // 3枚を割る: EXを含まない(通常3) / EXを含む(EX + 通常2)の2通り
    expect(legal.length).toBe(2);
    const withEx = legal.map((a) => (a.type === 'ANSWER' ? (a.value as number[]).includes(ex) : false));
    expect(withEx.sort()).toEqual([false, true]);
  });

  it('EXライフのシールドが2枚あれば、どちらを割るかも違いになる', () => {
    const sim = new Sim({ p0: { battle: [MARURU] }, p1: { battle: [{ c: ZARDI, ex: true }, { c: KEENARI, ex: true }], shield: 3 } });
    sim.attack(MARURU, 'player');
    // 1枚を割る: 通常 / EX(ザーディクリカ) / EX(キーナリー) の3通り
    expect(sim.legal().length).toBe(3);
  });

  it('ルールベースAIは、EXライフのシールドを割って、身代わりを奪う', () => {
    const sim = new Sim({ p0: { battle: [KEENARI] }, p1: { battle: [{ c: ZARDI, ex: true }], shield: 4 } });
    sim.attack(KEENARI, 'player');
    const ex = exOf(sim, 1)[0];
    const a = chooseShieldPick(sim.s, sim.legal(), reg);
    expect(a.type === 'ANSWER' && (a.value as number[]).includes(ex)).toBe(true);
  });

  it('シールドの組分け: 裏向きは1組、EXライフは紐づくクリーチャーごと', () => {
    const sim = new Sim({ p0: { battle: [MARURU] }, p1: { battle: [{ c: ZARDI, ex: true }, { c: KEENARI, ex: true }], shield: 3 } });
    const sh = sim.s.players[1].shield;
    expect(shieldClasses(sim.s, sh).map((g) => g.length).sort()).toEqual([1, 1, 3]);
    expect(shieldPickChoices(sim.s, sh, 5).length).toBe(1);
    expect(shieldPickChoices(sim.s, sh, 0)).toEqual([[]]);
  });
});
