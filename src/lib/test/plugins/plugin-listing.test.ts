import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	GALLERY,
	addedPackages,
	checksProblems,
	isEditorRange,
	listingProblems,
	partitionEntries,
	readChecks,
	readListing,
	recordProblem,
	registryProblem,
	renderTable,
	repositoryUrl,
	withTable
} from '../../../../scripts/plugins/listing.mjs';
import {
	failedCells,
	recordFrom,
	recorded,
	resultProblem
} from '../../../../scripts/plugins/check-listing.mjs';
import { writeGrants } from '../harness/workflow-grants';
import { bundledPluginDirs } from '../invariants/lint/scan-source';
import { TEMPLATE_DIR, pluginPackages } from '../../../../scripts/workspace.mjs';

const CORE = '@voithos-labs/aragonite';

/** A manifest as npm answers it for a plugin that may be listed. */
const manifest = (extra: Record<string, unknown> = {}) => ({
	keywords: ['aragonite-plugin'],
	repository: { type: 'git', url: 'git+https://github.com/someone/aragonite-thing.git' },
	peerDependencies: { [CORE]: '^0.12.0' },
	...extra
});

const record = (extra: Record<string, unknown> = {}) => ({
	version: '1.0.0',
	repository: 'https://github.com/someone/aragonite-thing',
	peer: '^0.12.0',
	editor: '0.12.0',
	result: 'pass' as const,
	...extra
});

