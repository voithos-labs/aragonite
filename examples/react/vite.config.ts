import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `--mode react18` builds the same app on React 18 (installed in `react-18/`), the oldest React
// the wrapper supports.
const react18 = (name: string) => path.resolve(import.meta.dirname, 'react-18/node_modules', name);

// Every aragonite package the app installs: the core, its wrapper and the showcase's plugins.
const aragonitePackages = Object.keys(
	JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8')).dependencies
).filter((name) => name.startsWith('@voithos-labs/'));

export default defineConfig(({ mode }) => ({
	plugins: [react()],
	resolve: {
		alias:
			mode === 'react18'
				? { react: react18('react'), 'react-dom': react18('react-dom') }
				: undefined,
		// `examples/showcase/` sits outside this app, so its package imports must resolve from here,
		// or they find the repo root's own copy and run a second editor beside this app's.
		dedupe: ['react', 'react-dom', ...aragonitePackages]
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
