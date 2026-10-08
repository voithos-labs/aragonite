import { configDefaults, defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { existsSync, readFileSync } from 'fs';
import type { Plugin } from 'vite';

const DEEP_STACK = 'src/lib/**/*.deep.test.ts';
// Files that hand objects to a native addon, which rejects objects made in another VM context.
const NODE_REALM = ['src/lib/test/invariants/lint/dev-prebundle.test.ts'];

// The on-disk transform cache keys a file on its own bytes, this config and the lockfile; these files
// shape a transform too (package.json maps `#lib`; a missing file, such as an unsynced one, reads empty).
const TRANSFORM_INPUTS = [
	'package.json',
	'tsconfig.json',
	'node_modules/$app/tsconfig.json',
	'examples/consumer/tsconfig.json',
	'examples/consumer/node_modules/$app/tsconfig.json'
];

const keyCacheOnTransformInputs: Plugin = {
	name: 'aragonite:key-cache-on-transform-inputs',
	configureVitest({ defineCacheKeyGenerator }) {
		const inputs = TRANSFORM_INPUTS.map((file) =>
			existsSync(file) ? readFileSync(file, 'utf8') : ''
		).join('\n');
		defineCacheKeyGenerator(() => inputs);
	}
};

export default defineConfig({
	plugins: [
		svelte({ configFile: false, compilerOptions: { hmr: false } }),
		keyCacheOnTransformInputs
	],
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
		// One VM context per test file in a long-lived worker: jsdom loads once per worker, and every
		// file imports its modules afresh. `perf:editor` opts out, to time code outside a VM context.
		pool: 'vmForks',
		// A VM-pool worker's memory grows across the files it runs; the default recycle point (total
		// memory over the worker count) lets a full run fill the machine, so recycle at 1 GB.
		vmMemoryLimit: '1GB',
		// Transforms persist in `node_modules/.vitest-cache`, so an area run skips most of them.
		fsModuleCache: true,
		projects: [
			{
				extends: true,
				test: {
					name: 'unit',
					include: ['src/lib/test/**/*.test.ts', 'src/lib/e2e/lint/**/*.test.ts'],
					exclude: [...configDefaults.exclude, DEEP_STACK, ...NODE_REALM]
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
			},
			{
				extends: true,
				// As in deep-stack, benchmarks stay in the unit project so each runs once.
				test: { name: 'node-realm', include: NODE_REALM, pool: 'forks', benchmark: { include: [] } }
			}
		]
	}
});
