// @vitest-environment jsdom
// 入力ウィジェット7種・ErrorBoundary のコンポーネントテスト(Testing Library)
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deckCards } from '../../src/cards';
import { createGame } from '../../src/engine/engine';
import type { AnswerValue, GameState, InputSpec, Pending } from '../../src/engine/types';
import { ErrorBoundary } from '../../src/ui/ErrorBoundary';
import { InputWidget } from '../../src/ui/Widgets';
import { reg } from '../scenario';

afterEach(cleanup);

const game = (): GameState => createGame(reg, { decks: [deckCards('maruru'), deckCards('zardy')], seed: 5, first: 0 }).state;
const nameOf = (s: GameState, u: number) => reg.defs[s.cards[u].defId].name;

function pend(input: InputSpec, over: Partial<Pending> = {}): Pending {
  return { id: 7, player: 0, why: 'select', input, prompt: '選んでください', ...over } as Pending;
}

function setup(input: InputSpec, over: Partial<Pending> = {}) {
  const s = game();
  const onAnswer = vi.fn<(v: AnswerValue) => void>();
  const view = render(<InputWidget s={s} pending={pend(input, over)} me={0} onAnswer={onAnswer} />);
  return { s, onAnswer, ...view, user: userEvent.setup() };
}

describe('InputWidget: pick', () => {
  it('1枚だけ選ぶ時は、候補をクリックした時点で回答する', async () => {
    const s0 = game();
    const [a, b] = s0.players[0].hand;
    const { onAnswer, user } = setup({ shape: 'pick', candidates: [a, b], min: 1, max: 1 });
    await user.click(screen.getByRole('button', { name: nameOf(s0, b) }));
    expect(onAnswer).toHaveBeenCalledWith([b]);
  });
  it('複数枚を選ぶ時は、選んで「確定」するまで回答しない。上限を超えて選べない', async () => {
    const s0 = game();
    const [a, b, c] = s0.players[0].hand;
    const { onAnswer, user } = setup({ shape: 'pick', candidates: [a, b, c], min: 1, max: 2 });
    const confirm = screen.getByRole('button', { name: '確定' });
    expect(confirm).toBeDisabled();
    const cards = screen.getAllByRole('button').filter((x) => x.classList.contains('card'));
    await user.click(cards[0]);
    await user.click(cards[1]);
    await user.click(cards[2]); // 上限 2 枚を超える分は無視される
    expect(onAnswer).not.toHaveBeenCalled();
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onAnswer).toHaveBeenCalledWith([a, b]);
  });
  it('0枚から選べる時は「選ばない」で空の回答になる', async () => {
    const s0 = game();
    const [a] = s0.players[0].hand;
    const { onAnswer, user } = setup({ shape: 'pick', candidates: [a], min: 0, max: 1 });
    await user.click(screen.getByRole('button', { name: /選ばない/ }));
    expect(onAnswer).toHaveBeenCalledWith([]);
  });
  it('相手が選ぶ場面では、「相手の選択」と表示する', () => {
    const s0 = game();
    const [a] = s0.players[0].hand;
    setup({ shape: 'pick', candidates: [a], min: 1, max: 1 }, { player: 1 });
    expect(screen.getByText(/相手の選択/)).toBeInTheDocument();
  });
});

describe('InputWidget: yesno / ack / order', () => {
  it('はい・いいえ', async () => {
    const { onAnswer, user } = setup({ shape: 'yesno' });
    await user.click(screen.getByRole('button', { name: 'はい' }));
    await user.click(screen.getByRole('button', { name: 'いいえ' }));
    expect(onAnswer.mock.calls).toEqual([[true], [false]]);
  });
  it('公開した札の確認は「確認した」で true を返す', async () => {
    const s0 = game();
    const { onAnswer, user } = setup({ shape: 'ack', shown: [s0.players[0].hand[0]] });
    await user.click(screen.getByRole('button', { name: '確認した' }));
    expect(onAnswer).toHaveBeenCalledWith(true);
  });
  it('同時に誘発した能力は、選んだものの ID を返す', async () => {
    const { onAnswer, user } = setup({ shape: 'order', candidates: [11, 12], labels: ['出た時: ドロー', '出た時: ブースト'] });
    await user.click(screen.getByRole('button', { name: /^出た時: ブースト/ }));
    expect(onAnswer).toHaveBeenCalledWith(12);
  });
});

