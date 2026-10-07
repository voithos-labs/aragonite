import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig } from 'vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const libraryManifest = createRequire(import.meta.url).resolve(
	'@voithos-labs/aragonite/package.json'
);
/** @type {Record<string, string | { default: string }>} */
const libraryExports = JSON.parse(readFileSync(libraryManifest, 'utf8')).exports;
const libraryEntries = Object.values(libraryExports).flatMap((target) =>
	typeof target === 'object' ? [`@voithos-labs/aragonite/${target.default.slice(2)}`] : []
);

export default defineConfig({
	plugins: [sveltekit({ preprocess: vitePreprocess(), adapter: adapter() })],
	build: {
		rolldownOptions: {
			checks: { circularDependency: true },
			// A published entry inside an import cycle can run before its own imports once the
			// bundle splits it across chunks, so that cycle fails the build; other cycles are noise.
			onLog(level, log, handler) {
				if (log.code !== 'CIRCULAR_DEPENDENCY') return handler(level, log);
				if (libraryEntries.some((entry) => log.message.includes(entry)))
					throw new Error(log.message);
			}
		}
	}
});
