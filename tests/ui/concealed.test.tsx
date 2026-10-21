// @vitest-environment jsdom
// 非公開のカード: シールドは本人にも見えないので、質問の選択肢に出ても裏向きのまま選ぶ(ジャオウガの「シールドを3枚残す」など)
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardDetail } from '../../src/ui/GameView';
import { isConcealed } from '../../src/ui/format';
import { InputWidget } from '../../src/ui/Widgets';
import { mana, Sim } from '../scenario';

afterEach(cleanup);

const N = 'フェアリー・ライフ';
const W = 'アクアン';
const D = 'ロスト・Re:ソウル';

const jaouga = () => {
  const sim = new Sim({ p0: { hand: ['CRYMAX ジャオウガ'], mana: mana(7, D), shield: [W, D, N, N, W] }, p1: { shield: [N, W, D, N, W] } });
  sim.play('CRYMAX ジャオウガ');
  return sim;
};

describe('isConcealed', () => {
  it('シールドゾーンのカードは非公開。手札・場・墓地は公開', () => {
    const sim = jaouga();
    for (const u of sim.s.players[0].shield) expect(isConcealed(sim.s, u)).toBe(true);
    for (const u of sim.s.players[0].hand) expect(isConcealed(sim.s, u)).toBe(false);
    expect(isConcealed(sim.s, sim.s.players[0].battle[0].cards[0])).toBe(false);
  });
  it('表向きのシールド(G城)は公開。割るシールドの選択でも、見分けがつく', () => {
    const sim = new Sim({ p0: { battle: [{ c: W, sick: false }] }, p1: { shield: ['ハッスル・キャッスル', N, N, N] } });
    const castle = sim.uid(1, 'shield', 'ハッスル・キャッスル');
    sim.s.cards[castle].up = true;
    expect(isConcealed(sim.s, castle)).toBe(false);
    for (const u of sim.s.players[1].shield) if (u !== castle) expect(isConcealed(sim.s, u)).toBe(true);
  });
  it('ブレイクされて手札に加わる途中のカード(S・トリガーの宣言)は、持ち主に見える', () => {
    const sim = new Sim({ p0: { battle: ['終末縫合王 ザ=キラー・キーナリー'] }, p1: { shield: [N], deck: ['ティンパニ=シンバリー', 'ダミー'] } });
    sim.attack('終末縫合王 ザ=キラー・キーナリー', 'player');
    expect(sim.pending.why).toBe('triggerDeclare');
    const cands = (sim.pending.input as { candidates: number[] }).candidates;
    expect(cands.every((u) => !isConcealed(sim.s, u))).toBe(true);
  });
});

describe('ジャオウガ: シールドを裏向きのまま選ぶ', () => {
  it('選択肢のシールドは、すべて裏向きで表示され、名前が出ない', () => {
    const sim = jaouga();
    expect(sim.pending.player).toBe(0);
    const { container } = render(<InputWidget s={sim.s} pending={sim.pending} me={0} onAnswer={() => {}} />);
    const cards = container.querySelectorAll('.card');
    expect(cards.length).toBe(5);
    for (const c of cards) {
      expect(c.classList.contains('back')).toBe(true);
      expect(c.getAttribute('aria-label')).toBe('裏向きのカード');
    }
    expect(container.textContent).not.toContain('アクアン');
    expect(container.textContent).not.toContain('フェアリー・ライフ');
    expect(container.textContent).not.toContain('ロスト・Re:ソウル');
  });
  it('裏向きのまま3枚選んで答えられる。ホバーしても詳細は出ない', async () => {
    const sim = jaouga();
    const onAnswer = vi.fn();
    const onHover = vi.fn();
    const { container } = render(<InputWidget s={sim.s} pending={sim.pending} me={0} onHover={onHover} onAnswer={onAnswer} />);
    const user = userEvent.setup();
    const cards = [...container.querySelectorAll<HTMLElement>('.card')];
    await user.hover(cards[0]);
    expect(onHover).not.toHaveBeenCalledWith(expect.any(Number));
    for (const c of cards.slice(0, 3)) await user.click(c);
    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(1)); // 3枚で自動確定
    const sel = (sim.pending.input as { candidates: number[] }).candidates.slice(0, 3);
    expect(onAnswer.mock.calls[0][0].slice().sort()).toEqual(sel.slice().sort());
  });
  it('カード詳細も、非公開のシールドでは中身を出さない(「自分のシールドを見る」の時だけ見える)', () => {
    const sim = jaouga();
    const u = sim.s.players[0].shield[0];
    const hidden = render(<CardDetail s={sim.s} uid={u} />);
    expect(hidden.container.textContent).toBe('非公開のカード');
    hidden.unmount();
    const peek = render(<CardDetail s={sim.s} uid={u} reveal />);
    expect(peek.container.textContent).toContain('コスト');
    screen.getAllByText(/コスト/);
  });
});
