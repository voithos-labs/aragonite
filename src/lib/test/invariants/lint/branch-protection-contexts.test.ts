/**
 * The status-check lists in `scripts/release/branch-protection-contexts.mjs` match what the workflows
 * report, matrix jobs expanded the way GitHub names them: every ci.yml check is required or pending
 * its gate, never both and never neither, and no job hides a red behind `continue-on-error`. A
 * required context nothing reports leaves every PR waiting forever.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { collectFiles } from './scan-source';
import {
	CI_CONTEXTS,
	EXTERNAL_CONTEXTS,
	PENDING_GATE_CONTEXTS
} from '../../../../../scripts/release/branch-protection-contexts.mjs';

const WORKFLOWS = '.github/workflows';
const CI = 'ci.yml';
const APPLY_SCRIPT = path.resolve('scripts/release/apply-branch-protection.mjs');

// ── Reading a workflow ───────────────────────────────────────────────────────

const JOB_ID = /^ {2}([A-Za-z0-9_-]+):\s*$/;
const JOB_NAME = /^ {4}name:\s*(.+?)\s*$/;
const MATRIX_DIMENSION = /^ {8}([A-Za-z0-9_-]+):\s*\[(.+)\]\s*$/;
const MATRIX_KEYS_UNPARSED = /^ {8}(include|exclude):/;
const CONTINUE_ON_ERROR = /^ {4}continue-on-error:/;
const JOB_IF = /^ {4}if:/;
const CALLS_WORKFLOW = /^ {4}uses:\s*\.\/\.github\/workflows\/(\S+\.yml)\s*$/;

/** The `jobs:` mapping's own lines, ending at the next top-level key. */
function jobsBlock(yaml: string): string[] {
	const lines = yaml.split('\n');
	const start = lines.findIndex((line) => line === 'jobs:');
	if (start === -1) return [];
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((line) => /^[^\s#]/.test(line));
	return joinWrappedSequences(end === -1 ? rest : rest.slice(0, end));
}

/** A matrix list Prettier wrapped onto lines of its own, put back on its key's line. */
function joinWrappedSequences(lines: string[]): string[] {
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (/^ {8}[A-Za-z0-9_-]+:\s*$/.test(lines[i]) && lines[i + 1]?.trim().startsWith('[')) {
			let joined = lines[i].trimEnd() + ' ';
			while (i + 1 < lines.length) {
				const next = lines[++i].trim();
				joined += next;
				if (next.endsWith(']')) break;
			}
			out.push(joined.replace(/,\]$/, ']'));
		} else {
			out.push(lines[i]);
		}
	}
	return out;
}

function flowSequence(raw: string): string[] {
	return raw
		.split(',')
		.map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
		.filter((item) => item !== '');
}

/**
 * GitHub names a matrix check `<job> (<v1>, <v2>)`, one value per dimension in declaration
 * order, so the contexts a run reports are the product of the inline sequences.
 */
function expand(label: string, dimensions: string[][]): string[] {
	if (dimensions.length === 0) return [label];
	let combinations: string[][] = [[]];
	for (const values of dimensions) {
		combinations = combinations.flatMap((prefix) => values.map((value) => [...prefix, value]));
	}
	return combinations.map((values) => `${label} (${values.join(', ')})`);
}

interface JobChecks {
	names: string[];
	/** A matrix job with a job-level `if:`, which reports one bare check when skipped. */
	skipsWholeMatrix: boolean;
	continuesOnError: boolean;
	/** The workflow file a job calls, whose jobs report under the caller's name. */
	calls: string | null;
}

