import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.nuxt/**',
      '**/.output/**',
      'test-images/**',
      'bench/out/**',
      'scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        console: 'readonly',
        URL: 'readonly',
        atob: 'readonly',
        Response: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        performance: 'readonly',
        window: 'readonly',
        document: 'readonly',
      },
    },
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
);
