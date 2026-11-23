// @vitest-environment node
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { definePlugin } from '#lib/plugin.js';
import { parrotPlugin } from '#packages/parrot/src/index.js';
import {
	manifestAbove,
	resolveTarget,
	rowLines,
	runSuite,
	suiteProblem
} from '../../../../bin/aragonite-plugin-check.mjs';

// The bin's own logic; `verify-plugin-package.mjs` runs it whole over every packed plugin.
describe('aragonite-plugin-check', () => {
	it('accepts a plugin value or a suite listing named plugins, and refuses anything else', () => {
		expect(suiteProblem({ plugin: parrotPlugin() })).toBeNull();
		expect(suiteProblem({ plugins: [{ name: 'parrot' }] })).toBeNull();
		expect(suiteProblem(undefined)).toMatch(/not an object/);
		expect(suiteProblem({ plugin: { name: 'parrot' } })).toMatch(/holds no plugin value/);
		expect(suiteProblem({ plugins: [] })).toMatch(/lists no plugins/);
		expect(suiteProblem({ plugins: [{}] })).toMatch(/has no name/);
	});

	it('prints a line per row, its detail where it did not pass, then a count of each status', () => {
		const row = (status: string, check: string) => ({
			of: 'block',
			subject: 'parrot/parrot',
			check,
			status,
			detail: 'why'
		});
		expect(rowLines([row('passed', 'roundTrip'), row('unchecked', 'focus')])).toEqual([
			'passed parrot/parrot roundTrip',
			'unchecked parrot/parrot focus: why',
			'2 rows: 1 passed, 1 unchecked'
		]);
	});

	it('runs a plugin value through check, and a list of setup plugins through the old kits', async () => {
		const value = await runSuite({ plugin: parrotPlugin() });
		expect(value.result).toBe('pass');
		expect(value.rows.map((r) => `${r.subject} ${r.check}`)).toContain('parrot/parrot roundTrip');
		const empty = definePlugin({ name: 'bin-empty', setup: () => {} });
		// A setup plugin declaring no kind still installed, and the run says so in a row.
		expect(await runSuite({ plugins: [empty] })).toEqual({
			result: 'pass',
			rows: [
				{
					of: 'plugin',
					subject: 'bin-empty',
					check: 'install',
					status: 'passed',
					detail: 'installs'
				}
			],
			warnings: [],
			message: null
		});
		const failed = await runSuite({ plugins: [parrotPlugin()] });
		expect(failed.result).toBe('fail');
		expect(failed.rows.map((r) => r.detail)).toEqual([expect.stringMatching(/check\(plugin\)/)]);
	});

	it('checks the package a directory holds, or a name resolved from the working directory', () => {
		expect(resolveTarget('packages/parrot', path.resolve('.'))).toEqual({
			name: '@voithos-labs/aragonite-parrot',
			from: path.resolve('packages/parrot/package.json')
		});
		expect(resolveTarget('aragonite-thing', path.resolve('.')).name).toBe('aragonite-thing');
	});

	it("finds a plugin's manifest above any of its files, by name", () => {
		const file = path.resolve('packages/parrot/src/conformance.ts');
		expect(manifestAbove(file, '@voithos-labs/aragonite-parrot').version).toMatch(/^\d/);
		expect(() => manifestAbove(file, 'nobody')).toThrow(/no package.json named nobody/);
	});
});
