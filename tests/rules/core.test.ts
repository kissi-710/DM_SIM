import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../../src/cards';
import { createGame, legalActions } from '../../src/engine/engine';
import { Sim, mana, reg } from '../scenario';

describe('ゲーム開始(spec 3.2)', () => {
  it('シールド5枚・手札5枚で始まり、先攻の1ターン目はドローしない', () => {
    const { state } = createGame(CARD_DB, { decks: [deckCards('maruru'), deckCards('zardy')], seed: 3, first: 0 });
    expect(state.players[0].shield.length).toBe(5);
    expect(state.players[0].hand.length).toBe(5);
    expect(state.players[0].deck.length).toBe(30);
    expect(state.active).toBe(0);
    expect(state.step).toBe('mana');
  });
  it('後攻の最初のターンはドローする', () => {
    const { state } = createGame(CARD_DB, { decks: [deckCards('maruru'), deckCards('zardy')], seed: 3, first: 0 });
    const sim = new Sim({});
    sim.s = state;
    sim.skipMana().endTurn();
    expect(sim.s.active).toBe(1);
    expect(sim.s.players[1].hand.length).toBe(6);
  });
  it('構築制限: 40枚・同名4枚まで(対戦モード)', () => {
    const deck = deckCards('maruru').slice(0, 39);
    expect(() => createGame(CARD_DB, { decks: [deck, deckCards('zardy')], seed: 1, strict: true })).toThrow();
    const five = Array(40).fill('dmrp01-093');
    expect(() => createGame(CARD_DB, { decks: [five, deckCards('zardy')], seed: 1, strict: true })).toThrow();
    expect(() => createGame(CARD_DB, { decks: [five, deckCards('zardy')], seed: 1, strict: false })).not.toThrow();
  });
});

describe('マナとコスト(spec 3.3・3.4)', () => {
  it('マナチャージは1ターン1枚で、多色カードはタップ状態で置かれる', () => {
    const sim = new Sim({ step: 'mana', p0: { hand: ['天災 デドダム', 'フェアリー・ライフ'] } });
    sim.charge('天災 デドダム');
    expect(sim.s.manaCharged).toBe(true);
    expect(sim.tappedMana(0)).toBe(1);
    expect(sim.legal().some((a) => a.type === 'CHARGE_MANA')).toBe(false);
  });
  it('コストの数値ぶんのマナが必要(払えないと使えない)', () => {
    const sim = new Sim({ p0: { hand: ['ヨビニオン・マルル'], mana: mana(3) } });
    expect(sim.canPlay('ヨビニオン・マルル')).toBe(false);
    const sim2 = new Sim({ p0: { hand: ['ヨビニオン・マルル'], mana: mana(4) } });
    expect(sim2.canPlay('ヨビニオン・マルル')).toBe(true);
  });
  it('文明を満たすマナが必要(自然のマナだけでは闇のカードは使えない)', () => {
    const sim = new Sim({ p0: { hand: ['ティンパニ=シンバリー'], mana: mana(4) } });
    expect(sim.canPlay('ティンパニ=シンバリー')).toBe(false);
    const sim2 = new Sim({ p0: { hand: ['ティンパニ=シンバリー'], mana: [...mana(3), 'ロスト・Re:ソウル'] } });
    expect(sim2.canPlay('ティンパニ=シンバリー')).toBe(true);
  });
  it('多色カードは各文明のマナを1枚ずつ含めて払う。多色のマナ1枚は1文明としてしか数えない', () => {
    // デドダム(水闇自然・コスト3): 自然のマナ3枚だけでは水・闇を満たせない
    const sim = new Sim({ p0: { hand: ['天災 デドダム'], mana: mana(3) } });
    expect(sim.canPlay('天災 デドダム')).toBe(false);
    // 水・闇・自然の単色マナが1枚ずつあれば使える
    const sim2 = new Sim({ p0: { hand: ['天災 デドダム'], mana: ['アクアン', 'ロスト・Re:ソウル', 'フェアリー・ライフ'] } });
    expect(sim2.canPlay('天災 デドダム')).toBe(true);
    // 多色のマナ3枚なら、1枚ずつ別の文明として数えて満たせる
    const sim3 = new Sim({ p0: { hand: ['天災 デドダム'], mana: ['天災 デドダム', '天災 デドダム', '天災 デドダム'] } });
    expect(sim3.canPlay('天災 デドダム')).toBe(true);
    // 多色のマナ1枚+自然2枚では、1枚の多色マナが水と闇を同時には満たせない
    const sim4 = new Sim({ p0: { hand: ['天災 デドダム'], mana: ['天災 デドダム', 'フェアリー・ライフ', 'フェアリー・ライフ'] } });
    expect(sim4.canPlay('天災 デドダム')).toBe(false);
  });
  it('支払うとマナがタップされる', () => {
    const sim = new Sim({ p0: { hand: ['ヨビニオン・マルル'], mana: mana(5) } });
    sim.play('ヨビニオン・マルル');
    if (sim.s.pending?.why === 'may') sim.no(); // ヨビニオンの任意効果
    expect(sim.tappedMana(0)).toBe(4);
    expect(sim.has(0, 'battle', 'ヨビニオン・マルル')).toBe(true);
  });
});

