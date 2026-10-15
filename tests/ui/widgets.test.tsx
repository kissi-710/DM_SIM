// @vitest-environment jsdom
// 入力ウィジェット7種・ErrorBoundary のコンポーネントテスト(Testing Library)
import { cleanup, render, screen, within } from '@testing-library/react';
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
    await user.click(screen.getByRole('button', { name: /2\. 出た時: ブースト/ }));
    expect(onAnswer).toHaveBeenCalledWith(12);
  });
});

describe('InputWidget: option', () => {
  it('選択肢を選んで確定する(上から順に処理される)', async () => {
    const { onAnswer, user } = setup({ shape: 'option', options: ['ドローする', 'ブーストする', '破壊する'], pick: 2, repeat: false, allIf: false });
    const confirm = screen.getByRole('button', { name: '確定' });
    expect(confirm).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /3\. 破壊する/ }));
    await user.click(screen.getByRole('button', { name: /1\. ドローする/ }));
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
    const b = screen.getByRole('button', { name: /2\. B/ });
    await user.click(b);
    await user.click(b);
    await user.click(screen.getByRole('button', { name: /1\. A/ }));
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
