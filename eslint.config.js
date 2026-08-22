import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['test/fixtures/**/*.js'],
    languageOptions: {
      globals: {
        customElements: 'readonly',
        CustomEvent: 'readonly',
        HTMLElement: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
  {
    ignores: ['node_modules/', 'coverage/'],
  },
];
