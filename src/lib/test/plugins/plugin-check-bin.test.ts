import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
	manifestAbove,
	reportLines,
	resolveTarget,
	suiteProblem
} from '../../../../bin/aragonite-plugin-check.mjs';

// The bin's own logic; `verify-plugin-package.mjs` runs it whole over every packed plugin.
describe('aragonite-plugin-check', () => {
	it('accepts a suite listing named plugins and refuses anything else', () => {
		expect(suiteProblem({ plugins: [{ name: 'parrot' }] })).toBeNull();
		expect(suiteProblem(undefined)).toMatch(/not an object/);
		expect(suiteProblem({ plugins: [] })).toMatch(/lists no plugins/);
		expect(suiteProblem({ plugins: [{}] })).toMatch(/has no name/);
	});

	it('prints one tally per kit run', () => {
		const asserted = { status: 'asserted' };
		expect(
			reportLines({
				kinds: [{ kind: 'parrot', cells: [asserted, asserted, { status: 'boundary' }] }],
				containers: [{ kind: 'box', cells: [asserted] }],
				inline: [{ prefix: '[^', cells: [{ status: 'exempt' }] }]
			})
		).toEqual([
			'kind checkup, parrot: 2 asserted, 1 boundary',
			'container checkup, box: 1 asserted',
			'inline checkup, [^: 1 exempt'
		]);
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
