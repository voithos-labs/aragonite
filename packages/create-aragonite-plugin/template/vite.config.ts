// One config for the dev page (`npm run dev` serves index.html), the library build and Vitest.
import { defineConfig } from 'vitest/config';

const EDITOR = '@voithos-labs/aragonite';

export default defineConfig({
	build: {
		lib: {
			entry: { index: 'src/index.ts', conformance: 'src/conformance.ts' },
			formats: ['es'],
			cssFileName: 'style'
		},
		rolldownOptions: {
			// The host brings the editor, so the plugin and the host share one copy of it.
			external: (id) => id === EDITOR || id.startsWith(`${EDITOR}/`)
		}
	},
	test: { include: ['test/**/*.test.ts'] }
});
