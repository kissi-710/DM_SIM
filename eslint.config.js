import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // any は、カードデータ(JSON)の境界のファイルだけに許す(下の overrides)。それ以外では増やさない
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': 'off',
      'prefer-const': 'warn',
    },
  },
  {
    // 依存の向きは ui/cli/workers → sim → ai → engine(design 2)。ai は sim・ui・Worker・cli に依存しない。
    files: ['src/ai/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/ui/**', '**/workers/**', '**/cli/**', '**/sim/**', 'react', 'react-dom', 'react/*', 'react-dom/*'], message: 'ai は sim/UI/Worker/CLI/React に依存してはいけない(design 2。乱数などの共通部品は engine に置く)' },
        ],
      }],
    },
  },
  {
    // P1: engine は UI・React・DOM・Worker に依存しない。cards は engine だけに依存する。
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/ui/**', '**/workers/**', '**/cli/**', '**/ai/**', '**/sim/**', 'react', 'react-dom', 'react/*', 'react-dom/*'], message: 'engine は UI/AI/sim/Worker/React に依存してはいけない(design P1)' },
        ],
      }],
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'navigator', 'Worker'],
    },
  },
  {
    // カードデータ(JSON)・イベントなど、形が実行時に決まる境界。ここだけ any を許す(registry.ts が読み込み時に検証する)。
    // 型を絞るには、原始操作(ActDef)を操作ごとの判別可能な共用体にする必要がある(ISSUES.md ISSUE-14)。
    files: ['src/engine/ast.ts', 'src/engine/cond.ts', 'src/engine/types.ts', 'src/engine/registry.ts', 'src/engine/vm.ts', 'src/engine/ops.ts', 'src/engine/derive.ts', 'src/engine/legal.ts', 'tests/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
