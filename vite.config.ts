import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 公開先のパスに合わせて base を変える(例: GitHub Pages なら '/DM_SIM/')。
// 環境変数 DM_SIM_BASE で上書きできる。ローカル利用では './' のままでよい。
export default defineConfig({
  base: process.env.DM_SIM_BASE ?? './',
  plugins: [react()],
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
    // npm run test:coverage(カバレッジの計測。結果は coverage/ に出る。git の管理外)
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/wasm/**', 'src/workers/**', 'src/ui/main.tsx'],
      reporter: ['text-summary', 'html'],
    },
  },
});
