// 要確認ルール台帳(effects 15.2)の各項目の扱いを、テストで固定する。
import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../src/cards';
import { randomAgent } from '../src/ai/random';
import { createGame } from '../src/engine/engine';
import { checkInvariants } from '../src/engine/invariants';
import { pickNextCandidates } from '../src/engine/procs';
import { mkCtx } from '../src/engine/state';
import { RuleLoopError } from '../src/engine/types';
import { playGameSync } from '../src/sim/playGame';
import { Sim, mana, reg } from './scenario';

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const D = 'ロスト・Re:ソウル';

function entry(id: number, batch: number, controller: 0 | 1, stLayer = false) {
  return {
    id,
    batch,
    ability: { defId: 'dm23bd1-014', face: 0, idx: 0 },
    kind: (stLayer ? 'shieldTrigger' : 'ability') as 'ability' | 'shieldTrigger',
    source: { uid: 0, ep: 0 },
    lki: {} as any,
    controller,
    event: null,
    stLayer,
  };
}

describe('L1 同時誘発の新旧優先(WaitingPolicy)', () => {
  const setup = (policy: 'pool' | 'newFirst' | 'oldFirst') => {
    const sim = new Sim({ cfg: { waitingPolicy: policy } });
    sim.s.pool = [entry(1, 1, 0), entry(2, 2, 0), entry(3, 2, 1)];
    return pickNextCandidates(mkCtx(sim.s, reg));
  };
  it('既定: プール全体からターンプレイヤーの能力を選べる', () => {
    const r = setup('pool')!;
    expect(r.player).toBe(0);
    expect(r.entries.map((e) => e.id).sort()).toEqual([1, 2]);
  });
  it('newFirst: 新しい組の能力を先に解決する', () => {
    expect(setup('newFirst')!.entries.map((e) => e.id)).toEqual([2]);
  });
  it('oldFirst: 古い組の能力を先に解決する', () => {
    expect(setup('oldFirst')!.entries.map((e) => e.id)).toEqual([1]);
  });
  it('S・トリガーは最優先で、新しく待機した S・トリガーが先(101.4g)。ターンプレイヤー → 非ターンプレイヤー', () => {
    const sim = new Sim({});
    sim.s.pool = [entry(1, 1, 0), entry(2, 1, 1, true), entry(3, 2, 1, true), entry(4, 2, 0, true)];
    const r = pickNextCandidates(mkCtx(sim.s, reg))!;
    expect(r.entries.map((e) => e.id)).toEqual([4]); // 最新の組・ターンプレイヤー側
    sim.s.pool = [entry(1, 1, 0), entry(3, 2, 1, true)];
    const r2 = pickNextCandidates(mkCtx(sim.s, reg))!;
    expect(r2.player).toBe(1);
    expect(r2.entries.map((e) => e.id)).toEqual([3]); // 通常の能力よりS・トリガーが先
  });
});

describe('L2 状況起因処理のタイミング(sbaTiming)', () => {
  const run = (sbaTiming: 'afterEachStep' | 'afterEffect') => {
    const sim = new Sim({
      cfg: { sbaTiming },
      p0: { hand: ['絶望と反魂と滅殺の決断'], mana: mana(5, D) },
      p1: { battle: ['ティンパニ=シンバリー', 'ヨビニオン・マルル', 'ヨビニオン・トライブ'] },
    });
    sim.play('絶望と反魂と滅殺の決断');
    sim.option(2, 2); // パワー-4000 を2回
    sim.pick('ティンパニ=シンバリー'); // パワー0になる
    return (sim.pending.input as any).candidates.length;
  };
  it('効果の途中でも、パワー0のクリーチャーを先に破壊する(既定)', () => {
    expect(run('afterEachStep')).toBe(2);
  });
  it('afterEffect では、効果が終わるまで破壊を待つ', () => {
    expect(run('afterEffect')).toBe(3);
  });
});

describe('L3 進化時の引き継ぎ(総合ルール 801.2 で確認済み)', () => {
  it('タップ・召喚酔い・適用中の継続効果は、進化後も続く', () => {
    const sim = new Sim({
      p0: { hand: ['SSS級天災 デッドダムド'], mana: [W, W, W, D, D, N, N, N], battle: [{ c: '天災 デドダム', tapped: true, sick: true }] },
      p1: { battle: ['ヨビニオン・マルル'] },
    });
    const pid = sim.pid(0, '天災 デドダム');
    sim.s.effects.push({ id: 99, pid, mod: { kind: 'grant', keyword: 'blocker' }, until: { kind: 'endOfTurn', turn: sim.s.turn }, controller: 0 });
    sim.play('SSS級天災 デッドダムド', { extra: { onto: pid } });
    sim.option(0);
    const perm = sim.s.players[0].battle[0];
    expect(perm.tapped).toBe(true);
    expect(perm.sick).toBe(true);
    expect(sim.s.effects.filter((e) => e.pid === pid).length).toBe(1);
  });
});

