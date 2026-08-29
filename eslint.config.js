import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'artifacts/**', 'fixtures/**', 'node_modules/**', 'submission/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // The plain-JS maintenance scripts and this config file are not part of
        // the TypeScript project, so they get the default program.
        projectService: {
          allowDefaultProject: ['eslint.config.js', 'scripts/*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Shipped modules log through src/infra/log.ts and print through
      // src/cli/presenter.ts. A stray console call is a bug, not a style issue.
      'no-console': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "TSAsExpression > TSAnyKeyword",
          message: 'Casting to any hides the very mistakes the type checker is for.',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    // Tests assert on behaviour and may build partial environments on purpose.
    // node:test's `test()` returns a promise nobody is meant to await.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      // Maintenance scripts talk to whoever ran them; there is no presenter here.
      'no-console': 'off',
    },
  },
);
