import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Architecture guards (PROJECT_BRIEF §4). A rule that isn't gated will be violated,
// so the non-negotiable constraints are encoded here and run in the gate.
const CORE_FORBIDDEN = [
  {
    group: [
      'three',
      'three/*',
      '@types/three',
      'colyseus',
      'colyseus/*',
      '@colyseus/*',
      'vite',
      '@deceive/server',
      '@deceive/client',
    ],
    message:
      'Core (shared/sim-core) must stay engine/transport-agnostic — no Three.js, Colyseus, Vite, DOM, client, or server imports (PROJECT_BRIEF §4.1/§4.2).',
  },
];

const DETERMINISM_FORBIDDEN = [
  {
    object: 'Math',
    property: 'random',
    message: 'Deterministic core: inject an Rng and use it; never call Math.random() (PROJECT_BRIEF §4.3).',
  },
  {
    object: 'Date',
    property: 'now',
    message: 'Deterministic core: inject a Clock and use it; never call Date.now() (PROJECT_BRIEF §4.3).',
  },
];

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.json', '**/*.tsbuildinfo'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // sim-core: engine-agnostic + deterministic.
  {
    files: ['packages/sim-core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: CORE_FORBIDDEN }],
      'no-restricted-properties': ['error', ...DETERMINISM_FORBIDDEN],
    },
  },
  // shared: the lowest layer — also engine-agnostic + deterministic, and must not
  // import sim-core (dependency direction is shared <- sim-core, never the reverse).
  {
    files: ['packages/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...CORE_FORBIDDEN,
            {
              group: ['@deceive/sim-core', '@deceive/sim-core/*'],
              message: 'shared is the lowest layer; it must not import sim-core.',
            },
          ],
        },
      ],
      'no-restricted-properties': ['error', ...DETERMINISM_FORBIDDEN],
    },
  },
);