describe('507.1a 攻撃されているクリーチャーはブロッカーにならない', () => {
  it('マッハファイターに攻撃された、アンタップ状態のブロッカーは、自分をブロックできない', () => {
    const sim = new Sim({
      p0: { battle: [{ c: '九番龍 ジゴクバンカー', sick: true }] },
      p1: { battle: ['ティンパニ=シンバリー'], shield: 5 },
    });
    sim.attack('九番龍 ジゴクバンカー', 'ティンパニ=シンバリー');
    // ブロック候補が自分だけなので、ブロックの質問は出ず、そのままバトルになる
    expect(sim.s.pending?.why).not.toBe('block');
    expect(sim.has(1, 'grave', 'ティンパニ=シンバリー')).toBe(true);
  });
});

describe('L4 オルゲイトのコピー(処理者・参照先)', () => {
  it('「このクリーチャー」は元のクリーチャーを指し、処理するのはオルゲイトの持ち主', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: ['魔誕の斬将オルゲイト'], deck: ['天災 デドダム', N, N, N, 'ダミー'] },
      p1: { hand: ['ヨビニオン・マルル'], mana: mana(4), deck: [N, N, N, 'ダミー'] },
    });
    sim.play('ヨビニオン・マルル');
    // マルルのヨビニオン(p1) → 続いてオルゲイト(p0)の確認
    while (sim.s.pending && sim.s.pending.why !== 'turnAction') {
      const p = sim.s.pending;
      if (p.why === 'may') sim.answer(p.player === 0);
      else if (p.why === 'pickNext') sim.order('ヨビニオン');
      else sim.drain();
    }
    // コスト4(元のマルル)より小さいクリーチャー: p0 の山札のデドダム(コスト3)が p0 の場に出る
    expect(sim.has(0, 'battle', '天災 デドダム')).toBe(true);
  });
});

describe('L5 カイザーの「マナをタップせずに」', () => {
  it('コスト軽減でも、文明のマナを1枚はタップするので該当しない(spec 3.4.1 M-4)', () => {
    const sim = new Sim({
      active: 1,
      p0: { hand: ['流星のガイアッシュ・カイザー'], deck: 5 },
      p1: { hand: ['九番龍 ジゴクバンカー'], mana: mana(12), deck: 5 },
    });
    sim.play('九番龍 ジゴクバンカー'); // シンパシーでコスト 12-12=0 → 文明の数(1)までしか下がらない
    sim.drain();
    const ev = sim.evs('entered').find((e) => e.owner === 1);
    expect(ev?.paid).toBe(1);
    expect(sim.tappedMana(1)).toBe(1);
    sim.endTurn();
    expect(sim.s.pending?.why).not.toBe('may');
  });
});

describe('L5 カイザーが召喚できるゾーン(公式テキスト・総合ルール 110.4d)', () => {
  it('実行できるゾーン(手札)にある時だけ働き、墓地やマナゾーンでは働かない', () => {
    for (const zone of ['grave', 'mana'] as const) {
      const sim = new Sim({
        active: 1,
        p0: zone === 'grave' ? { grave: ['流星のガイアッシュ・カイザー'], deck: 5 } : { mana: ['流星のガイアッシュ・カイザー'], deck: 5 },
        p1: { deck: 5 },
      });
      sim.s.turnLog.push({ id: 5, causedBy: null, type: 'entered', turn: sim.s.turn, owner: 1, paid: 0, kind: 'creature', card: 1, via: 'summon' } as any);
      sim.endTurn();
      expect(sim.s.pending?.why).toBe('turnAction'); // 確認の質問は出ない
      expect(sim.has(0, 'battle', '流星のガイアッシュ・カイザー')).toBe(false);
    }
  });
});

describe('L6 ジ・ウォッチの「ターンの残りをとばす」', () => {
  const setup = (skipRunsEndTriggers: boolean) => {
    const sim = new Sim({
      cfg: { skipRunsEndTriggers },
      p0: { battle: [{ c: '龍風混成 ザーディクリカ', ex: true }], hand: [N], mana: mana(3), deck: 5 },
      p1: { battle: ['ヨビニオン・マルル', '終末の監視者 ジ・ウォッチ'] },
    });
    sim.play(N); // ジ・ウォッチ(相手)が「呪文を唱えた時」に誘発
    return sim;
  };
  it('残りの手順はとばされるが、ターン終了時の誘発は起きる(既定)', () => {
    const sim = setup(true);
    sim.yes(); // ターンの残りをとばす
    expect(sim.has(1, 'grave', 'ヨビニオン・マルル')).toBe(true); // ザーディクリカのターン終了時の効果
    sim.drain(); // 「カードを引いてもよい」は引かない
    expect(sim.s.active).toBe(1);
  });
  it('設定でターン終了時の誘発を起こさないこともできる', () => {
    const sim = setup(false);
    sim.yes();
    expect(sim.has(1, 'battle', 'ヨビニオン・マルル')).toBe(true);
    expect(sim.s.active).toBe(1);
  });
  it('相手のターンでも使える(攻撃もとばされる)', () => {
    const sim = new Sim({
      active: 1,
      p0: { battle: ['終末の監視者 ジ・ウォッチ'] },
      p1: { hand: [N], mana: mana(2), battle: ['ヨビニオン・マルル'], deck: 5 },
    });
    sim.play(N);
    sim.yes();
    expect(sim.s.active).toBe(0);
    expect(sim.count(0, 'shield')).toBe(5);
  });
});

