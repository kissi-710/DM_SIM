// @vitest-environment jsdom
// 入力ウィジェット7種・ErrorBoundary のコンポーネントテスト(Testing Library)
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deckCards } from '../../src/cards';
import { createGame } from '../../src/engine/engine';
import type { AnswerValue, GameState, InputSpec, Pending } from '../../src/engine/types';
import { ErrorBoundary } from '../../src/ui/ErrorBoundary';
import { AUTO_CONFIRM_MS, InputWidget, PaymentWidget } from '../../src/ui/Widgets';
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
  it('複数枚を選ぶ時は、上限(max)まで選ぶと、確定ボタンを押さなくても回答する。上限を超えて選べない', async () => {
    const s0 = game();
    const [a, b, c] = s0.players[0].hand;
    const { onAnswer, user } = setup({ shape: 'pick', candidates: [a, b, c], min: 1, max: 2 });
    const cards = screen.getAllByRole('button').filter((x) => x.classList.contains('card'));
    await user.click(cards[0]);
    // まだ上限(2枚)に達していない間は、回答しない
    await new Promise((r) => setTimeout(r, AUTO_CONFIRM_MS + 80));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '確定' })).toBeEnabled(); // 1枚でも確定できる(min=1)
    await user.click(cards[1]);
    await user.click(cards[2]); // 上限 2 枚を超える分は無視される
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith([a, b]));
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });
  it('規定数に達した時に選び直せば、自動の回答は取り消される。手で確定したら、自動の回答は重ねて送られない', async () => {
    const s0 = game();
    const [a, b, c] = s0.players[0].hand;
    const { onAnswer, user } = setup({ shape: 'pick', candidates: [a, b, c], min: 1, max: 2 });
    const cards = screen.getAllByRole('button').filter((x) => x.classList.contains('card'));
    await user.click(cards[0]);
    await user.click(cards[1]);
    await user.click(cards[1]); // すぐ外す: 規定数でなくなり、自動の回答は出ない
    await new Promise((r) => setTimeout(r, AUTO_CONFIRM_MS + 80));
    expect(onAnswer).not.toHaveBeenCalled();
    await user.click(cards[2]);
    await user.click(screen.getByRole('button', { name: '確定' })); // 規定数に達した直後に手で確定
    await new Promise((r) => setTimeout(r, AUTO_CONFIRM_MS + 80));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith([a, c]);
  });
  it('ちょうど N 枚を選ぶ時(min=max=N)は、N 枚目で自動で回答する。1枚だけの時は、これまで通りクリックで回答', async () => {
    const s0 = game();
    const [a, b, c] = s0.players[0].hand;
    const { onAnswer, user } = setup({ shape: 'pick', candidates: [a, b, c], min: 2, max: 2 });
    const cards = screen.getAllByRole('button').filter((x) => x.classList.contains('card'));
    await user.click(cards[2]);
    expect(onAnswer).not.toHaveBeenCalled();
    await user.click(cards[0]);
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith([c, a]));
  });
  describe('ドラッグでまとめて選ぶ', () => {
    /** jsdom には座標がないので、ポインタの下にある札を、ドラッグの経路の指定で決める */
    const dragOver = (down: HTMLElement, path: HTMLElement[]) => {
      let cur: HTMLElement = down;
      const doc = document as unknown as { elementFromPoint?: (x: number, y: number) => Element | null };
      doc.elementFromPoint = () => cur; // jsdom には elementFromPoint がない
      fireEvent.pointerDown(down, { button: 0, pointerType: 'mouse', clientX: 1, clientY: 1 });
      for (const el of path) {
        cur = el;
        fireEvent.pointerMove(window, { clientX: 2, clientY: 2 });
      }
      fireEvent.pointerUp(window);
      delete doc.elementFromPoint;
    };
    it('札をなぞると、なぞった札をすべて選ぶ(規定数に達したら自動で回答)', async () => {
      const s0 = game();
      const [a, b, c, d] = s0.players[0].hand;
      const { onAnswer, container } = setup({ shape: 'pick', candidates: [a, b, c, d], min: 3, max: 3 });
      const cards = [...container.querySelectorAll<HTMLElement>('.card')];
      expect(container.querySelector('[data-dragpick]')).not.toBeNull();
      dragOver(cards[0], [cards[1], cards[2]]);
      expect(cards.slice(0, 3).every((el) => el.classList.contains('selected'))).toBe(true);
      expect(cards[3].classList.contains('selected')).toBe(false);
      await waitFor(() => expect(onAnswer).toHaveBeenCalledWith([a, b, c]));
    });
    it('ドラッグの後に続くクリックで、選び直しにならない。上限を超えて選べない', async () => {
      const s0 = game();
      const [a, b, c, d] = s0.players[0].hand;
      const { onAnswer, container } = setup({ shape: 'pick', candidates: [a, b, c, d], min: 1, max: 3 });
      const cards = [...container.querySelectorAll<HTMLElement>('.card')];
      dragOver(cards[0], [cards[1], cards[2], cards[3]]); // 4枚なぞっても、3枚まで
      fireEvent.click(cards[3]); // ドラッグの直後のクリックは無視
      expect(cards.filter((el) => el.classList.contains('selected'))).toHaveLength(3);
      await waitFor(() => expect(onAnswer).toHaveBeenCalledWith([a, b, c]));
    });
    it('選択済みの札から始めてなぞると、なぞった札を外す(消しゴム)', async () => {
      const s0 = game();
      const [a, b, c, d] = s0.players[0].hand;
      const { onAnswer, container } = setup({ shape: 'pick', candidates: [a, b, c, d], min: 0, max: 4 });
      const cards = [...container.querySelectorAll<HTMLElement>('.card')];
      dragOver(cards[0], [cards[1], cards[2]]);
      expect(cards.filter((el) => el.classList.contains('selected'))).toHaveLength(3);
      dragOver(cards[1], [cards[2]]);
      expect(cards.filter((el) => el.classList.contains('selected')).length).toBe(1);
      expect(onAnswer).not.toHaveBeenCalled();
    });
    it('1枚だけ選ぶ質問では、ドラッグ選択を有効にしない', () => {
      const s0 = game();
      const [a, b] = s0.players[0].hand;
      const { container } = setup({ shape: 'pick', candidates: [a, b], min: 1, max: 1 });
      expect(container.querySelector('[data-dragpick]')).toBeNull();
    });
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

describe('InputWidget: 規定数で自動確定(option / payment)', () => {
  it('option: 2回以上選べる時は、規定の回数に達したら確定ボタンなしで回答する。1回だけの時は、確定ボタンを使う', async () => {
    const { onAnswer, user } = setup({ shape: 'option', options: ['ドロー', '破壊', 'マナ'], pick: 2, repeat: false } as InputSpec);
    await user.click(screen.getByRole('button', { name: /ドロー/ }));
    await new Promise((r) => setTimeout(r, AUTO_CONFIRM_MS + 80));
    expect(onAnswer).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /マナ/ }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith([0, 2]));
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });
  it('option: 1つだけ選ぶ時は、選んだだけでは回答しない(確定で回答)', async () => {
    const { onAnswer, user } = setup({ shape: 'option', options: ['ドロー', '破壊'], pick: 1, repeat: false } as InputSpec);
    await user.click(screen.getByRole('button', { name: /破壊/ }));
    await new Promise((r) => setTimeout(r, AUTO_CONFIRM_MS + 80));
    expect(onAnswer).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '確定' }));
    expect(onAnswer).toHaveBeenCalledWith([1]);
  });
  it('payment: 自動の候補が最初から選ばれている間は回答しない。選び直して規定数になったら自動で回答する', async () => {
    const s0 = game();
    const mana = s0.players[0].hand.slice(0, 4);
    const onAnswer = vi.fn<(v: AnswerValue) => void>();
    const user = userEvent.setup();
    const { container } = render(
      <PaymentWidget s={s0} pending={pend({ shape: 'payment', need: 2, mana } as InputSpec)} me={0} spec={{ shape: 'payment', need: 2, mana }} onAnswer={onAnswer} initial={[mana[0], mana[1]]} />,
    );
    await new Promise((r) => setTimeout(r, AUTO_CONFIRM_MS + 80));
    expect(onAnswer).not.toHaveBeenCalled(); // 初期選択だけでは回答しない
    const cards = [...container.querySelectorAll<HTMLElement>('.card')];
    await user.click(cards[1]); // 外す
    await user.click(cards[3]); // 別のマナを選ぶ: 2枚に戻る
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith([mana[0], mana[3]]));
  });
});
