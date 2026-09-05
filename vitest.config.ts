import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

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
		include: ['src/lib/test/**/*.test.ts', 'src/lib/e2e/lint/**/*.test.ts'],
		setupFiles: [
			'./src/lib/test/support/register-built-ins.ts',
			'./src/lib/test/support/warn-gate.ts'
		],
		// The warn gate's claim doors sit in file-level afterEach hooks that must run before the
		// setup file's verdict hook; 'stack' is what reverses "after" hooks into that order.
		sequence: { hooks: 'stack' },
		// The warn gate's per-file freshness aggregate keys on module state, which is per-file
		// only while workers isolate; pinned so a speed experiment cannot silently blur it.
		isolate: true
	}
});
