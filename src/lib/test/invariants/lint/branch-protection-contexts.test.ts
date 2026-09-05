/**
 * The required status-check contexts in `scripts/apply-branch-protection.mjs` come in two halves:
 * ci.yml's job ids, each matrix job expanded the way GitHub names its checks, and the externals
 * declared there against the workflow reporting each one. Hand-kept, the list rots in two silent
 * directions: a context nothing reports leaves every PR waiting forever, and a dropped one leaves
 * a job running while gating nothing. Neither shows before the flip to public, since the API
 * plan-gates protection on a private free-plan repo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const WORKFLOWS = path.resolve('.github/workflows');
const CI = 'ci.yml';
const SCRIPT = path.resolve('scripts/apply-branch-protection.mjs');

// ── ci.yml ───────────────────────────────────────────────────────────────────

const JOB_ID = /^ {2}([A-Za-z0-9_-]+):\s*$/;
const JOB_NAME = /^ {4}name:\s*(.+?)\s*$/;
const MATRIX_DIMENSION = /^ {8}([A-Za-z0-9_-]+):\s*\[(.+)\]\s*$/;
const MATRIX_KEYS_UNPARSED = /^ {8}(include|exclude):/;

/** The `jobs:` mapping's own lines, ending at the next top-level key. */
function jobsBlock(yaml: string): string[] {
	const lines = yaml.split('\n');
	const start = lines.findIndex((line) => line === 'jobs:');
	if (start === -1) return [];
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((line) => /^[^\s#]/.test(line));
	return end === -1 ? rest : rest.slice(0, end);
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

/** Every check name the workflow reports, matrix jobs expanded. */
export function checkNames(yaml: string): string[] {
	const names: string[] = [];
	let label: string | null = null;
	let dimensions: string[][] = [];
	const flush = () => {
		if (label !== null) names.push(...expand(label, dimensions));
	};
	for (const line of jobsBlock(yaml)) {
		const job = JOB_ID.exec(line);
		if (job) {
			flush();
			label = job[1];
			dimensions = [];
			continue;
		}
		if (label === null) continue;
		const name = JOB_NAME.exec(line);
		if (name) label = name[1].replace(/^['"]|['"]$/g, '');
		if (MATRIX_KEYS_UNPARSED.test(line)) {
			throw new Error(`${line.trim()} in job "${label}" — this reader expands inline lists only`);
		}
		const dimension = MATRIX_DIMENSION.exec(line);
		if (dimension) dimensions.push(flowSequence(dimension[2]));
	}
	flush();
	return names;
}

// ── The protection rule ──────────────────────────────────────────────────────

/** Single-quoted strings in a slice of the script, `//` comments dropped first. */
function quotedStrings(source: string): string[] {
	return [...source.replace(/\/\/.*$/gm, '').matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

/** The `CI_CONTEXTS` array: the half of the rule ci.yml itself reports. */
export function ciContexts(script: string): string[] {
	const array = /const CI_CONTEXTS = \[([^\]]*)\]/.exec(script);
	if (array === null) throw new Error('apply-branch-protection.mjs declares no CI_CONTEXTS array');
	return quotedStrings(array[1]);
}

/** The `EXTERNAL_CONTEXTS` map: workflow file → the checks it is trusted to report. */
export function externalContexts(script: string): Map<string, string[]> {
	const block = /const EXTERNAL_CONTEXTS = \{([\s\S]*?)\n\};/.exec(script);
	if (block === null) {
		throw new Error('apply-branch-protection.mjs declares no EXTERNAL_CONTEXTS map');
	}
	const declared = new Map<string, string[]>();
	for (const line of block[1].replace(/\/\/.*$/gm, '').split('\n')) {
		const entry = /^\s*'([^']+)':\s*\[([^\]]*)\]/.exec(line);
		if (entry !== null) declared.set(entry[1], quotedStrings(entry[2]));
	}
	return declared;
}

/** Declared externals the named workflow does not report — a missing file, a renamed job. */
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

const workflowChecks = new Map(
	readdirSync(WORKFLOWS)
		.filter((file) => file.endsWith('.yml'))
		.map((file): [string, string[]] => [
			file,
			checkNames(readFileSync(path.join(WORKFLOWS, file), 'utf8'))
		])
);
const ci = workflowChecks.get(CI) ?? [];
const script = readFileSync(SCRIPT, 'utf8');
const declaredCi = ciContexts(script);
const declaredExternal = externalContexts(script);
const required = [...declaredCi, ...[...declaredExternal.values()].flat()];

// ── The gate ─────────────────────────────────────────────────────────────────

describe('branch protection ↔ workflow check names', () => {
	it('requires exactly the checks ci.yml reports', () => {
		expect(
			[...declaredCi].sort(),
			`CI_CONTEXTS in ${path.basename(SCRIPT)} and ${CI}'s job names have diverged — a context ci.yml never reports blocks every PR forever, and a job with no context gates nothing`
		).toEqual([...ci].sort());
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

	it('no undeclared workflow reports a check name the rule requires', () => {
		const outsideCi = new Map([...workflowChecks].filter(([file]) => file !== CI));
		const colliding = undeclaredReporters(required, declaredExternal, outsideCi);
		expect(
			colliding,
			`a second workflow reporting a required check satisfies the rule from outside the PR door: ${colliding.join(', ')}`
		).toEqual([]);
	});
});

// ── Non-vacuity self-tests ───────────────────────────────────────────────────
// A reader that parses nothing makes both directions above pass on two empty sets, which is
// the failure this census exists to prevent.

describe('branch-protection context readers — self-tests', () => {
	it('finds the real job set, matrix shards expanded', () => {
		expect(ci.length).toBeGreaterThan(4);
		expect(ci).toContain('unit');
		expect(ci.filter((name) => name.startsWith('e2e '))).toHaveLength(4);
		expect(declaredCi.length).toBe(ci.length);
		expect(declaredExternal.get('cla.yml')).toEqual(['cla']);
	});

	it('follows a job rename rather than the hand-written list', () => {
		const renamed = readFileSync(path.join(WORKFLOWS, CI), 'utf8').replace(
			/^ {2}unit:$/m,
			'  static:'
		);
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

	it('reads both halves of the rule, comments dropped, and refuses a missing one', () => {
		expect(
			ciContexts("const CI_CONTEXTS = [\n\t// a note\n\t'unit',\n\t'e2e (1/4)' // trailing\n]")
		).toEqual(['unit', 'e2e (1/4)']);
		expect(() => ciContexts('const protection = {};')).toThrow(/CI_CONTEXTS/);
		expect(
			externalContexts("const EXTERNAL_CONTEXTS = {\n\t// why\n\t'cla.yml': ['cla', 'dco']\n};")
		).toEqual(new Map([['cla.yml', ['cla', 'dco']]]));
		expect(() => externalContexts('const protection = {};')).toThrow(/EXTERNAL_CONTEXTS/);
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
