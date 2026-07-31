import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
	plugins: [svelte({ compilerOptions: { hmr: false } })],
	resolve: {
		alias: {
			$lib: path.resolve('./src/lib')
		},
		// Client svelte build, so unit tests can drive the runes graph ($effect.root
		// + flushSync); the default node resolution picks the server build, where
		// effects are no-ops and reactive seams (e.g. windowing) are untestable.
		conditions: ['browser']
	},
	test: {
		include: ['src/lib/test/**/*.test.ts', 'src/lib/e2e/lint/**/*.test.ts'],
		setupFiles: ['./src/lib/test/support/register-built-ins.ts']
	}
});
