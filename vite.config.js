import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import adapter from '@sveltejs/adapter-static';
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

// SvelteKit joins the dependency scan's entry globs with backslashes on Windows, which a glob reads
// as escapes; the scan would match no file, and each package found mid-run reloads every page.
const posixScanEntries = {
	name: 'posix-scan-entries',
	enforce: /** @type {const} */ ('post'),
	/** @param {import('vite').UserConfig} config */
	config(config) {
		const entries = config.optimizeDeps?.entries;
		if (config.optimizeDeps && entries !== undefined) {
			config.optimizeDeps.entries = [entries].flat().map((entry) => entry.replaceAll('\\', '/'));
		}
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

// Static build: no Node server, so the demo app ships as adapter-static. The SPA fallback is
// 404.html rather than index.html, because a static host answers an unknown path with 404.html
// and index.html is the prerendered showcase.
const staticSite = adapter({ fallback: '404.html' });

export default defineConfig({
	plugins: [silenceBrokenImageFixture, sveltekit({ adapter: staticSite }), posixScanEntries],
	// Per checkout when the deps live outside it, or sibling worktrees' dev servers
	// re-optimize one shared pre-bundle under each other and 500 every page.
	...(depsOutsideRoot ? { cacheDir: '.svelte-kit/vite-cache' } : {}),
	// Every package the app imports with `import()`, so it is bundled at startup even where the
	// scan can't follow the import (`dev-prebundle.test.ts` holds this list to the source).
	optimizeDeps: { include: ['mermaid'] },
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
