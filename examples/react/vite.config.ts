import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `--mode react18` builds the same app on React 18 (installed in `react-18/`), the oldest React
// the wrapper supports.
const react18 = (name: string) => path.resolve(import.meta.dirname, 'react-18/node_modules', name);

// Every aragonite package the app installs: the core and its wrapper.
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
		// The adapter suite's shared modules import the core from outside this app, so it must
		// resolve from here, or they find the repo root's own copy and run a second editor.
		dedupe: ['react', 'react-dom', ...aragonitePackages]
	}
}));
