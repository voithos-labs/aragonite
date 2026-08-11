// Static SPA build: no Node server, so the demo app ships as adapter-static plus an
// index.html fallback.
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			fallback: 'index.html'
		}),
		paths: {
			// Empty locally; the Pages build sets /aragonite for the project-page subdirectory.
			base: process.env.BASE_PATH ?? ''
		}
	}
};

export default config;
