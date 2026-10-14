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
      '@typescript-eslint/no-explicit-any': 'off',
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
);
