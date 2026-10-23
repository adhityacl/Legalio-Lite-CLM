import js from '@eslint/js';
import globals from 'globals';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/*
 * Flat config for the whole workspace (backend, frontend, packages).
 *
 * Errors (these gate `npm run lint`): the promise rules that need type information, and the Rules of Hooks.
 * Everything else is reported as a warning: style/hygiene rules are visible but do not fail the build.
 */
const warn = (rules) => Object.fromEntries(Object.keys(rules).map((name) => [name, rules[name] === 'off' ? 'off' : 'warn']));

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.vite/**', 'reports/**', 'research_notes/**', 'assets/**', '**/*.d.ts', '**/*.mjs', '**/*.cjs', '**/*.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      // Hygiene rules from the recommended sets: warnings only.
      ...warn(js.configs.recommended.rules),
      ...warn(Object.assign({}, ...tseslint.configs.recommended.map((config) => config.rules ?? {}))),
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true }],
      '@typescript-eslint/no-unused-expressions': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'no-control-regex': 'off',
      // Promise correctness (type-aware): errors.
      '@typescript-eslint/no-floating-promises': ['error', {
        // node:test returns a promise that the runner itself awaits.
        allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['test', 'it', 'describe', 'suite', 'before', 'after', 'beforeEach', 'afterEach'] }],
      }],
      // `attributes: false`: JSX event handlers such as onClick={async () => ...} are an accepted React pattern (React ignores the
      // returned promise); the checks for conditions, arguments (e.g. useEffect(async ...)), properties and spreads stay on.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/await-thenable': 'error',
      // React.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      ...warn(jsxA11y.flatConfigs.recommended.rules),
    },
  },
  // Express 4 ignores the promise an async route handler returns; forwardAsyncRouteErrors (asyncRoutes.ts) wraps every
  // handler registered through the app/routers and forwards rejections to the error middleware, so passing async
  // functions as arguments is the intended pattern in the backend. Other misuse (conditions, attributes, spreads) stays an error.
  {
    files: ['apps/backend/src/**/*.ts'],
    rules: { '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { arguments: false, attributes: false } }] },
  },
);
