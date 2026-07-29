import js from '@eslint/js';
import globals from 'globals';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import tseslint from 'typescript-eslint';

// ESLint is the standard net that sits over svelte-check's 0-error baseline and
// the source-scan lint suite: floating promises, exhaustive-switch discipline,
// and unused values. It is deliberately curated, not maximal — Prettier owns
// formatting and svelte-check owns a11y + type strictness, so rules those layers
// already cover are turned off here rather than duplicated.
export default tseslint.config(
	{
		// Lint scope is the library and its build scripts. Everything else is a
		// build artifact, a run output, or `examples/consumer` — a separately
		// scaffolded app with its own tsconfig/toolchain, out of scope here.
		ignores: [
			'**/dist/',
			'**/build/',
			'**/.svelte-kit/',
			'**/node_modules/',
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

	// The audit's named net — the type-aware rules ESLint adds over svelte-check.
	// Scoped to src/**/*.ts (the only tree the app tsconfig covers) — type-aware
	// linting of the whole tree measures at ~20s, so tests ride the typed net too.
	// .svelte and root/scripts config files stay on the untyped net; the editor's
	// promise-bearing logic lives in extracted `.ts` factories, not the thin
	// component shells, so this covers where the await-tick discipline matters.
	{
		files: ['src/**/*.ts'],
		languageOptions: {
			parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
		},
		rules: {
			'@typescript-eslint/no-floating-promises': 'error',
			'@typescript-eslint/no-misused-promises': 'error',
			// A present `default` counts as exhaustive: the codebase's strictly-exhaustive
			// switches assert `never` in their default (caught by svelte-check on a new
			// union member), so this rule's added value is catching a switch with NO
			// fallback — not fighting the partial dispatchers and estimators that map the
			// remainder through `default` on purpose.
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
		// Every explicit `any` in the tree is in a test fixture, an e2e/simulation
		// harness, the testing kit, or dev debug tooling — the product surface is
		// already `any`-free. So this rule is off by default (loose fixtures are
		// pragmatic and gating 400+ of them would be a style regime) …
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
			// The flagged Map/Set instances are deliberately non-reactive registries and
			// transient computations (their modules signal reactivity through separate
			// `$state`). Swapping in SvelteMap/SvelteSet would introduce exactly the
			// reactive-dependency coupling the reactivity architecture is built to avoid.
			'svelte/prefer-svelte-reactivity': 'off',
			// The editor projects the CST into imperative render-output islands
			// (highlight.js, KaTeX, mermaid, the TOC) that Svelte does not own and never
			// reconciles — direct DOM writes there are the architecture, not a mistake.
			'svelte/no-dom-manipulating': 'off',
			// `source={'# One\n\nAlpha\n'}` needs the mustache: a plain attribute would
			// render the `\n` escapes literally. Only flag genuinely inert string mustaches.
			'svelte/no-useless-mustaches': ['error', { ignoreStringEscape: true }]
		}
	}
);
