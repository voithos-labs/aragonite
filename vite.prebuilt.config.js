// The prebuilt build in `dist/prebuilt`, which package.json's `default` condition hands a host whose
// bundler doesn't compile Svelte. One build over every entry point, so they share chunks and the
// plugin registries stay one instance. `scripts/pack/verify-prebuilt.mjs` gates its output.

import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { pluginPackages, publishedEntryPoints } from './scripts/lib-alias.mjs';
import { prebuiltExternals } from './scripts/pack/pack-manifest.mjs';
import { runtimeEntriesExportWhatPluginsUse } from './scripts/pack/svelte-runtime-names.mjs';

const entry = Object.fromEntries(
	publishedEntryPoints().map(({ source, prebuilt }) => [
		prebuilt.replace(/^dist\/prebuilt\/(.+)\.js$/, '$1'),
		source
	])
);

const externals = prebuiltExternals();

/** Fails the build when it inlines a package THIRD-PARTY-NOTICES.md has no `## <name> (` section for. */
const noticeEveryBundledPackage = {
	name: 'notice-every-bundled-package',
	/** @param {unknown} _options @param {import('rolldown').OutputBundle} bundle */
	generateBundle(_options, bundle) {
		const notices = readFileSync('THIRD-PARTY-NOTICES.md', 'utf8');
		const bundled = new Set();
		for (const output of Object.values(bundle)) {
			if (output.type !== 'chunk') continue;
			for (const id of Object.keys(output.modules)) {
				const name = /node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(id)?.[1];
				if (name) bundled.add(name.replace('\\', '/'));
			}
		}
		const missing = [...bundled].filter((name) => !notices.includes(`## ${name} (`));
		if (missing.length > 0) {
			throw new Error(`THIRD-PARTY-NOTICES.md has no section for bundled ${missing.join(', ')}`);
		}
	}
};

export default defineConfig({
	plugins: [
		runtimeEntriesExportWhatPluginsUse(() => pluginPackages().map(({ dir }) => `${dir}/src`)),
		svelte({ configFile: false, compilerOptions: { runes: true } }),
		noticeEveryBundledPackage
	],
	publicDir: false,
	build: {
		outDir: 'dist/prebuilt',
		emptyOutDir: true,
		// A host's bundler minifies; unminified, a stack trace through the editor stays readable.
		minify: false,
		cssCodeSplit: false,
		lib: { entry, formats: ['es'], cssFileName: 'style' },
		rolldownOptions: {
			external: (id) => externals.some((name) => id === name || id.startsWith(`${name}/`)),
			output: {
				entryFileNames: '[name].js',
				chunkFileNames: 'chunks/[name]-[hash].js',
				// Pure annotations stay so a host can still drop unused code; licence comments stay too.
				comments: { legal: true, annotation: true, jsdoc: false }
			}
		}
	}
});
