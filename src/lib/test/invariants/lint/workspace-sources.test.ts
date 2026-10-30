/**
 * A published package name reaches this checkout's source in every tool the repo runs: Vite, Vitest,
 * svelte-check (through tsconfig `paths`) and Node (the hook Playwright installs). A nested
 * worktree's `node_modules` links the names to another checkout, so a tool left to `node_modules`
 * loads a second copy of the editor.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { resolveConfig } from 'vite';
import { workspaceSources } from '../../../../../scripts/lib-alias.mjs';
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
		expect(mapped).toEqual(expected);
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
