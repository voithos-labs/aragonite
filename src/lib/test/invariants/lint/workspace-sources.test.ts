/**
 * A published package name reaches this checkout's source in every tool the repo runs: Vite, Vitest,
 * svelte-check (through tsconfig `paths`) and Node (the hook Playwright installs). A nested
 * worktree's `node_modules` links the names to another checkout, so a tool left to `node_modules`
 * loads a second copy of the editor. A suite that tests the packed packages gets none of this.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { resolveConfig } from 'vite';
import { workspaceSources } from '../../../../../scripts/lib-alias.mjs';
import { collectFiles } from './scan-source';
import { SOURCE } from './source-paths';
import * as viaLibrary from '#lib/plugin.js';
import * as viaPackage from '@voithos-labs/aragonite/plugin';

const expected = [...workspaceSources()].map(([specifier, source]) => [
	specifier,
	path.resolve(source)
]);

describe('the package names resolve to this checkout in every tool', () => {
	it('tsconfig.json maps each name to its source file', () => {
		const tsconfig = ts.parseConfigFileTextToJson(
			'tsconfig.json',
			readFileSync('tsconfig.json', 'utf8')
		);
		const paths: Record<string, string[]> = tsconfig.config.compilerOptions.paths ?? {};
		const mapped = Object.entries(paths).map(([specifier, [target]]) => [
			specifier,
			path.resolve(target)
		]);
		const fix = Object.fromEntries(
			[...workspaceSources()].map(([specifier, source]) => [specifier, [`./${source}`]])
		);
		expect(mapped, `set tsconfig.json "paths" to ${JSON.stringify(fix)}`).toEqual(expected);
	});

	it('the app build aliases each name to its source file', async () => {
		const config = await resolveConfig({ configFile: path.resolve(SOURCE.viteConfig) }, 'build');
		const aliased = expected.filter(([specifier, file]) =>
			config.resolve.alias.some(
				({ find, replacement }) =>
					find instanceof RegExp && find.test(specifier) && path.resolve(replacement) === file
			)
		);
		expect(aliased).toEqual(expected);
	});

	it('a Vitest import by package name is the same module as the library path', () => {
		expect(viaPackage.definePlugin).toBe(viaLibrary.definePlugin);
	});
});

// Miss-analysis: Playwright applies the nearest tsconfig's `paths`, and the adapter suite had none
// of its own, so the root's source mapping reached a suite that tests the packed packages.
describe('a Playwright suite that tests the installed packages loads them, not this source', () => {
	const packageNames = new Set(workspaceSources().keys());

	/** The `paths` of the tsconfig Playwright reads for files in `dir`, through relative `extends`. */
	function inheritedPaths(dir: string): { tsconfig: string; mapped: string[] } {
		let tsconfig = path.resolve(dir, 'tsconfig.json');
		while (!existsSync(tsconfig))
			tsconfig = path.resolve(path.dirname(tsconfig), '../tsconfig.json');
		const mapped: string[] = [];
		for (let file: string | undefined = tsconfig; file !== undefined && existsSync(file);) {
			const { config } = ts.parseConfigFileTextToJson(file, readFileSync(file, 'utf8'));
			mapped.push(...Object.keys(config.compilerOptions?.paths ?? {}));
			const parent: unknown = config.extends;
			file =
				typeof parent === 'string' && parent.startsWith('.')
					? path.resolve(path.dirname(file), parent)
					: undefined;
		}
		return { tsconfig: path.relative('.', tsconfig), mapped };
	}

	const suites = collectFiles('examples', {
		extensions: ['playwright.config.ts'],
		skip: ['node_modules', '.svelte-kit', '.next', '.nuxt', '.output', 'build', 'dist']
	})
		.filter((file) => file.split('/').length === 3)
		.map((file) => path.posix.dirname(file));

	it('finds the example suites', () => {
		expect(suites).toContain('examples/adapter-suite');
	});

	it.each(suites)('%s maps no package name to source', (dir) => {
		const { tsconfig, mapped } = inheritedPaths(dir);
		expect(
			mapped.filter((name) => packageNames.has(name)),
			`${tsconfig} maps these for ${dir}; give the suite a tsconfig.json of its own`
		).toEqual([]);
	});
});
