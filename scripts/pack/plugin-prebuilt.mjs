// A plugin package's prebuilt build in `dist/prebuilt`, which its `default` export condition hands a
// host whose bundler doesn't compile Svelte. It bundles only the package's own source: the core, the
// Svelte runtime the core's prebuilt embeds, and the package's other peers stay imports, so the host
// resolves each to the one copy its editor runs. The build fails rather than ship anything else.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { publishedEntryPoints } from '../lib-alias.mjs';
import {
	PREBUILT_COMPILER_OPTIONS,
	RUNTIME_SUBPATHS,
	SVELTE_VERSION,
	runtimeNamesUsedBy
} from './svelte-runtime-names.mjs';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The Vite config that builds the plugin package in `packageDir` against the core at `coreDir`,
 * this checkout's by default.
 * @param {string} packageDir
 * @param {string} [coreDir]
 */
export function pluginPrebuiltConfig(packageDir, coreDir = REPO_ROOT) {
	const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
	const peers = Object.keys(manifest.peerDependencies ?? {}).filter((name) => name !== 'svelte');
	const source = path.join(packageDir, 'src');
	const entry = Object.fromEntries(
		publishedEntryPoints(manifest, 'src').map(({ prebuilt, source: file }) => [
			prebuilt.replace(/^dist\/prebuilt\/(.+)\.js$/, '$1'),
			path.join(packageDir, file)
		])
	);
	return defineConfig({
		root: packageDir,
		plugins: [
			svelteFromTheCore(coreDir, source),
			svelte({ configFile: false, compilerOptions: PREBUILT_COMPILER_OPTIONS }),
			bundlesOnlyItsSource(source)
		],
		publicDir: false,
		logLevel: 'warn',
		build: {
			outDir: path.join(packageDir, 'dist/prebuilt'),
			emptyOutDir: true,
			// A host's bundler minifies; unminified, a stack trace through the plugin stays readable.
			minify: false,
			cssCodeSplit: false,
			lib: { entry, formats: ['es'], cssFileName: 'style' },
			rolldownOptions: {
				external: (id) => peers.some((name) => id === name || id.startsWith(`${name}/`)),
				output: {
					entryFileNames: '[name].js',
					chunkFileNames: 'chunks/[name]-[hash].js',
					comments: { legal: true, annotation: true, jsdoc: false }
				}
			}
		}
	});
}

// ── Plugins ──────────────────────────────────────────────────────────────────

/**
 * Points every Svelte import at the core's runtime subpath, after checking the core's prebuilt
 * embeds the Svelte this build compiles with and exports every runtime name the package reaches.
 * @param {string} coreDir
 * @param {string} source
 * @returns {import('vite').Plugin}
 */
function svelteFromTheCore(coreDir, source) {
	return {
		name: 'svelte-from-the-core',
		enforce: 'pre',
		async buildStart() {
			const problems = await runtimeMismatch(coreDir, source);
			if (problems.length > 0) this.error(problems.join('\n'));
		},
		resolveId(id) {
			if (id === 'svelte' || id.startsWith('svelte/')) {
				const core = RUNTIME_SUBPATHS[/** @type {keyof typeof RUNTIME_SUBPATHS} */ (id)];
				if (core === undefined) this.error(`no core runtime subpath carries ${id}`);
				return { id: core, external: true };
			}
			return null;
		}
	};
}

/** @param {string} source @returns {import('vite').Plugin} */
function bundlesOnlyItsSource(source) {
	const inside = path.resolve(source) + path.sep;
	return {
		name: 'bundles-only-its-source',
		generateBundle(_options, bundle) {
			const foreign = Object.values(bundle)
				.flatMap((output) => (output.type === 'chunk' ? Object.keys(output.modules) : []))
				.filter((id) => !path.resolve(id.replace(/\?.*$/, '')).startsWith(inside));
			if (foreign.length > 0)
				this.error(`the prebuilt carries modules from outside its source: ${foreign.join(', ')}`);
		}
	};
}

// ── The runtime check ────────────────────────────────────────────────────────

/**
 * Every way the core's prebuilt runtime can't serve the package's compiled components.
 * @param {string} coreDir
 * @param {string} source
 */
export async function runtimeMismatch(coreDir, source) {
	// Resolved from the core's own manifest, so a nested worktree's `node_modules` can't hand over
	// another checkout's build.
	const coreRequire = createRequire(path.join(coreDir, 'package.json'));
	const problems = [];
	const runtime = Object.fromEntries(
		await Promise.all(
			Object.entries(RUNTIME_SUBPATHS).map(async ([module, subpath]) => [
				module,
				await import(pathToFileURL(coreRequire.resolve(subpath)).href)
			])
		)
	);
	const embedded = runtime.svelte.SVELTE_VERSION;
	if (embedded !== SVELTE_VERSION) {
		problems.push(
			`the core's prebuilt embeds svelte ${embedded}; this build compiles with ${SVELTE_VERSION}`
		);
	}
	const { names, unsupported } = await runtimeNamesUsedBy([source]);
	for (const module of unsupported) problems.push(`no core runtime subpath carries ${module}`);
	for (const [module, used] of Object.entries(names)) {
		const missing = [...used].filter((name) => !(name in runtime[module]));
		if (missing.length > 0) {
			problems.push(
				`the core's prebuilt ${module} exports no ${missing.join(', ')}; rebuild it with ` +
					'`npm run package`, which exports what the plugins use'
			);
		}
	}
	return problems;
}
