import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// `--mode vue33` builds the same app on Vue 3.3 (installed in `vue-3.3/`), the oldest Vue the
// wrapper supports, compiling the templates with that version's own compiler.
const vue33 = path.resolve(import.meta.dirname, 'vue-3.3/node_modules/vue');

// Every aragonite package the app installs: the core and its wrapper.
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
		// The adapter suite's shared modules import the core from outside this app, so it must
		// resolve from here, or they find the repo root's own copy and run a second editor.
		dedupe: ['vue', ...aragonitePackages]
	}
}));
