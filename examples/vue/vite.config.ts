import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// `--mode vue33` builds the same app on Vue 3.3 (installed in `vue-3.3/`), the oldest Vue the
// wrapper supports, compiling the templates with that version's own compiler.
const vue33 = path.resolve(import.meta.dirname, 'vue-3.3/node_modules/vue');

// Every aragonite package the app installs: the core, its wrapper and the showcase's plugins.
const aragonitePackages = Object.keys(
	JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8')).dependencies
).filter((name) => name.startsWith('@voithos-labs/'));

export default defineConfig(({ mode }) => ({
	plugins: [
		vue(
			mode === 'vue33'
				? { compiler: createRequire(import.meta.url)(`${vue33}/compiler-sfc`) }
				: undefined
		)
	],
	resolve: {
		alias: mode === 'vue33' ? { vue: vue33 } : undefined,
		// `examples/showcase/` sits outside this app, so its package imports must resolve from here,
		// or they find the repo root's own copy and run a second editor beside this app's.
		dedupe: ['vue', ...aragonitePackages]
	},
	// The adapter suite's page is `index.html`; the showcase is a second page it never loads.
	build: {
		rollupOptions: {
			input: {
				main: path.resolve(import.meta.dirname, 'index.html'),
				showcase: path.resolve(import.meta.dirname, 'showcase.html')
			}
		}
	}
}));
