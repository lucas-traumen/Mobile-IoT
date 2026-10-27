module.exports = {
  root: true,
  extends: ['expo', 'prettier'],
  plugins: ['boundaries'],
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
  },
  settings: {
    'boundaries/elements': [
      { type: 'core', pattern: 'src/core/**' },
      { type: 'settings', pattern: 'src/modules/settings/**' },
      { type: 'telemetry', pattern: 'src/modules/telemetry/**' },
      { type: 'relay', pattern: 'src/modules/relay/**' },
      { type: 'history', pattern: 'src/modules/history/**' },
      { type: 'devices', pattern: 'src/modules/devices/**' },
      { type: 'widgets', pattern: 'src/modules/widgets/**' },
      { type: 'dashboard', pattern: 'src/modules/dashboard/**' },
      { type: 'app', pattern: 'src/app/**' },
    ],
    'boundaries/files': [
      { category: 'root', pattern: 'App.tsx' },
      { category: 'test', pattern: '**/*.test.ts' },
      { category: 'test', pattern: '**/*.test.tsx' },
    ],
    'boundaries/legacy-warnings': false,
  },
  rules: {
    // Hard requirement: no explicit `any` anywhere.
    '@typescript-eslint/no-explicit-any': 'error',
    // No console.log outside the core logger (see src/core/logger).
    'no-console': 'error',
    // Module boundary enforcement: modules may import core + other modules'
    // api/ facade ONLY — never another module's internal/ (see READMEs).
    'boundaries/dependencies': [
      2,
      {
        default: 'disallow',
        checkAllOrigins: true,
        policies: [
          // External packages (react, react-native, zustand, zod, mqtt,
          // victory-native, async-storage, …) are always allowed — the
          // boundary rule targets module-to-module imports.
          {
            from: { element: { type: '*' } },
            allow: [{ to: { module: { origin: 'external' } } }],
          },
          // The root entry file also uses React/RN directly.
          {
            from: { file: { categories: 'root' } },
            allow: [{ to: { module: { origin: 'external' } } }],
          },
          // root App.tsx may import app shell + core + module facades + ui
          {
            from: { file: { categories: 'root' } },
            allow: [
              {
                to: {
                  element: {
                    types: {
                      anyOf: [
                        'core',
                        'settings',
                        'telemetry',
                        'relay',
                        'history',
                        'devices',
                        'widgets',
                        'dashboard',
                        'app',
                      ],
                    },
                  },
                },
              },
            ],
          },
          // app layer (composition root + shell) may import everything
          {
            from: { element: { type: 'app' } },
            allow: [
              {
                to: {
                  element: {
                    types: {
                      anyOf: [
                        'core',
                        'settings',
                        'telemetry',
                        'relay',
                        'history',
                        'devices',
                        'widgets',
                        'dashboard',
                        'app',
                      ],
                    },
                  },
                },
              },
              // The root entry file (App.tsx) is composition-root code the
              // app layer may import (e.g. src/app/App.test.tsx smoke tests).
              { to: { file: { categories: 'root' } } },
            ],
          },
          // core imports only core
          {
            from: { element: { type: 'core' } },
            allow: [{ to: { element: { type: 'core' } } }],
          },
          // each module may import core, and any module's api/ facade only
          {
            from: {
              element: {
                types: {
                  anyOf: [
                    'settings',
                    'telemetry',
                    'relay',
                    'history',
                    'devices',
                    'widgets',
                    'dashboard',
                  ],
                },
              },
            },
            allow: [
              { to: { element: { type: 'core' } } },
              {
                to: {
                  element: {
                    types: {
                      anyOf: [
                        'settings',
                        'telemetry',
                        'relay',
                        'history',
                        'devices',
                        'widgets',
                        'dashboard',
                      ],
                    },
                  },
                  file: { path: 'src/modules/*/api/**' },
                },
              },
            ],
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.test.tsx'],
      env: {
        jest: true,
      },
    },
    {
      // The core logger is the single sanctioned place that touches console.
      files: ['src/core/logger/*.ts'],
      rules: {
        'no-console': 'off',
      },
    },
  ],
};
