import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
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

// A checkout on a Windows drive mounted into WSL (`/mnt/c/...`) gets no file-change events, so
// `ARAGONITE_POLL=1 npm run dev` swaps in polling. It stays opt-in because polling walks the whole
// tree each tick, which can starve the machine; anything bulky belongs in the ignore list below.
const usePolling = process.env.ARAGONITE_POLL === '1';

// A worktree resolves its deps from outside its own root, through a `node_modules` junction or
// from the enclosing checkout's `node_modules`, and vite refuses to serve those files (a 403 per
// font), so the directory the deps really resolve from is allowed.
const nodeModulesTarget = (() => {
	const kitPackage = createRequire(import.meta.url).resolve('@sveltejs/kit/package.json');
	const resolvedFrom = kitPackage.slice(
		0,
		kitPackage.lastIndexOf('node_modules') + 'node_modules'.length
	);
	try {
		return realpathSync.native(resolvedFrom);
	} catch {
		return resolvedFrom;
	}
})();
const depsOutsideRoot = path.relative(process.cwd(), nodeModulesTarget).startsWith('..');

export default defineConfig({
	plugins: [silenceBrokenImageFixture, sveltekit()],
	// Per checkout when the deps live outside it, or sibling worktrees' dev servers
	// re-optimize one shared pre-bundle under each other and 500 every page.
	...(depsOutsideRoot ? { cacheDir: '.svelte-kit/vite-cache' } : {}),
	// The lazy engines pre-bundle at server start: discovered at first use, their chunks are
	// re-optimized under a page that already imported them, and the import fails.
	optimizeDeps: { include: ['mermaid', 'katex'] },
	server: {
		port: 1420,
		strictPort: true,
		...(depsOutsideRoot
			? { fs: { allow: [searchForWorkspaceRoot(process.cwd()), nodeModulesTarget] } }
			: {}),
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