describe('L7 無限ループの扱い', () => {
  it('処理が上限を超えたら RuleLoopError にする', () => {
    expect(() =>
      createGame(CARD_DB, { decks: [deckCards('maruru'), deckCards('zardy')], seed: 1, first: 0, cfg: { maxFrameSteps: 2 } }),
    ).toThrow(RuleLoopError);
  });
});

describe('L9 山札切れの判定', () => {
  it('ドローで山札が0枚になった時点(状況起因処理)で敗北する', () => {
    const sim = new Sim({ active: 0, step: 'main', p0: { deck: 1 }, p1: { deck: 10 } });
    sim.endTurn(); // 相手のターン
    sim.skipMana().endTurn();
    // 自分のターンのドローで最後の1枚を引くと、山札が0枚になって敗北
    expect(sim.s.winner).toBe(1);
  });
  it('山札が0枚の時にドローしても何も起こらない(それだけでは負けない)', () => {
    const sim = new Sim({ p0: { hand: ['ワクムテラス'], mana: mana(4, W), deck: 0 }, p1: { deck: 10 } });
    // 山札0枚のまま、効果のドローは何も起こらない。SBAの判定は次のチェックポイント
    sim.play('ワクムテラス');
    expect(sim.count(0, 'hand')).toBe(0);
  });
});

describe('L10 同時に離れたクリーチャーの相互参照(lki)', () => {
  it('同時に破壊されたクリーチャーのイベントは、離れる前の情報(lki)を持つ', () => {
    const sim = new Sim({
      p0: { hand: ['聖魔連結王 ドルファディロム'], mana: ['ドラゴンズ・サイン', D, '王道の革命 ドギラゴン', N, N, N, N, N], deck: 5 },
      p1: { battle: ['ヨビニオン・マルル', 'ティンパニ=シンバリー'] },
    });
    sim.play('聖魔連結王 ドルファディロム');
    const moved = sim.evs('moved').filter((e) => e.from === 'battle' && e.cause === 'destroy');
    expect(moved.length).toBe(2);
    for (const e of moved) {
      expect(e.lki).toBeDefined();
      expect(e.lki.zone).toBe('battle');
    }
  });
});

describe('ルールの基本(台帳の補足)', () => {
  it('ターン上限に達すると引き分けとして記録される', () => {
    const r = playGameSync(CARD_DB, [randomAgent, randomAgent], {
      decks: [Array(40).fill('dmrp01-093'), Array(40).fill('dmrp01-093')],
      seed: 1,
      cfg: { turnLimit: 6 },
    });
    // 呪文だけのデッキで攻撃手段がなく、6ターンでは山札も尽きない → ターン上限で引き分け
    expect(r.winner).toBe('draw');
    expect(r.reason).toBe('ターン上限');
  });
  it('全イベントに causedBy があり、因果は過去のイベント・フレームを指す', () => {
    let n = 0;
    playGameSync(CARD_DB, [randomAgent, randomAgent], {
      decks: [deckCards('maruru'), deckCards('zardy')],
      seed: 42,
      onStep: (_s, _a, evs) => {
        for (const e of evs) {
          expect('causedBy' in e).toBe(true);
          if (e.causedBy !== null) expect(e.causedBy).toBeLessThan(e.id);
          n++;
        }
      },
    });
    expect(n).toBeGreaterThan(50);
  });
});

describe('スモークテスト(design 11 / spec 8)', () => {
  it('ランダムAI同士の2000試合が、例外なく完走し、不変条件が保たれる', () => {
    const t0 = Date.now();
    const combos: [string, string][] = [['maruru', 'zardy'], ['zardy', 'maruru'], ['maruru', 'maruru'], ['zardy', 'zardy']];
    let finished = 0;
    let turns = 0;
    for (let i = 0; i < 2000; i++) {
      const [a, b] = combos[i % 4];
      const r = playGameSync(CARD_DB, [randomAgent, randomAgent], { decks: [deckCards(a), deckCards(b)], seed: 1000 + i });
      expect(r.winner).not.toBeNull();
      if (i % 20 === 0) expect(checkInvariants(r.state)).toEqual([]);
      finished++;
      turns += r.turns;
    }
    const ms = Date.now() - t0;
    expect(finished).toBe(2000);
    // 性能(spec 8): 1試合あたり十数ms以内
    expect(ms / 2000).toBeLessThan(25);
    console.log(`2000試合 ${ms}ms(1試合 ${(ms / 2000).toFixed(2)}ms / 平均 ${(turns / 2000).toFixed(1)}ターン)`);
  }, 120000);
});
