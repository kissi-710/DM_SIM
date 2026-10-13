// L0 ランダムAI: 合法手から一様に選ぶ。エンジンの健全性テストと基準線に使う。
import type { Agent } from './types';

export const randomAgent: Agent = {
  name: 'ランダム',
  needsView: false,
  chooseAction(_view, legal, ctx) {
    return legal[Math.floor(ctx.rand() * legal.length)];
  },
};