describe('the listing on this tree', () => {
	it('holds its shape and lists every bundled plugin', () => {
		const names = readListing();
		expect(listingProblems(names)).toEqual([]);
		expect(names).toEqual(bundledPluginDirs().map((dir) => `@voithos-labs/aragonite-${dir}`));
	});

	it("holds a check's record for listed plugins only, each in its shape", () => {
		expect(checksProblems(readChecks(), readListing())).toEqual([]);
	});

	it('the gallery table is the one the listing and its records render', () => {
		const page = readFileSync(GALLERY, 'utf8');
		expect(
			withTable(page, readListing(), readChecks()),
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
		['an npm name it can not be', ['Not A Name']],
		['an entry that is no name', [{ package: 'aragonite-a' }]],
		['a name listed twice', ['aragonite-a', 'aragonite-a']],
		['names out of order', ['aragonite-b', 'aragonite-a']]
	])('refuses %s', (_, names) => {
		expect(listingProblems(names)).toHaveLength(1);
	});

	it.each([
		['a repository that is no https URL', record({ repository: 'git@github.com:a/b' })],
		['a peer range npm would not read', record({ peer: 'latest' })],
		['an editor that is a range, not the release checked', record({ editor: '^0.12.0' })],
		['a field the record does not know', record({ stars: 5 })],
		['a failed result without its cells', record({ result: 'fail' })]
	])('refuses a record with %s', (_, problem) => {
		expect(recordProblem(record())).toBeNull();
		expect(recordProblem(problem)).not.toBeNull();
	});

	it('refuses a record for a package the listing no longer holds', () => {
		expect(checksProblems({ 'aragonite-a': record() }, ['aragonite-a'])).toEqual([]);
		expect(checksProblems({ 'aragonite-a': record() }, [])).toEqual([
			"aragonite-a has a record but isn't listed; run node scripts/plugins/listing.mjs --write"
		]);
	});

	it('reads the ranges an author writes', () => {
		for (const range of ['0.12.0', '^0.12.0', '~0.12.1', '>=0.11.5 <1.0.0', '^0.12.0 || ^1.0.0']) {
			expect(isEditorRange(range), range).toBe(true);
		}
		expect(isEditorRange('0.12')).toBe(false);
	});
});

describe('a pull request against the listing', () => {
	it('checks the names it adds, and none it leaves alone or takes away', () => {
		expect(addedPackages(['aragonite-a', 'aragonite-b'], ['aragonite-a', 'aragonite-c'])).toEqual([
			'aragonite-c'
		]);
	});

	// The release pull request lists bundled plugins npm doesn't have yet, so none may go to npm.
	it('checks every bundled plugin from the packed tarballs and only the rest from npm', () => {
		expect(partitionEntries([...readListing(), 'aragonite-memo'], pluginPackages())).toEqual({
			bundled: bundledPluginDirs(),
			outside: ['aragonite-memo']
		});
	});

	it.each([
		['the plugin keyword', manifest({ keywords: [] }), /keyword/],
		['a repository', manifest({ repository: undefined }), /repository/],
		[
			'a repository the gallery can link',
			manifest({ repository: 'https://example.com/x' }),
			/repository/
		],
		['a peer on the editor', manifest({ peerDependencies: {} }), /peer/],
		['a peer range npm reads', manifest({ peerDependencies: { [CORE]: 'next' } }), /peer/]
	])('wants %s in the package npm has', (_, published, problem) => {
		expect(registryProblem('aragonite-a', manifest())).toBeNull();
		expect(registryProblem('aragonite-a', published)).toMatch(problem);
	});

	it('reads the repository in any spelling npm accepts', () => {
		const url = 'https://github.com/someone/thing';
		for (const spelling of [
			url,
			`${url}/`,
			'git+https://github.com/someone/thing.git',
			'git+ssh://git@github.com/someone/thing.git',
			'git@github.com:someone/thing.git',
			'github:someone/thing',
			'someone/thing'
		]) {
			expect(repositoryUrl({ url: spelling }), spelling).toBe(url);
			expect(repositoryUrl(spelling), spelling).toBe(url);
		}
		expect(repositoryUrl('gitlab:someone/thing')).toBe('https://gitlab.com/someone/thing');
	});

	// An author who never edits the template's placeholder can't be listed with it.
	it("refuses the template's repository placeholder", () => {
		const template = JSON.parse(readFileSync(`${TEMPLATE_DIR}/package.json`, 'utf8'));
		expect(repositoryUrl(template.repository)).toBeNull();
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
	const result = (extra: Record<string, unknown> = {}) => ({
		package: 'aragonite-a',
		version: '1.0.0',
		editor: '0.12.0',
		result: 'pass',
		failures: null,
		...extra
	});

	it('names each broken cell by its kind, or the first problem when no cell broke', () => {
		expect(failedCells(failure)).toEqual(['memo: rawWrite', 'box: ancestry']);
		expect(
			failedCells('plugin conformance failed for "a":\n  - container kind "box" has no profile')
		).toEqual(['container kind "box" has no profile']);
	});

	it('refuses a result file that is not a check result, since a plugin ran in the job that wrote it', () => {
		expect(resultProblem(result())).toBeNull();
		expect(resultProblem(result({ result: 'verified!' }))).toMatch(/unknown result/);
		expect(resultProblem(result({ editor: '^0.12.0' }))).toMatch(/editor/);
		expect(resultProblem(result({ version: '1.0.0" && curl x' }))).toMatch(/version/);
		expect(resultProblem(result({ result: 'fail' }))).toMatch(/failures/);
	});

	it('records each result beside the repository and peer range its own manifest names', () => {
		const asked: string[] = [];
		const manifestOf = (name: string, version: string) => {
			asked.push(`${name}@${version}`);
			return manifest({
				repository: 'github:someone/moved',
				peerDependencies: { [CORE]: '>=0.11.0' }
			});
		};
		const fromManifest = { repository: 'https://github.com/someone/moved', peer: '>=0.11.0' };
		const checks = recorded(
			['aragonite-a', 'aragonite-b', 'aragonite-c'],
			{ 'aragonite-c': record({ editor: '0.11.0' }) },
			[
				result({ result: 'fail', failures: failure }),
				result({ package: 'aragonite-b', version: null, result: 'out-of-range' })
			],
			manifestOf
		);

		expect(checks['aragonite-a']).toEqual(
			record({ ...fromManifest, result: 'fail', failures: ['memo: rawWrite', 'box: ancestry'] })
		);
		expect(checks['aragonite-b']).toEqual(
			record({ ...fromManifest, version: null, result: 'out-of-range' })
		);
		expect(checks['aragonite-c'].editor).toBe('0.11.0');
		// An out-of-range check installed nothing, so the newest version's manifest speaks for it.
		expect(asked).toEqual(['aragonite-a@1.0.0', 'aragonite-b@latest']);
	});

	it('refuses a result for a package nobody listed, or one whose manifest lost its keyword', () => {
		expect(() => recorded([], {}, [result()], () => manifest())).toThrow(/doesn't hold/);
		expect(() => recordFrom(result(), manifest({ keywords: [] }))).toThrow(/keyword/);
	});

	it('shows each recorded result in the gallery, and no row for a name not checked yet', () => {
		const table = renderTable(['aragonite-a', 'aragonite-b', 'aragonite-c', 'aragonite-d'], {
			'aragonite-a': record(),
			'aragonite-b': record({ version: null, result: 'out-of-range' }),
			'aragonite-c': record({ result: 'fail', failures: ['c: undo'] })
		});
		expect(table).toContain(
			'| [repository](https://github.com/someone/aragonite-thing) | `^0.12.0` |'
		);
		expect(table).toContain('passed on 0.12.0');
		expect(table).toContain('not checked on 0.12.0: its peer range leaves it out');
		expect(table).toContain('failed on 0.12.0 (c: undo)');
		expect(table).not.toContain('aragonite-d');
	});
});

// The plugin check runs a plugin's code, so these hold in the workflow text where an edit would
// loosen them, not only in the comment that states them.
describe('the workflows that run a plugin', () => {
	const read = (file: string) => readFileSync(`.github/workflows/${file}`, 'utf8');
	const check = read('plugin-check.yml');
	// The `check` job alone, up to the next job's key.
	const start = check.indexOf('\n  check:\n') + 1;
	const end = check.slice(start).search(/\n {2}\w[\w-]*:\n/);
	const job = check.slice(start, end === -1 ? undefined : start + end);

	it('runs the plugin in a job that holds no token', () => {
		expect(job).toMatch(/^ {4}permissions: \{\}$/m);
	});

	// An action gets the run's artifact and cache token, which the plugin's code could read from it,
	// so the job's one action (which has no post step) runs before the plugin does.
	it('runs no action after the plugin, in the job that runs it', () => {
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
		`${TEMPLATE_DIR}/.github/workflows/ci.yml`
	])('%s asks for no write permission', (file) => {
		expect(writeGrants(readFileSync(file, 'utf8'))).toEqual([]);
	});
});