describe('InputWidget: option', () => {
  it('選択肢を選んで確定する(上から順に処理される)', async () => {
    const { onAnswer, user } = setup({ shape: 'option', options: ['ドローする', 'ブーストする', '破壊する'], pick: 2, repeat: false, allIf: false });
    const confirm = screen.getByRole('button', { name: '確定' });
    expect(confirm).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /^破壊する/ }));
    await user.click(screen.getByRole('button', { name: /^ドローする/ }));
    await user.click(confirm);
    expect(onAnswer).toHaveBeenCalledWith([2, 0]);
  });
  it('「すべて1回ずつ使う」(allIf)', async () => {
    const { onAnswer, user } = setup({ shape: 'option', options: ['A', 'B', 'C'], pick: 1, repeat: false, allIf: true });
    await user.click(screen.getByRole('button', { name: /すべて1回ずつ使う/ }));
    expect(onAnswer).toHaveBeenCalledWith([0, 1, 2]);
  });
  it('同じものを何度でも選べる設定では、回数が増える', async () => {
    const { onAnswer, user } = setup({ shape: 'option', options: ['A', 'B'], pick: 3, repeat: true, allIf: false });
    const b = screen.getByRole('button', { name: /^B/ });
    await user.click(b);
    await user.click(b);
    await user.click(screen.getByRole('button', { name: /^A/ }));
    await user.click(screen.getByRole('button', { name: '確定' }));
    expect(onAnswer).toHaveBeenCalledWith([1, 1, 0]);
  });
});

describe('InputWidget: payment / assign', () => {
  it('払うマナを必要な枚数だけ選ぶと確定できる', async () => {
    const s0 = game();
    const mana = s0.players[0].hand.slice(0, 3);
    const { onAnswer, user } = setup({ shape: 'payment', mana, need: 2 });
    const confirm = screen.getByRole('button', { name: '確定' });
    expect(confirm).toBeDisabled();
    const cards = screen.getAllByRole('button').filter((x) => x.classList.contains('card'));
    await user.click(cards[2]);
    await user.click(cards[0]);
    expect(confirm).toBeEnabled();
    await user.click(cards[1]); // 必要な枚数を超える分は選べない
    await user.click(confirm);
    expect(onAnswer).toHaveBeenCalledWith([mana[2], mana[0]]);
  });
  it('札を枠に割り振る: 「自動で振る」で先頭から詰めて確定できる', async () => {
    const s0 = game();
    const items = s0.players[0].hand.slice(0, 3);
    const { onAnswer, user } = setup({
      shape: 'assign',
      items,
      slots: [
        { id: 'hand', label: '手札に加える', count: 1, to: 'hand' },
        { id: 'mana', label: 'マナゾーンに置く', count: 2, to: 'mana' },
      ],
    } as InputSpec);
    expect(screen.getByRole('button', { name: '確定' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /自動で振る/ }));
    await user.click(screen.getByRole('button', { name: '確定' }));
    expect(onAnswer).toHaveBeenCalledWith({ hand: [items[0]], mana: [items[1], items[2]] });
  });
  it('札を選んで、枠をクリックして割り振れる', async () => {
    const s0 = game();
    const items = s0.players[0].hand.slice(0, 2);
    const { onAnswer, user, container } = setup({
      shape: 'assign',
      items,
      slots: [{ id: 'a', label: '枠A', count: 2, to: 'hand' }],
    } as InputSpec);
    const slot = container.querySelector('[data-drop="slot:a"]') as HTMLElement;
    for (const u of items) {
      await user.click(screen.getByRole('button', { name: nameOf(s0, u) }));
      await user.click(slot);
    }
    expect(within(slot).getByText(/枠A\(2\/2\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '確定' }));
    expect(onAnswer).toHaveBeenCalledWith({ a: items });
  });
});