describe('攻撃とバトル(spec 3.6・3.7)', () => {
  it('召喚酔いのクリーチャーは攻撃できない', () => {
    const sim = new Sim({ p0: { battle: [{ c: 'ヨビニオン・マルル', sick: true }] } });
    expect(sim.legal().some((a) => a.type === 'ATTACK')).toBe(false);
  });
  it('スピードアタッカーは出たターンから攻撃できる', () => {
    const sim = new Sim({ p0: { battle: [{ c: '王道の革命 ドギラゴン', sick: true }] } });
    expect(sim.legal().some((a) => a.type === 'ATTACK' && a.target.kind === 'player')).toBe(true);
  });
  it('アンタップ状態のクリーチャーは攻撃できない(タップ状態のみ)', () => {
    const sim = new Sim({ p0: { battle: ['ヨビニオン・マルル'] }, p1: { battle: ['ティンパニ=シンバリー'] } });
    const atk = sim.legal().filter((a) => a.type === 'ATTACK');
    expect(atk.some((a) => a.type === 'ATTACK' && a.target.kind === 'creature')).toBe(false);
    expect(atk.some((a) => a.type === 'ATTACK' && a.target.kind === 'player')).toBe(true);
  });
  it('パワーが高い方が勝ち、低い方は破壊される', () => {
    const sim = new Sim({
      p0: { battle: ['ヨビニオン・マルル'] },
      p1: { battle: [{ c: 'ティンパニ=シンバリー', tapped: true }], shield: 5 },
    });
    sim.attack('ヨビニオン・マルル', 'ティンパニ=シンバリー');
    expect(sim.has(1, 'grave', 'ティンパニ=シンバリー')).toBe(true);
    expect(sim.has(0, 'battle', 'ヨビニオン・マルル')).toBe(true);
  });
  it('同じパワーなら両方破壊される(相打ち)。トライブの身代わりはマナゾーン', () => {
    const sim = new Sim({
      p0: { battle: ['ヨビニオン・トライブ'] },
      p1: { battle: [{ c: 'ティンパニ=シンバリー', tapped: true }] },
    });
    sim.attack('ヨビニオン・トライブ', 'ティンパニ=シンバリー');
    expect(sim.has(1, 'grave', 'ティンパニ=シンバリー')).toBe(true);
    expect(sim.has(0, 'battle', 'ヨビニオン・トライブ')).toBe(false);
    expect(sim.has(0, 'mana', 'ヨビニオン・トライブ')).toBe(true);
  });
  it('プレイヤー攻撃: シールドが1枚割られて手札に加わる', () => {
    const sim = new Sim({ p0: { battle: ['ヨビニオン・マルル'] }, p1: { shield: 5 } });
    sim.attack('ヨビニオン・マルル', 'player');
    expect(sim.count(1, 'shield')).toBe(4);
    expect(sim.count(1, 'hand')).toBe(1);
  });
  it('W・ブレイカーは2枚、T・ブレイカーは3枚割る', () => {
    const w = new Sim({ p0: { battle: ['流星のガイアッシュ・カイザー'] }, p1: { shield: 5 } });
    w.attack('流星のガイアッシュ・カイザー', 'player');
    expect(w.count(1, 'shield')).toBe(3);
    const t = new Sim({ p0: { battle: ['終末縫合王 ザ=キラー・キーナリー'] }, p1: { shield: 5 } });
    t.attack('終末縫合王 ザ=キラー・キーナリー', 'player');
    expect(t.count(1, 'shield')).toBe(2);
  });
  it('シールドが足りない時は残りをすべて割る。割り切った攻撃では勝てない', () => {
    const sim = new Sim({ p0: { battle: ['流星のガイアッシュ・カイザー'] }, p1: { shield: 1 } });
    sim.attack('流星のガイアッシュ・カイザー', 'player');
    expect(sim.count(1, 'shield')).toBe(0);
    expect(sim.s.winner).toBeNull();
  });
  it('シールドが0枚の相手プレイヤーへの攻撃が成立すると勝利する(ダイレクトアタック)', () => {
    const sim = new Sim({ p0: { battle: ['ヨビニオン・マルル'] }, p1: { shield: 0 } });
    sim.attack('ヨビニオン・マルル', 'player');
    expect(sim.s.winner).toBe(0);
  });
  it('ブロッカーは攻撃対象を自分に変えられる', () => {
    const sim = new Sim({ p0: { battle: ['ヨビニオン・マルル'] }, p1: { battle: ['ティンパニ=シンバリー'], shield: 5 } });
    sim.attack('ヨビニオン・マルル', 'player');
    expect(sim.pending.why).toBe('block');
    sim.pick('ティンパニ=シンバリー');
    expect(sim.count(1, 'shield')).toBe(5);
    expect(sim.has(1, 'grave', 'ティンパニ=シンバリー')).toBe(true); // 5000 vs 4000
  });
  it('ブロックしない選択もできる', () => {
    const sim = new Sim({ p0: { battle: ['ヨビニオン・マルル'] }, p1: { battle: ['ティンパニ=シンバリー'], shield: 5 } });
    sim.attack('ヨビニオン・マルル', 'player');
    sim.none();
    expect(sim.count(1, 'shield')).toBe(4);
  });
  it('マッハファイターは出たターンに相手のクリーチャーを(アンタップでも)攻撃できるが、プレイヤーは攻撃できない', () => {
    const sim = new Sim({
      p0: { battle: [{ c: '九番龍 ジゴクバンカー', sick: true }] },
      p1: { battle: ['ティンパニ=シンバリー'] },
    });
    const atk = sim.legal().filter((a) => a.type === 'ATTACK');
    expect(atk.some((a) => a.type === 'ATTACK' && a.target.kind === 'creature')).toBe(true);
    expect(atk.some((a) => a.type === 'ATTACK' && a.target.kind === 'player')).toBe(false);
  });
});

