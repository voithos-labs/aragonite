import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

// E2E broken-image tests reference /test-fixtures/nonexistent.png to trigger the
// <img> error path; SvelteKit's static handler logs every miss, so the dev
// terminal and the Playwright-captured stdout fill with [404] lines. Match the
// path early and end the response without going through the static layer.
const silenceBrokenImageFixture = {
	name: 'silence-broken-image-fixture',
	/** @param {import('vite').ViteDevServer} server */
	configureServer(server) {
		server.middlewares.use(
			/** @type {import('vite').Connect.NextHandleFunction} */ (
				(req, res, next) => {
					if (/** @type {{ url?: string }} */ (req).url === '/test-fixtures/nonexistent.png') {
						res.statusCode = 404;
						res.end();
						return;
					}
					next();
				}
			)
		);
	}
};

// https://vite.dev/config/
export default defineConfig({
	plugins: [silenceBrokenImageFixture, sveltekit()],
	server: {
		port: 1420,
		strictPort: true
	}
});