describe('ErrorBoundary', () => {
  function Boom(): never {
    throw new Error('描画中の例外');
  }

  it('子が例外を投げたら、メッセージとメニューへ戻る操作を出す', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onReset = vi.fn();
    render(
      <ErrorBoundary onReset={onReset}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('画面の表示中にエラーが起きました');
    expect(screen.getByText('描画中の例外')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'メニューへ' }));
    expect(onReset).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
  it('例外がなければ、子をそのまま表示する', () => {
    render(
      <ErrorBoundary onReset={() => {}}>
        <p>正常な画面</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('正常な画面')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('InputWidget: キーボード操作の部品', () => {
  it('0〜1枚を選ぶ質問(ブロックなど)は、カードをクリックした時点で回答する。「選ばない」はキー N', async () => {
    const s0 = game();
    const [a, b] = s0.players[0].hand;
    const { onAnswer, user } = setup({ shape: 'pick', candidates: [a, b], min: 0, max: 1 });
    expect(screen.getByRole('button', { name: /選ばない/ })).toHaveAttribute('data-key', 'n');
    await user.click(screen.getAllByRole('button').filter((x) => x.classList.contains('card'))[1]);
    expect(onAnswer).toHaveBeenCalledWith([b]);
  });
  it('候補のカードには、数字キーの番号が出る', () => {
    const s0 = game();
    const [a, b, c] = s0.players[0].hand;
    setup({ shape: 'pick', candidates: [a, b, c], min: 1, max: 2 });
    expect([...document.querySelectorAll('.num-badge')].map((x) => x.textContent)).toEqual(['1', '2', '3']);
  });
  it('複数枚を選ぶ質問は、選んだあとで「選び直す」(R)ができる', async () => {
    const s0 = game();
    const [a, b] = s0.players[0].hand;
    const { user } = setup({ shape: 'pick', candidates: [a, b], min: 1, max: 2 });
    expect(screen.queryByRole('button', { name: /選び直す/ })).toBeNull();
    await user.click(screen.getAllByRole('button').filter((x) => x.classList.contains('card'))[0]);
    const redo = screen.getByRole('button', { name: /選び直す/ });
    expect(redo).toHaveAttribute('data-key', 'r');
    await user.click(redo);
    expect(screen.getByRole('button', { name: '確定' })).toBeDisabled();
  });
  it('はい・いいえは Y / N のキーを持つ(Esc の「いいえ」は N のボタンを押す)', () => {
    setup({ shape: 'yesno' });
    expect(screen.getByRole('button', { name: 'はい' })).toHaveAttribute('data-key', 'y');
    expect(screen.getByRole('button', { name: 'いいえ' })).toHaveAttribute('data-key', 'n');
  });
  it('割り振り: 札は数字キー(click の detail が 0)で選び、枠は Q W E で入れられる', async () => {
    const s0 = game();
    const [a, b] = s0.players[0].hand;
    const { onAnswer, user } = setup({
      shape: 'assign',
      items: [a, b],
      slots: [
        { id: 'x', to: 'hand', label: 'X', count: 1 },
        { id: 'y', to: 'grave', label: 'Y', count: 1 },
      ],
    });
    const slots = [...document.querySelectorAll<HTMLElement>('.slot')];
    expect(slots.map((x) => x.getAttribute('data-key'))).toEqual(['q', 'w']);
    const items = () => [...document.querySelectorAll<HTMLElement>('.cards.items .card')];
    // キーボードの番号キーは el.click()(detail 0)で届く
    fireEvent.click(items()[0]);
    fireEvent.click(slots[0]);
    fireEvent.click(items()[0]);
    fireEvent.click(slots[1]);
    await user.click(screen.getByRole('button', { name: '確定' }));
    expect(onAnswer).toHaveBeenCalledWith({ x: [a], y: [b] });
  });
});

describe('InputWidget: 候補の詳細を読んでから選ぶ', () => {
  it('カーソルのある候補には印が付き、data-uid で詳細に結び付けられる', () => {
    const s0 = game();
    const [a, b] = s0.players[0].hand;
    render(<InputWidget s={s0} pending={pend({ shape: 'pick', candidates: [a, b], min: 1, max: 1 })} me={0} cursor={1} onAnswer={() => {}} />);
    const cards = [...document.querySelectorAll<HTMLElement>('.cards .card')];
    expect(cards.map((c) => c.classList.contains('cursor'))).toEqual([false, true]);
    expect(cards.map((c) => c.getAttribute('data-uid'))).toEqual([String(a), String(b)]);
  });
  it('ホバーできない端末(タッチ)では、1回目のタップで詳細を出し、2回目で決める', async () => {
    const orig = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('hover: none'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      const s0 = game();
      const [a, b] = s0.players[0].hand;
      const onAnswer = vi.fn<(v: AnswerValue) => void>();
      const onHover = vi.fn();
      render(<InputWidget s={s0} pending={pend({ shape: 'pick', candidates: [a, b], min: 1, max: 1 })} me={0} onHover={onHover} onAnswer={onAnswer} />);
      const user = userEvent.setup();
      const card = screen.getAllByRole('button').filter((x) => x.classList.contains('card'))[0];
      await user.click(card);
      expect(onAnswer).not.toHaveBeenCalled();
      expect(onHover).toHaveBeenCalledWith(a);
      await user.click(card);
      expect(onAnswer).toHaveBeenCalledWith([a]);
    } finally {
      window.matchMedia = orig;
    }
  });
});
