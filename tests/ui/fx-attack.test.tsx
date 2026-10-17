// @vitest-environment jsdom
// 攻撃の演出(攻撃線・ブロック線・着弾): 判定の純粋関数 attackFxOf、FxAttack、ダイレクトアタックのバナー、CPU の待ち
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../../src/cards';
import { createGame } from '../../src/engine/engine';
import { loadRegistry } from '../../src/engine/registry';
import type { Ev } from '../../src/engine/types';
import { FxAttack } from '../../src/ui/FxAttack';
import { ATK_MS, attackFxMs, attackFxOf, cuesOf, FX_MS, fxHoldMs } from '../../src/ui/fx';

const reg = loadRegistry(CARD_DB);
afterEach(cleanup);

let id = 0;
const ev = (type: string, f: Record<string, unknown>): Ev => ({ id: ++id, causedBy: null, type, turn: 4, ...f }) as Ev;
const declared = (card: number, owner: number, target: unknown) => ev('attackDeclared', { card, attacker: 7, owner, target });

describe('attackFxOf(攻撃の演出の判定)', () => {
  it('シールドへの攻撃は、相手のシールドを狙う線(シールド)。ブレイクは着弾として遅れて出る', () => {
    const fx = attackFxOf([declared(11, 0, { kind: 'player' }), ev('shieldBroken', { card: 5, owner: 1, by: 7 }), ev('shieldBroken', { card: 6, owner: 1, by: 7 })]);
    expect(fx).toHaveLength(2);
    expect(fx[0]).toMatchObject({ kind: 'line', from: 'uid:11', to: 'zone:shield:1', tone: 'attack', label: 'シールド', shield: true, delay: 0 });
    // 同じ手で続けて割れたシールドは、1つの着弾にまとめる
    expect(fx[1]).toMatchObject({ kind: 'burst', at: 'zone:shield:1', tone: 'shield', n: 2, delay: ATK_MS.impact });
  });
  it('クリーチャーへの攻撃は、そのクリーチャーを狙う線(クリーチャー)。バトルの火花は相手の位置', () => {
    const fx = attackFxOf([declared(11, 1, { kind: 'creature', pid: 33 }), ev('battleEnded', { attacker: 7, defender: 33, winner: 7, draw: false })]);
    expect(fx[0]).toMatchObject({ kind: 'line', from: 'uid:11', to: 'pid:33', label: 'クリーチャー', shield: false });
    expect(fx[1]).toMatchObject({ kind: 'burst', at: 'pid:33', tone: 'clash', draw: false, delay: ATK_MS.impact });
    expect(attackFxOf([ev('battleEnded', { attacker: 7, defender: 33, winner: null, draw: true })])[0]).toMatchObject({ draw: true, delay: 0 });
  });
  it('ブロックされたら、ブロッカーから攻撃したクリーチャーへの緑の線が続き、着弾はそのあと', () => {
    const fx = attackFxOf([
      declared(11, 0, { kind: 'player' }),
      ev('blocked', { attacker: 7, attackerCard: 11, blocker: 40, card: 41, owner: 1 }),
      ev('battleEnded', { attacker: 7, defender: 40, winner: 7, draw: false }),
    ]);
    expect(fx.map((f) => f.kind)).toEqual(['line', 'line', 'burst']);
    expect(fx[1]).toMatchObject({ tone: 'block', from: 'pid:40', to: 'uid:11', delay: ATK_MS.impact });
    expect(fx[2]).toMatchObject({ at: 'pid:40', delay: ATK_MS.impact + ATK_MS.blockImpact });
  });
  it('ブロックの選択で手が分かれても、その手の中のものだけで組む(線はすぐ始まる)', () => {
    const fx = attackFxOf([ev('blocked', { attacker: 7, attackerCard: 11, blocker: 40, card: 41, owner: 1 })]);
    expect(fx).toHaveLength(1);
    expect(fx[0]).toMatchObject({ tone: 'block', delay: 0 });
  });
  it('ダイレクトアタックは、負けた側のシールドの位置の大きな着弾', () => {
    const fx = attackFxOf([declared(11, 0, { kind: 'player' }), ev('gameOver', { winner: 0, reason: 'ダイレクトアタック' })]);
    expect(fx[1]).toMatchObject({ kind: 'burst', tone: 'direct', at: 'zone:shield:1' });
    // 山札切れなどは出さない
    expect(attackFxOf([ev('gameOver', { winner: 0, reason: '山札切れ' })])).toEqual([]);
  });
  it('攻撃に関係のないイベントだけなら、何も作らない。長さは倍率で半分になる', () => {
    expect(attackFxOf([ev('moved', { card: 1, owner: 0, from: 'deck', to: 'hand', cause: 'draw' })])).toEqual([]);
    const fx = attackFxOf([declared(11, 0, { kind: 'player' }), ev('shieldBroken', { card: 5, owner: 1, by: 7 })]);
    expect(attackFxMs(fx, 1)).toBe(ATK_MS.impact + ATK_MS.burst);
    expect(attackFxMs(fx, 0.5)).toBe((ATK_MS.impact + ATK_MS.burst) / 2);
    expect(attackFxMs([], 1)).toBe(0);
  });
});

