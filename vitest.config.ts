import { configDefaults, defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const DEEP_STACK = 'src/lib/**/*.deep.test.ts';

export default defineConfig({
	plugins: [svelte({ compilerOptions: { hmr: false } })],
	resolve: {
		// Client svelte build, so unit tests can drive the runes graph. The default node
		// resolution picks the server build, where effects are no-ops.
		conditions: ['browser']
	},
	test: {
		setupFiles: [
			'./src/lib/test/support/plugin-platform.ts',
			'./src/lib/test/support/warn-gate.ts'
		],
		// A test file's afterEach hooks claim the dev warnings it expected, so they must run before
		// the warn gate's verdict hook in the setup file; 'stack' runs "after" hooks in that order.
		sequence: { hooks: 'stack' },
		// The warn gate keeps per-file state at module scope, which stays per-file only while each
		// test file gets a fresh module graph; pinned so a speed experiment can't quietly share it.
		isolate: true,
		projects: [
			{
				extends: true,
				test: {
					name: 'unit',
					include: ['src/lib/test/**/*.test.ts', 'src/lib/e2e/lint/**/*.test.ts'],
					exclude: [...configDefaults.exclude, DEEP_STACK]
				}
			},
			{
				extends: true,
				// A small stack overflows a recursive walk at a depth jsdom still renders in seconds.
				test: {
					name: 'deep-stack',
					include: [DEEP_STACK],
					execArgv: ['--stack-size=150'],
					// Otherwise `vitest bench` runs every benchmark a second time, on the small stack.
					benchmark: { include: [] }
				}
			}
		]
	}
});