/** Each job's check names, matrix jobs expanded. */
function readJobs(yaml: string): JobChecks[] {
	const jobs: JobChecks[] = [];
	let label: string | null = null;
	let dimensions: string[][] = [];
	let conditional = false;
	let continuesOnError = false;
	let calls: string | null = null;
	const flush = () => {
		if (label === null) return;
		const skipsWholeMatrix = conditional && dimensions.length > 0;
		jobs.push({ names: expand(label, dimensions), skipsWholeMatrix, continuesOnError, calls });
	};
	for (const line of jobsBlock(yaml)) {
		const job = JOB_ID.exec(line);
		if (job) {
			flush();
			label = job[1];
			dimensions = [];
			conditional = false;
			continuesOnError = false;
			calls = null;
			continue;
		}
		if (label === null) continue;
		if (JOB_IF.test(line)) conditional = true;
		if (CONTINUE_ON_ERROR.test(line)) continuesOnError = true;
		calls = CALLS_WORKFLOW.exec(line)?.[1] ?? calls;
		const name = JOB_NAME.exec(line);
		if (name) label = name[1].replace(/^['"]|['"]$/g, '');
		if (MATRIX_KEYS_UNPARSED.test(line)) {
			throw new Error(`${line.trim()} in job "${label}": this reader expands inline lists only`);
		}
		const dimension = MATRIX_DIMENSION.exec(line);
		if (dimension) dimensions.push(flowSequence(dimension[2]));
	}
	flush();
	return jobs;
}

/** Every check name the workflow reports; a job calling a reusable workflow reports each of its
 *  jobs as `<caller> / <job>`, so `calleeYaml` reads the called file. */
export function checkNames(
	yaml: string,
	calleeYaml?: (file: string) => string | undefined
): string[] {
	return readJobs(yaml).flatMap((job) => {
		const callee = job.calls === null ? undefined : calleeYaml?.(job.calls);
		if (callee === undefined) return job.names;
		const inner = checkNames(callee, calleeYaml);
		return job.names.flatMap((name) => inner.map((child) => `${name} / ${child}`));
	});
}

/** Required matrix jobs a job-level `if:` can skip whole, leaving their shard checks unreported. */
export function wholeMatrixSkips(yaml: string, required: readonly string[]): string[] {
	return readJobs(yaml)
		.filter((job) => job.skipsWholeMatrix && job.names.some((name) => required.includes(name)))
		.map((job) => job.names[0]);
}

/** Whether a trigger filters on paths, which skips the whole workflow and reports no check. */
export function filtersPaths(yaml: string): boolean {
	const triggers = yaml.split(/^jobs:/m)[0];
	return /^ {4}paths(-ignore)?:/m.test(triggers);
}

/** Jobs whose red the run would report as green. */
export function redHidingJobs(yaml: string): string[] {
	return readJobs(yaml)
		.filter((job) => job.continuesOnError)
		.map((job) => job.names[0]);
}

// ── Holding the lists to the workflows ───────────────────────────────────────

/** Reported checks that neither list names. */
export function unlistedChecks(
	reported: readonly string[],
	...lists: readonly string[][]
): string[] {
	return reported.filter((name) => !lists.some((list) => list.includes(name)));
}

/** Listed contexts no workflow reports. */
export function unreportedContexts(
	listed: readonly string[],
	reported: readonly string[]
): string[] {
	return listed.filter((name) => !reported.includes(name));
}

/** Declared externals the named workflow does not report: a missing file, a renamed job. */
export function unreportedExternals(
	declared: Map<string, string[]>,
	reported: Map<string, string[]>
): string[] {
	const hits: string[] = [];
	for (const [file, names] of declared) {
		const actual = reported.get(file);
		if (actual === undefined) {
			hits.push(`${file}: no such workflow`);
			continue;
		}
		for (const name of names) if (!actual.includes(name)) hits.push(`${file}: ${name}`);
	}
	return hits;
}

/** Required checks a workflow reports without being declared as that check's reporter. */
export function undeclaredReporters(
	required: string[],
	declared: Map<string, string[]>,
	reported: Map<string, string[]>
): string[] {
	const hits: string[] = [];
	for (const [file, names] of reported) {
		for (const name of names) {
			if (!required.includes(name)) continue;
			if (declared.get(file)?.includes(name)) continue;
			hits.push(`${file}: ${name}`);
		}
	}
	return hits;
}

const workflowYaml = new Map(
	collectFiles(WORKFLOWS, { extensions: ['.yml'] }).map((file): [string, string] => [
		path.basename(file),
		readFileSync(file, 'utf8')
	])
);
const workflowChecks = new Map(
	[...workflowYaml].map(([file, yaml]): [string, string[]] => [
		file,
		checkNames(yaml, (callee) => workflowYaml.get(callee))
	])
);
const ci = workflowChecks.get(CI) ?? [];
const declaredExternal = new Map<string, string[]>(Object.entries(EXTERNAL_CONTEXTS));
const required = [...CI_CONTEXTS, ...[...declaredExternal.values()].flat()];
const pending = [...PENDING_GATE_CONTEXTS];
const everyReported = [...workflowChecks.values()].flat();

// ── The gate ─────────────────────────────────────────────────────────────────

describe('branch protection ↔ workflow check names', () => {
	it('every ci.yml check is required or pending its gate', () => {
		const unlisted = unlistedChecks(ci, CI_CONTEXTS, pending);
		expect(
			unlisted,
			`${CI} reports checks neither CI_CONTEXTS nor PENDING_GATE_CONTEXTS names: ${unlisted.join(', ')}`
		).toEqual([]);
		expect(
			unreportedContexts(CI_CONTEXTS, ci),
			`CI_CONTEXTS names checks ${CI} never reports, which leaves every PR waiting forever`
		).toEqual([]);
	});

	it('a pending check is reported somewhere and required nowhere', () => {
		expect(
			unreportedContexts(pending, everyReported),
			'PENDING_GATE_CONTEXTS names checks no workflow reports'
		).toEqual([]);
		expect(pending.filter((name) => required.includes(name))).toEqual([]);
	});

	it('a workflow with a pending check lists every check it reports', () => {
		for (const [file, names] of workflowChecks) {
			if (file === CI || !names.some((name) => pending.includes(name))) continue;
			expect(unlistedChecks(names, declaredExternal.get(file) ?? [], pending), file).toEqual([]);
		}
	});

	it('every declared external is reported by the workflow named for it', () => {
		const unreported = unreportedExternals(declaredExternal, workflowChecks);
		expect(
			unreported,
			`EXTERNAL_CONTEXTS names a check its workflow never reports, which blocks every PR forever: ${unreported.join(', ')}`
		).toEqual([]);
		expect(
			[...declaredExternal.values()].flat().filter((name) => ci.includes(name)),
			'a name declared external that ci.yml also reports would be required twice, satisfiable from either side'
		).toEqual([]);
	});

	it('applies the required lists and never the pending one', () => {
		const contexts = /contexts:\s*(.+)$/m.exec(readFileSync(APPLY_SCRIPT, 'utf8'))?.[1] ?? '';
		expect(contexts).toContain('CI_CONTEXTS');
		expect(contexts).toContain('EXTERNAL_CONTEXTS');
		expect(contexts).not.toContain('PENDING_GATE_CONTEXTS');
	});

	it('no job hides a red behind continue-on-error', () => {
		const hiding = [...workflowYaml].flatMap(([file, yaml]) =>
			redHidingJobs(yaml).map((job) => `${file}: ${job}`)
		);
		expect(
			hiding,
			'a continue-on-error job reports red as green; leave its checks out of the required lists instead'
		).toEqual([]);
	});

	it('no required matrix job can be skipped whole', () => {
		expect(
			[...workflowYaml].flatMap(([file, yaml]) =>
				wholeMatrixSkips(yaml, required).map((job) => `${file}: ${job}`)
			),
			'a matrix job skipped by a job-level if reports one check under its bare name, so its required per-shard checks never arrive; condition its steps instead'
		).toEqual([]);
	});

	it('no workflow reporting a required check filters its triggers on paths', () => {
		const filtering = [...workflowChecks]
			.filter(([, names]) => names.some((name) => required.includes(name)))
			.filter(([file]) => filtersPaths(workflowYaml.get(file) ?? ''))
			.map(([file]) => file);
		expect(
			filtering,
			'a path filter skips the whole run, so its required checks never report; skip steps instead'
		).toEqual([]);
	});

	it('no undeclared workflow reports a check name the rule requires', () => {
		const outsideCi = new Map([...workflowChecks].filter(([file]) => file !== CI));
		const colliding = undeclaredReporters(required, declaredExternal, outsideCi);
		expect(
			colliding,
			`a second workflow reporting a required check satisfies the rule from outside the PR entry point: ${colliding.join(', ')}`
		).toEqual([]);
	});
});

// ── Non-vacuity self-tests ───────────────────────────────────────────────────
// A reader that parses nothing would pass every direction above on empty sets.

describe('branch-protection context readers: self-tests', () => {
	it('finds the real job set, matrix shards expanded', () => {
		expect(ci).toContain('unit');
		expect(ci.filter((name) => name.startsWith('e2e '))).toHaveLength(4);
		expect(ci.filter((name) => name.startsWith('e2e-firefox ')).length).toBeGreaterThan(1);
		expect(ci.length).toBe(CI_CONTEXTS.length + pending.filter((n) => ci.includes(n)).length);
	});

	it('names the jobs a red would hide in, and a matrix a job-level if skips whole', () => {
		const yaml = [
			'jobs:',
			'  unit:',
			'    runs-on: ubuntu-latest',
			'  engine:',
			'    continue-on-error: true',
			'    if: false',
			'    strategy:',
			'      matrix:',
			"        shard: ['1/2', '2/2']"
		].join('\n');
		expect(checkNames(yaml)).toEqual(['unit', 'engine (1/2)', 'engine (2/2)']);
		expect(redHidingJobs(yaml)).toEqual(['engine (1/2)']);
		expect(wholeMatrixSkips(yaml, ['engine (2/2)'])).toEqual(['engine (1/2)']);
		expect(wholeMatrixSkips(yaml, ['unit'])).toEqual([]);
	});

	it('names a reusable workflow’s jobs under the matrix job that calls it', () => {
		const caller = [
			'jobs:',
			'  check:',
			'    strategy:',
			'      matrix:',
			'        plugin: [a, b]',
			'    uses: ./.github/workflows/inner.yml'
		].join('\n');
		const inner = 'jobs:\n  pack:\n    runs-on: x\n  run:\n    runs-on: x\n';
		expect(checkNames(caller, (file) => (file === 'inner.yml' ? inner : undefined))).toEqual([
			'check (a) / pack',
			'check (a) / run',
			'check (b) / pack',
			'check (b) / run'
		]);
	});

	it('sees a path filter on a trigger, not on a step', () => {
		expect(filtersPaths('on:\n  push:\n    paths-ignore: [docs/**]\njobs:\n  a:\n')).toBe(true);
		expect(filtersPaths('on:\n  push:\njobs:\n  a:\n    paths: x\n')).toBe(false);
	});

	it('reads a matrix list Prettier wrapped onto its own lines', () => {
		const wrapped = ['jobs:', '  e2e:', '    strategy:', '      matrix:', '        shard:'];
		wrapped.push('          [', "            '1/2',", "            '2/2'", '          ]');
		expect(checkNames(wrapped.join('\n'))).toEqual(['e2e (1/2)', 'e2e (2/2)']);
	});

	it('follows a job rename rather than the hand-written list', () => {
		const renamed = (workflowYaml.get(CI) ?? '').replace(/^ {2}unit:$/m, '  static:');
		expect(checkNames(renamed)).toContain('static');
		expect(checkNames(renamed)).not.toContain('unit');
	});

	it('reads a display name over the job id, and a two-dimension matrix', () => {
		const yaml = [
			'jobs:',
			'  build:',
			'    name: Build the thing',
			'    runs-on: ubuntu-latest',
			'  matrixed:',
			'    strategy:',
			'      matrix:',
			"        os: ['ubuntu', 'macos']",
			'        node: [22, 24]',
			'  plain:',
			'    runs-on: ubuntu-latest',
			'permissions:',
			'  contents: read',
			'  never-a-job: true'
		].join('\n');
		expect(checkNames(yaml)).toEqual([
			'Build the thing',
			'matrixed (ubuntu, 22)',
			'matrixed (ubuntu, 24)',
			'matrixed (macos, 22)',
			'matrixed (macos, 24)',
			'plain'
		]);
	});

	it('refuses a matrix shape it cannot expand rather than under-reporting', () => {
		const yaml = ['jobs:', '  e2e:', '    strategy:', '      matrix:', '        include:'].join(
			'\n'
		);
		expect(() => checkNames(yaml)).toThrow(/include/);
	});

	it('names a reported check no list carries, and a listed one nothing reports', () => {
		expect(unlistedChecks(['unit', 'e2e (1/2)'], ['unit'], ['e2e (1/2)'])).toEqual([]);
		expect(unlistedChecks(['unit', 'e2e (1/2)'], ['unit'], [])).toEqual(['e2e (1/2)']);
		expect(unreportedContexts(['unit', 'gone'], ['unit'])).toEqual(['gone']);
	});

	it('reds on an external declared for a workflow that does not report it', () => {
		const declared = new Map([['cla.yml', ['cla']]]);
		expect(unreportedExternals(declared, new Map([['cla.yml', ['cla']]]))).toEqual([]);
		expect(unreportedExternals(declared, new Map([['cla.yml', ['signature']]]))).toEqual([
			'cla.yml: cla'
		]);
		expect(unreportedExternals(declared, new Map())).toEqual(['cla.yml: no such workflow']);
	});

	it('reds on a required name an undeclared workflow reports, pair by pair', () => {
		const declared = new Map([['cla.yml', ['cla']]]);
		const names = ['unit', 'cla'];
		expect(undeclaredReporters(names, declared, new Map([['cla.yml', ['cla']]]))).toEqual([]);
		expect(undeclaredReporters(names, declared, new Map([['cla.yml', ['cla', 'unit']]]))).toEqual([
			'cla.yml: unit'
		]);
		expect(undeclaredReporters(names, declared, new Map([['deploy.yml', ['cla']]]))).toEqual([
			'deploy.yml: cla'
		]);
	});
});