describe('S・トリガー(spec 3.8)', () => {
  it('ブレイクされたシールドのS・トリガーを宣言して使える', () => {
    const sim = new Sim({
      p0: { battle: ['終末の監視者 ジ・ウォッチ'] },
      p1: { shield: ['フェアリー・ライフ', 'ダミー'], deck: 10 },
    });
    sim.attack('終末の監視者 ジ・ウォッチ', 'player');
    // ジ・ウォッチの攻撃時能力: 戻すクリーチャーを0体選ぶ
    expect(sim.pending.why).toBe('select');
    sim.none();
    expect(sim.pending.why).toBe('triggerDeclare');
    sim.pick('フェアリー・ライフ');
    expect(sim.count(1, 'mana')).toBe(1); // 呪文の効果: ブースト
    expect(sim.has(1, 'grave', 'フェアリー・ライフ')).toBe(true);
  });
  it('宣言しなければ、そのまま手札に加わる', () => {
    const sim = new Sim({
      p0: { battle: ['終末の監視者 ジ・ウォッチ'] },
      p1: { shield: ['フェアリー・ライフ', 'ダミー'], deck: 10 },
    });
    sim.attack('終末の監視者 ジ・ウォッチ', 'player');
    sim.none(); // 攻撃時能力
    sim.none(); // 宣言しない
    expect(sim.has(1, 'hand', 'フェアリー・ライフ')).toBe(true);
    expect(sim.count(1, 'mana')).toBe(0);
  });
});

describe('勝敗・山札', () => {
  it('山札が0枚になったプレイヤーは敗北する', () => {
    const sim = new Sim({ active: 0, step: 'main', p0: { deck: 0 }, p1: { deck: 5 } });
    sim.endTurn();
    expect(sim.s.winner).toBe(1);
  });
});

describe('合法手と検証', () => {
  it('不正な行動は例外になる', () => {
    const sim = new Sim({ p0: { hand: ['ヨビニオン・マルル'], mana: mana(1) } });
    expect(() => sim.play('ヨビニオン・マルル')).toThrow();
  });
  it('legalActions は pending の本人の回答だけを返す', () => {
    const sim = new Sim({ p0: { battle: ['ヨビニオン・マルル'] }, p1: { battle: ['ティンパニ=シンバリー'] } });
    sim.attack('ヨビニオン・マルル', 'player');
    expect(sim.pending.player).toBe(1);
    expect(legalActions(sim.s, reg).every((a) => a.type === 'ANSWER')).toBe(true);
  });
});
