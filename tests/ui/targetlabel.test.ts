// 攻撃先のラベル(同名クリーチャーを見分けられる)
import { describe, expect, it } from 'vitest';
import { targetLabel } from '../../src/ui/Board';
import { buildState } from '../scenario';

describe('targetLabel', () => {
  it('名前にパワーとタップ状態を添え、同名が並ぶ時は左から何体目かも添える', () => {
    const s = buildState({
      p1: { battle: ['ヨビニオン・トライブ', { c: 'ヨビニオン・トライブ', tapped: true }, '天災 デドダム'] },
    });
    const [a, b, c] = s.players[1].battle.map((x) => x.pid);
    expect(targetLabel(s, a)).toMatch(/^ヨビニオン・トライブ\(パワー4000・アンタップ・左から1体目\)$/);
    expect(targetLabel(s, b)).toMatch(/^ヨビニオン・トライブ\(パワー4000・タップ・左から2体目\)$/);
    // 同名がいなければ、位置は添えない
    expect(targetLabel(s, c)).toMatch(/^天災 デドダム\(パワー\d+・アンタップ\)$/);
  });
});
