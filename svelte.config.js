// Static build: no Node server, so the demo app ships as adapter-static. The SPA fallback is
// 404.html rather than index.html, because a static host answers an unknown path with 404.html
// and index.html is now the prerendered showcase.
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			fallback: '404.html'
		}),
		paths: {
			// Empty locally; the Pages build sets /aragonite for the project-page subdirectory.
			base: process.env.BASE_PATH ?? ''
		}
	}
};

export default config;
