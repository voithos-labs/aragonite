import { configDefaults, defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

const DEEP_STACK = 'src/lib/test/**/*.deep.test.ts';

export default defineConfig({
	plugins: [svelte({ compilerOptions: { hmr: false } })],
	resolve: {
		alias: {
			$lib: path.resolve('./src/lib')
		},
		// Client svelte build, so unit tests can drive the runes graph. The default node
		// resolution picks the server build, where effects are no-ops.
		conditions: ['browser']
	},
	test: {
		setupFiles: [
			'./src/lib/test/support/plugin-platform.ts',
			'./src/lib/test/support/warn-gate.ts'
		],
		// The warn gate's claim doors sit in file-level afterEach hooks that must run before the
		// setup file's verdict hook; 'stack' is what reverses "after" hooks into that order.
		sequence: { hooks: 'stack' },
		// The warn gate's per-file freshness aggregate keys on module state, which is per-file
		// only while workers isolate; pinned so a speed experiment cannot silently blur it.
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
				test: { name: 'deep-stack', include: [DEEP_STACK], execArgv: ['--stack-size=150'] }
			}
		]
	}
});
