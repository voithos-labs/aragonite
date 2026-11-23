// @vitest-environment node
// The bin's exit codes over packages made for the test: 2 for nothing to check, 1 for a suite that
// fails, each with the result file a listing reads. `verify-plugin-package.mjs` holds exit 0.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resetEditorEnv } from '#lib/testing.js';
import { main } from '../../../../bin/aragonite-plugin-check.mjs';

const made: string[] = [];

/** A package named `name` in a folder of its own, publishing `suite` as `./conformance` if given. */
function packageOf(name: string, suite?: string): string {
	const dir = mkdtempSync(path.join(tmpdir(), 'plugin-check-exit-'));
	made.push(dir);
	const exports = suite === undefined ? {} : { exports: { './conformance': './conformance.mjs' } };
	writeFileSync(
		path.join(dir, 'package.json'),
		JSON.stringify({ name, version: '1.2.3', ...exports })
	);
	if (suite !== undefined) writeFileSync(path.join(dir, 'conformance.mjs'), suite);
	return dir;
}

afterEach(() => {
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
	resetEditorEnv();
	vi.restoreAllMocks();
});

describe('aragonite-plugin-check exit codes', () => {
	it.each([
		['publishes no ./conformance export', undefined, /publishes no \.\/conformance export/],
		[
			'holds a function that is no plugin value',
			'export default { plugin: function made() {} };',
			/holds no plugin value/
		],
		['lists no plugins', 'export default { plugins: [] };', /lists no plugins/]
	])('exits 2 for a package that %s', async (_name, suite, said) => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await main([packageOf('exit-two', suite)], process.cwd())).toBe(2);
		expect(error.mock.calls.flat().join('\n')).toMatch(said);
	});

	it('exits 1 for a suite that fails, and writes the rows it failed on', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const dir = packageOf('exit-one', "export default { plugins: [{ name: 'no-setup' }] };");
		const json = path.join(dir, 'result.json');
		expect(await main([dir, '--json', json], process.cwd())).toBe(1);
		const result = JSON.parse(readFileSync(json, 'utf8'));
		expect(result).toMatchObject({ package: 'exit-one', version: '1.2.3', result: 'fail' });
		expect(result.rows.filter((row: { status: string }) => row.status === 'failed')).not.toEqual(
			[]
		);
	});
});
