/**
 * The dev server pre-bundles every package the app imports before the first page asks for one
 * (G4.126). A package found mid-run makes Vite re-bundle and reload every open page, which reds
 * whatever e2e test was loading. The startup scan finds the static imports from the route files,
 * so its entry globs must match them; a lazy `import()` is listed in `optimizeDeps.include`.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { resolveConfig } from 'vite';
import { collectFiles, importSpecifiers, readSource } from './scan-source';
import { SOURCE, SOURCE_DIR } from './source-paths';

const config = await resolveConfig({ configFile: path.resolve(SOURCE.viteConfig) }, 'serve');
const clientDeps = config.environments.client.optimizeDeps;

// The glob Vite itself resolves the entries with, so a pattern it can't read fails here too.
const viteRequire = createRequire(createRequire(import.meta.url).resolve('vite/package.json'));
const { glob } = viteRequire('tinyglobby') as typeof import('tinyglobby');

const toPosix = (file: string) => file.split(path.sep).join('/');

function appSources() {
	const extensions = ['.ts', '.js', '.svelte'];
	return [
		...collectFiles(SOURCE_DIR.library, { extensions, skip: ['test', 'e2e'] }),
		...collectFiles(SOURCE_DIR.routes, { extensions })
	]
		.filter((relPath) => !relPath.endsWith('.d.ts'))
		.map(readSource);
}

const isPackage = (specifier: string) => !/^[./$]/.test(specifier);

describe('G4.126 the dev server pre-bundles every package before a page asks for it', () => {
	it('each startup scan entry glob matches a route file', async () => {
		const entries = [clientDeps.entries ?? []].flat();
		const negations = entries.filter((entry) => entry.startsWith('!'));
		const unmatched: string[] = [];
		for (const entry of entries.filter((entry) => !entry.startsWith('!'))) {
			const found = await glob([entry, ...negations], { cwd: config.root, absolute: true });
			if (found.length === 0) unmatched.push(entry);
		}
		expect(
			unmatched,
			'scan entries that match no file, so the dev server finds every package mid-run and reloads open pages (on Windows, check they use forward slashes)'
		).toEqual([]);
		const scanned = await glob(entries, { cwd: config.root, absolute: true });
		expect(scanned).toContain(toPosix(path.resolve(SOURCE.showcaseRoute)));
	});

	it('every package the app imports lazily is in optimizeDeps.include', () => {
		const lazy = appSources().flatMap((file) =>
			importSpecifiers(file.code)
				.filter((spec) => spec.kind === 'dynamic' && !spec.typeOnly && isPackage(spec.specifier))
				.map((spec) => ({ file: file.relPath, specifier: spec.specifier }))
		);
		expect(lazy.length, 'the scan found no lazy package import at all').toBeGreaterThan(0);
		const included = new Set(clientDeps.include ?? []);
		const missing = lazy.filter(({ specifier }) => !included.has(specifier));
		expect(
			missing,
			'add these packages to optimizeDeps.include in vite.config.js, or the dev server finds them mid-run and reloads every open page'
		).toEqual([]);
	});
});
