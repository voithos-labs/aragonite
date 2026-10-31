import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	GALLERY,
	changedPackages,
	isEditorRange,
	listingProblems,
	partitionEntries,
	readListing,
	registryProblem,
	renderTable,
	withTable
} from '../../../../scripts/plugins/listing.mjs';
import {
	failedCells,
	recorded,
	resultProblem,
	verifiedFrom
} from '../../../../scripts/plugins/check-listing.mjs';
import { bundledPluginDirs } from '../invariants/lint/scan-source';
import { pluginPackages } from '../../../../scripts/lib-alias.mjs';

const entry = (name: string, extra: Record<string, unknown> = {}) => ({
	package: name,
	repository: 'https://github.com/someone/aragonite-thing',
	editor: '^0.12.0',
	verified: null,
	...extra
});

describe('the listing on this tree', () => {
	it('holds its shape and lists every bundled plugin', () => {
		const entries = readListing();
		expect(listingProblems(entries)).toEqual([]);
		expect(entries.map((e) => e.package)).toEqual(
			bundledPluginDirs().map((dir) => `@voithos-labs/aragonite-${dir}`)
		);
	});

	it('the gallery table is the one the listing renders', async () => {
		const page = readFileSync(GALLERY, 'utf8');
		expect(
			await withTable(page, readListing()),
			'run node scripts/plugins/listing.mjs --write'
		).toBe(page);
	});

	it('the plugin workflow checks every bundled plugin and the template', () => {
		const workflow = readFileSync('.github/workflows/plugins.yml', 'utf8');
		const matrix = /plugin:\s*\[([^\]]*)\]/.exec(workflow)?.[1] ?? '';
		const listed = matrix.split(',').map((item) => item.trim());
		expect(listed).toEqual([...bundledPluginDirs(), 'template']);
	});
});

describe('the listing schema', () => {
	it.each([
		['an npm name it can not be', [entry('Not A Name')]],
		[
			'a repository that is no https URL',
			[entry('aragonite-a', { repository: 'git@github.com:a/b' })]
		],
		['an editor range npm would not read', [entry('aragonite-a', { editor: 'latest' })]],
		['a field the schema does not know', [entry('aragonite-a', { stars: 5 })]],
		[
			'a missing verified field',
			[{ package: 'aragonite-a', repository: entry('x').repository, editor: '1.0.0' }]
		],
		[
			'a failed result without its cells',
			[entry('aragonite-a', { verified: { editor: '0.12.0', plugin: '1.0.0', result: 'fail' } })]
		],
		['an entry listed twice', [entry('aragonite-a'), entry('aragonite-a')]],
		['entries out of order', [entry('aragonite-b'), entry('aragonite-a')]]
	])('refuses %s', (_, entries) => {
		expect(listingProblems(entries)).toHaveLength(1);
	});

	it('reads the ranges an author writes', () => {
		for (const range of ['0.12.0', '^0.12.0', '~0.12.1', '>=0.11.5 <1.0.0', '^0.12.0 || ^1.0.0']) {
			expect(isEditorRange(range), range).toBe(true);
		}
		expect(isEditorRange('0.12')).toBe(false);
	});
});

describe('a pull request against the listing', () => {
	it('checks the entries it adds or changes, and none it leaves alone', () => {
		const before = [entry('aragonite-a'), entry('aragonite-b')];
		const after = [
			entry('aragonite-a'),
			entry('aragonite-b', { editor: '^0.13.0' }),
			entry('aragonite-c')
		];
		expect(changedPackages(before, after)).toEqual(['aragonite-b', 'aragonite-c']);
	});

	// The release pull request lists bundled plugins npm doesn't have yet, so none may go to npm.
	it('checks every bundled plugin from the packed tarballs and only the rest from npm', () => {
		const names = readListing().map((e) => e.package);
		expect(partitionEntries([...names, 'aragonite-memo'], pluginPackages())).toEqual({
			bundled: bundledPluginDirs(),
			outside: ['aragonite-memo']
		});
	});

	it('wants the plugin keyword and the same repository on npm', () => {
		const listed = entry('aragonite-a');
		const repository = { url: 'git+https://github.com/someone/aragonite-thing.git' };
		expect(registryProblem(listed, { keywords: ['aragonite-plugin'], repository })).toBeNull();
		expect(registryProblem(listed, { keywords: [], repository })).toMatch(/keyword/);
		expect(
			registryProblem(listed, {
				keywords: ['aragonite-plugin'],
				repository: 'https://github.com/other/fork'
			})
		).toContain('names https://github.com/other/fork on npm');
	});
});

