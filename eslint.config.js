import js from '@eslint/js';
import globals from 'globals';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import tseslint from 'typescript-eslint';

// Deliberately curated, not maximal: Prettier owns formatting and svelte-check owns a11y
// plus type strictness, so rules those layers already cover stay off here.
export default tseslint.config(
	{
		// Lint scope is the library and its build scripts; everything else is a build
		// artifact, a run output, or `examples/consumer` (its own tsconfig and toolchain).
		ignores: [
			'**/dist/',
			'**/build/',
			'**/.svelte-kit/',
			'**/node_modules/',
			'.claude/',
			'docs/',
			'conformance-results/',
			'perf-results/',
			'test-results/',
			'simulation-captures/',
			'.superpowers/',
			'tmp/',
			'static/',
			'examples/'
		]
	},

	js.configs.recommended,
	tseslint.configs.recommended,
	svelte.configs.recommended,

	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: {
			parser: svelteParser,
			parserOptions: { parser: tseslint.parser }
		}
	},

	{
		languageOptions: { globals: globals.browser }
	},

	{
		files: ['scripts/**', '*.{js,mjs,cjs,ts}'],
		languageOptions: { globals: globals.node }
	},

	// Type-aware rules, scoped to src/**/*.ts (the only tree the app tsconfig covers);
	// .svelte and root/scripts config files stay on the untyped net. The editor's
	// promise-bearing logic lives in extracted `.ts` factories, so this covers it.
	{
		files: ['src/**/*.ts'],
		languageOptions: {
			parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
		},
		rules: {
			'@typescript-eslint/no-floating-promises': 'error',
			'@typescript-eslint/no-misused-promises': 'error',
			// A present `default` counts as exhaustive: strictly-exhaustive switches here assert
			// `never` in their default, so the added value is catching a switch with NO fallback.
			'@typescript-eslint/switch-exhaustiveness-check': [
				'error',
				{ considerDefaultExhaustiveForUnions: true }
			]
		}
	},

	{
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
			],
			// Short-circuit and ternary statements are used deliberately for their
			// side effects (a `a() || b()` fallback chain, a `cond ? x() : y()` branch).
			'@typescript-eslint/no-unused-expressions': [
				'error',
				{ allowShortCircuit: true, allowTernary: true }
			]
		}
	},

	// ── Rules turned off, with cause ─────────────────────────────────────────────
	{
		// Every explicit `any` in the tree is in a fixture, an e2e/simulation harness, the
		// testing kit, or debug tooling, and gating those would be a style regime …
		rules: { '@typescript-eslint/no-explicit-any': 'off' }
	},
	{
		// … and re-armed on product `src/lib` to keep that surface `any`-free as a
		// standing guard, minus the test/harness/debug/testing tiers.
		files: ['src/lib/**/*.ts', 'src/lib/**/*.svelte'],
		ignores: ['src/lib/test/**', 'src/lib/e2e/**', 'src/lib/testing/**', 'src/lib/debug/**'],
		rules: { '@typescript-eslint/no-explicit-any': 'error' }
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		rules: {
			// The flagged Map/Set instances are deliberately non-reactive registries; SvelteMap
			// or SvelteSet would introduce the reactive coupling the architecture avoids.
			'svelte/prefer-svelte-reactivity': 'off',
			// The editor projects the CST into imperative render islands (highlight.js, KaTeX,
			// mermaid, the TOC) Svelte never reconciles; direct DOM writes there are the design.
			'svelte/no-dom-manipulating': 'off',
			// `source={'# One\n\nAlpha\n'}` needs the mustache: a plain attribute would
			// render the `\n` escapes literally. Only flag genuinely inert string mustaches.
			'svelte/no-useless-mustaches': ['error', { ignoreStringEscape: true }]
		}
	}
);
