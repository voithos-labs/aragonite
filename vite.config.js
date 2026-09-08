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

// A checkout on a Windows drive mounted into WSL (`/mnt/c/...`) gets no inotify events, so the
// watcher never fires and an edit looks like it did nothing until the server restarts.
// `ARAGONITE_POLL=1 npm run dev` swaps in polling, which does see those writes.
//
// OPT-IN, not automatic: polling walks the tree on every tick, and over a drvfs mount that is
// expensive enough to saturate the machine — measured at load ~10 here, with the dev server up
// but too starved to answer. The ignore list below is what keeps it survivable, so anything
// bulky added to the repo belongs in it.
const usePolling = process.env.ARAGONITE_POLL === '1';

export default defineConfig({
	plugins: [silenceBrokenImageFixture, sveltekit()],
	server: {
		port: 1420,
		strictPort: true,
		watch: {
			// A nested worktree under `.claude/` is not this app; a write there reloaded every open
			// e2e page mid-battery. The rest are inert bulk that polling must never walk.
			ignored: [
				'**/.claude/**',
				'**/node_modules/**',
				'**/.git/**',
				'**/.svelte-kit/**',
				'**/build/**',
				'**/dist/**',
				'**/test-results/**'
			],
			...(usePolling ? { usePolling: true, interval: 600, binaryInterval: 2000 } : {})
		}
	}
});