describe('recording a check', () => {
	const failure =
		'plugin conformance failed for "memo":\n' +
		'  - kind conformance failed for "memo":\n' +
		'      - rawWrite: "memo" declares no rawWrite\n' +
		'        breaks: any bytes written into your block leave the blocks around it alone (plugin-testing.md#x)\n' +
		'  - container conformance failed for "box":\n' +
		'      - ancestry: stale\n' +
		'        breaks: an edit deep inside rebuilds every container above it (plugin-testing.md#y)';

	it('names each broken cell by its kind, or the first problem when no cell broke', () => {
		expect(failedCells(failure)).toEqual(['memo: rawWrite', 'box: ancestry']);
		expect(
			failedCells('plugin conformance failed for "a":\n  - container kind "box" has no profile')
		).toEqual(['container kind "box" has no profile']);
	});

	it('refuses a result file that is not a check result, since a plugin ran in the job that wrote it', () => {
		const pass = {
			package: 'aragonite-a',
			version: '1.0.0',
			editor: '0.12.0',
			result: 'pass',
			failures: null
		};
		expect(resultProblem(pass)).toBeNull();
		expect(resultProblem({ ...pass, result: 'verified!' })).toMatch(/unknown result/);
		expect(resultProblem({ ...pass, editor: '^0.12.0' })).toMatch(/editor/);
		expect(resultProblem({ ...pass, result: 'fail' })).toMatch(/failures/);
	});

	it('writes each result onto its entry and refuses one for a package nobody listed', () => {
		const result = {
			package: 'aragonite-a',
			version: '1.0.0',
			editor: '0.12.0',
			result: 'fail',
			failures: failure
		};
		const [written] = recorded([entry('aragonite-a')], [result]);
		expect(written.verified).toEqual(verifiedFrom(result));
		expect(written.verified?.failures).toEqual(['memo: rawWrite', 'box: ancestry']);
		expect(() => recorded([entry('aragonite-a')], [{ ...result, package: 'aragonite-z' }])).toThrow(
			/doesn't hold/
		);
	});

	it('shows each result in the gallery as what the check found on which release', () => {
		const rows = renderTable([
			entry('aragonite-a', { verified: { editor: '0.12.0', plugin: '1.0.0', result: 'pass' } }),
			entry('aragonite-b', {
				verified: { editor: '0.12.0', plugin: null, result: 'out-of-range' }
			}),
			entry('aragonite-c', {
				verified: { editor: '0.12.0', plugin: '1.0.0', result: 'fail', failures: ['c: undo'] }
			}),
			entry('aragonite-d')
		]);
		expect(rows).toContain('passed on 0.12.0');
		expect(rows).toContain('not checked on 0.12.0: its peer range leaves it out');
		expect(rows).toContain('failed on 0.12.0 (c: undo)');
		expect(rows).toContain('not checked yet');
	});
});

// The plugin check runs a plugin's code, so these hold in the workflow text where an edit would
// loosen them, not only in the comment that states them.
describe('the workflows that run a plugin', () => {
	const read = (file: string) => readFileSync(`.github/workflows/${file}`, 'utf8');
	const check = read('plugin-check.yml');

	it('runs the plugin in a job that holds no token', () => {
		const job = check.slice(check.indexOf('\n  check:\n'));
		expect(job).toMatch(/^ {4}permissions: \{\}$/m);
	});

	// An action gets the run's artifact and cache token, which the plugin's code could read from it,
	// so the job's one action (which has no post step) runs before the plugin does.
	it('runs no action after the plugin, in the job that runs it', () => {
		const start = check.indexOf('\n  check:\n') + 1;
		const end = check.slice(start).search(/\n {2}\w[\w-]*:\n/);
		const job = check.slice(start, end === -1 ? undefined : start + end);
		const actions = job.split('\n').filter((line) => /^\s*(- )?uses:/.test(line));
		expect(actions.map((line) => line.trim().replace(/@.*/, ''))).toEqual([
			'uses: actions/download-artifact'
		]);
		expect(job.indexOf('uses:')).toBeLessThan(job.indexOf('aragonite-plugin-check'));
	});

	it('installs the plugin with its install scripts off', () => {
		const installs = check.split('\n').filter((line) => /npm install --no-save/.test(line));
		expect(installs.length).toBeGreaterThan(0);
		expect(installs.every((line) => line.includes('--ignore-scripts'))).toBe(true);
	});

	it.each(['plugin-check.yml', 'plugins.yml', 'plugin-listing.yml'])(
		'%s never runs on pull_request_target',
		(file) => {
			const triggers = read(file).split('\njobs:')[0];
			expect(triggers).not.toMatch(/^ {2}pull_request_target:/m);
		}
	);

	// A listing run hands its results over as an artifact, so nothing here may write the repository.
	it.each([
		'.github/workflows/plugin-check.yml',
		'.github/workflows/plugins.yml',
		'.github/workflows/plugin-listing.yml',
		'templates/plugin/.github/workflows/ci.yml'
	])('%s asks for no write permission', (file) => {
		const grants = readFileSync(file, 'utf8')
			.split('\n')
			.filter((line) => /^\s*(permissions:\s*write-all|[\w-]+:\s*write)\s*(#.*)?$/.test(line));
		expect(grants).toEqual([]);
	});
});
