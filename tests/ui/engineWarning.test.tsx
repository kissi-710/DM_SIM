// @vitest-environment jsdom
// 調査・バッチの Worker が TS 版に落ちた時の警告(古い dmsim.wasm のまま新しいカードを足すと、黙って遅く・重くなるため)
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EngineWarning } from '../../src/ui/EngineWarning';

afterEach(cleanup);

describe('EngineWarning', () => {
  it('TS 版に落ちていなければ何も出さない', () => {
    const { container } = render(<EngineWarning fallback={null} />);
    expect(container.textContent).toBe('');
  });

  it('TS 版に落ちたら、理由と作り直しの手順を警告する', () => {
    render(<EngineWarning fallback={{ why: 'Rust エンジン: dm26rp1-026: type が不正' }} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('TS 版');
    expect(alert.textContent).toContain('dm26rp1-026: type が不正');
    expect(alert.textContent).toContain('npm run build:wasm');
  });

  it('理由が分からなくても警告する', () => {
    render(<EngineWarning fallback={{}} />);
    expect(screen.getByRole('alert').textContent).not.toContain('理由');
  });
});
