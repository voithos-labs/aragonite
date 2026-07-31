import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

// E2E broken-image tests hit /test-fixtures/nonexistent.png on purpose, and SvelteKit's
// static handler logs every miss; answering early keeps the dev and Playwright stdout clean.
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