describe('ダイレクトアタックのバナーと CPU の待ち', () => {
  const s = createGame(reg, { decks: [deckCards('maruru'), deckCards('zardy')], seed: 7, first: 0 }).state;
  it('ダイレクトアタックで決まった時だけ、バナーを出す', () => {
    const cues = cuesOf(s, [ev('gameOver', { winner: 0, reason: 'ダイレクトアタック' })], 0);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ kind: 'direct', title: 'ダイレクトアタック!', sub: 'あなたの勝ち', ms: FX_MS.direct });
    expect(cuesOf(s, [ev('gameOver', { winner: 0, reason: '山札切れ' })], 0)).toEqual([]);
  });
  it('CPU の待ちに、攻撃の演出の長さが入る(高速は半分)', () => {
    const evs = [declared(11, 1, { kind: 'player' }), ev('shieldBroken', { card: 5, owner: 0, by: 7 })];
    const hold = fxHoldMs(s, evs, 0, 1);
    expect(hold).toBeGreaterThanOrEqual(ATK_MS.impact + ATK_MS.burst);
    expect(fxHoldMs(s, evs, 0, 0.5)).toBeLessThan(hold);
    expect(fxHoldMs(s, [], 0, 1)).toBe(0);
  });
});

describe('FxAttack', () => {
  const rect = (x: number, y: number, w = 60, h = 80) => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y, toJSON() {} }) as DOMRect;
  const board = () => {
    const b = document.createElement('div');
    b.className = 'board';
    const card = document.createElement('div');
    card.dataset.uid = '11';
    card.getBoundingClientRect = () => rect(100, 400);
    const shield = document.createElement('div');
    shield.dataset.zone = 'shield:1';
    shield.getBoundingClientRect = () => rect(300, 60, 90, 50);
    const pile = document.createElement('div');
    pile.dataset.drop = 'opp-pile:33';
    pile.getBoundingClientRect = () => rect(200, 150);
    b.append(card, shield, pile);
    document.body.append(b);
    return b;
  };

  it('シールドへの攻撃: 攻撃元から相手のシールドへ線を引き、「シールドへ攻撃」の札と、砕ける着弾を出す', () => {
    const b = board();
    const evs = [declared(11, 0, { kind: 'player' }), ev('shieldBroken', { card: 5, owner: 1, by: 7 })];
    const { container, rerender } = render(<FxAttack events={[]} token={0} enabled scale={1} />);
    rerender(<FxAttack events={evs} token={1} enabled scale={1} />);
    const core = container.querySelector('.fx-line-core')!;
    expect(core.getAttribute('x1')).toBe('130'); // 攻撃元の中心
    expect(core.getAttribute('y1')).toBe('440');
    expect(core.getAttribute('x2')).toBe('345'); // 相手のシールドの中心
    expect(core.getAttribute('y2')).toBe('85');
    expect(container.querySelector('.fx-line-tag')!.textContent).toBe('シールドへ攻撃');
    expect(container.querySelector('.fx-burst-shield')).not.toBeNull();
    expect(container.querySelectorAll('.fx-shard').length).toBeGreaterThan(6);
    b.remove();
  });
  it('クリーチャーへの攻撃: 相手のクリーチャーの位置を狙い、「クリーチャーへ攻撃」の札を出す', () => {
    const b = board();
    const { container, rerender } = render(<FxAttack events={[]} token={0} enabled scale={1} />);
    rerender(<FxAttack events={[declared(11, 0, { kind: 'creature', pid: 33 })]} token={1} enabled scale={1} />);
    const core = container.querySelector('.fx-line-core')!;
    expect(core.getAttribute('x2')).toBe('230');
    expect(core.getAttribute('y2')).toBe('190');
    expect(container.querySelector('.fx-line-tag')!.textContent).toBe('クリーチャーへ攻撃');
    b.remove();
  });
  it('高速は、遅れと長さが半分。無効なら何も描かない。同じ手では一度だけ', () => {
    const b = board();
    const evs = [declared(11, 0, { kind: 'player' }), ev('shieldBroken', { card: 5, owner: 1, by: 7 })];
    const fast = render(<FxAttack events={[]} token={0} enabled scale={0.5} />);
    fast.rerender(<FxAttack events={evs} token={1} enabled scale={0.5} />);
    fast.rerender(<FxAttack events={evs} token={1} enabled scale={0.5} />);
    expect(fast.container.querySelectorAll('.fx-line')).toHaveLength(1);
    expect(fast.container.querySelector<HTMLElement>('.fx-line')!.style.animationDuration).toBe(`${ATK_MS.line / 2}ms`);
    expect(fast.container.querySelector<HTMLElement>('.fx-burst')!.style.animationDelay).toBe(`${ATK_MS.impact / 2}ms`);
    fast.unmount();
    const off = render(<FxAttack events={[]} token={0} enabled={false} scale={0} />);
    off.rerender(<FxAttack events={evs} token={1} enabled={false} scale={0} />);
    expect(off.container.querySelector('.fx-atk')).toBeNull();
    b.remove();
  });
  it('位置が分からない(描かれていない)ものは出さず、時間がたてば消える', async () => {
    const b = board();
    const { container, rerender } = render(<FxAttack events={[]} token={0} enabled scale={0.02} />);
    rerender(<FxAttack events={[declared(999, 0, { kind: 'player' })]} token={1} enabled scale={0.02} />);
    expect(container.querySelector('.fx-line')).toBeNull();
    rerender(<FxAttack events={[declared(11, 0, { kind: 'player' })]} token={2} enabled scale={0.02} />);
    expect(container.querySelector('.fx-line')).not.toBeNull();
    await waitFor(() => expect(container.querySelector('.fx-atk')).toBeNull(), { timeout: 2000 });
    b.remove();
  });
});
