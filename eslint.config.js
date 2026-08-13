import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// The architectural rules of this codebase, enforced rather than documented.
//
// Every restriction below corresponds to a defect found in the prototype.
// A convention that lives only in a README is a convention that decays; each
// of these fails the build instead.

// Deep relative imports were what the path alias existed to prevent, and the
// prototype used them in every file while the alias pointed at a directory
// that did not exist.
const NO_DEEP_RELATIVE = {
  group: ['../../*', '../../../*', '../../../../*'],
  message: 'Use the @/ alias instead of a deep relative path.',
};

// A module owns its domain types. Platform and library code may not reach
// into them, so a change inside a module cannot ripple outward by accident.
// Two files are deliberate exceptions and are configured separately below:
// the module registry and the module data map are the sanctioned seams.
const NO_MODULE_TYPES = {
  group: ['@/modules/*/types', '@/modules/*/types/*'],
  message:
    'Module types are owned by their module. Platform and lib code must not import them; the registry and moduleDataMap are the only sanctioned seams.',
};

// Views read data through useModuleData, never from the demo singleton. This
// is the rule that keeps the client switcher and the demo/live toggle honest:
// the prototype imported demo data at module scope, so switching client or
// data mode changed nothing on screen.
const NO_DIRECT_DEMO = {
  group: ['@/lib/data/demo', '@/lib/data/demo/*'],
  message: 'Read data through useModuleData(), not from a demo dataset directly.',
};

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },

  js.configs.recommended,

  // Type-aware linting applies to TypeScript only. Config files are plain JS
  // and belong to no tsconfig project, so the type-checked rules would fail
  // to load rather than merely not apply.
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  { files: ['**/*.js'], ...tseslint.configs.disableTypeChecked },

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        // vite.config.ts lives outside src and is owned by tsconfig.node.json;
        // allowDefaultProject lets the service lint it without a third config.
        projectService: {
          allowDefaultProject: ['vite.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // Errors, not warnings. An unused local is usually a half-finished
      // thought, and the prototype shipped several.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-unused-vars': 'off',

      // The prototype's default-view effect read enabledModules while keyed
      // only on client id, which is how a disabled module stayed on screen.
      'react-hooks/exhaustive-deps': 'error',

      'no-restricted-imports': ['error', { patterns: [NO_DEEP_RELATIVE] }],

      // Route strings are typed. Every navigation goes through routes.*, so a
      // typo is a compile error rather than a dead link.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'JSXAttribute[name.name="to"] > Literal[value=/^\\//]',
          message: 'Use a builder from @/types/routes instead of a literal path.',
        },
        {
          selector:
            'CallExpression[callee.name="navigate"] > Literal[value=/^\\//]',
          message: 'Use a builder from @/types/routes instead of a literal path.',
        },
      ],
    },
  },

  // Platform and library code: module types are off limits.
  {
    files: ['src/lib/**/*.{ts,tsx}', 'src/platform/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [NO_DEEP_RELATIVE, NO_MODULE_TYPES] },
      ],
    },
  },

  // The sanctioned seams. Each exists precisely to bridge platform code and a
  // module's domain, so each may import module types.
  //
  // FieldSalesProvider is the third because field sales is the one module
  // with mutable shared state. It imports exactly one named interface, the
  // slice the module exports for this purpose, and derives everything else
  // from it, so the crossing stays one line wide.
  {
    files: [
      'src/modules/registry.ts',
      'src/lib/data/moduleDataMap.ts',
      'src/lib/state/FieldSalesProvider.tsx',
    ],
    rules: {
      'no-restricted-imports': ['error', { patterns: [NO_DEEP_RELATIVE] }],
    },
  },

  // Module views read through the seam, never from demo data.
  {
    files: ['src/modules/**/views/**/*.tsx', 'src/modules/**/components/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [NO_DEEP_RELATIVE, NO_DIRECT_DEMO] },
      ],
    },
  },

  // Demo datasets are the one place allowed to import them.
  {
    files: ['src/lib/data/demo/**/*.ts', 'src/lib/data/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [NO_DEEP_RELATIVE] }],
    },
  },

  // Tests may assert on anything, including internals.
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },

  // Build configuration runs in Node, not the browser.
  {
    files: ['*.config.ts', '*.config.js'],
    languageOptions: { globals: globals.node },
    rules: { 'no-restricted-imports': 'off' },
  }
);
