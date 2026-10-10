import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const require = createRequire(import.meta.url);
const library = '@voithos-labs/aragonite';
/** @type {Record<string, string | { default: string }>} */
const libraryExports = JSON.parse(
	readFileSync(require.resolve(`${library}/package.json`), 'utf8')
).exports;
// Resolved the way the bundler resolves them, so a linked install's real path matches too. Lazy,
// because `svelte-kit sync` loads this config on a checkout whose library has no built dist yet.
/** @type {Set<string> | undefined} */
let libraryEntries;
const entries = () =>
	(libraryEntries ??= new Set(
		Object.entries(libraryExports)
			.filter(([, target]) => typeof target === 'object')
			.map(([subpath]) => require.resolve(`${library}${subpath.slice(1)}`))
	));

export default defineConfig({
	plugins: [sveltekit({ preprocess: vitePreprocess(), adapter: adapter() })],
	build: {
		rolldownOptions: {
			checks: { circularDependency: true },
			// A published entry inside an import cycle can run before its own imports once the
			// bundle splits it across chunks, so that cycle fails the build; other cycles are noise.
			onLog(level, log, handler) {
				if (log.code !== 'CIRCULAR_DEPENDENCY') return handler(level, log);
				if (log.ids?.some((id) => entries().has(path.resolve(id)))) throw new Error(log.message);
			}
		}
	}
});
