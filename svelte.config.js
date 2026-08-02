// Static SPA build (no Node server). adapter-static with an index.html fallback
// puts the demo app in SPA mode. See https://svelte.dev/docs/kit/single-page-apps
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
