import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

/**
 * One flat config for the whole monorepo. Ignore patterns use **\/ so they
 * match nested build output (web/.next, services/x/dist) — a root-only
 * pattern made lint crawl Next.js build chunks and hang.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'mobile/**',
      'ai/**',
      '.claude/**',
      '.impeccable/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'prefer-const': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: { globals: { require: 'readonly', module: 'writable', __dirname: 'readonly', process: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['**/__tests__/**', '**/*.test.ts', 'e2e/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  }
);
