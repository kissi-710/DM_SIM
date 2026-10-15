// jsdom のコンポーネントテスト用: toBeInTheDocument などの DOM のマッチャを足す(Testing Library の jest-dom)
import '@testing-library/jest-dom/vitest';

// jsdom には、レイアウトを持つ API(scrollIntoView・ResizeObserver)がない。画面が呼ぶものだけ、何もしない実装を足す
if (typeof Element !== 'undefined') {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
}
