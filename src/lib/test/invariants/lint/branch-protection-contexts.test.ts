/**
 * The required status-check contexts in `scripts/apply-branch-protection.mjs` are ci.yml's job
 * ids, each matrix job expanded the way GitHub names its checks. Hand-kept, the list rots in two
 * silent directions: a renamed job leaves every PR waiting on a check that never reports, and a
 * dropped context leaves a job running while gating nothing. Neither shows before the flip to
 * public, since the API plan-gates protection on a private free-plan repo.
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

/** The `contexts:` array the branch-protection payload sends. */
export function requiredContexts(script: string): string[] {
	const array = /contexts:\s*\[([^\]]*)\]/.exec(script);
	if (array === null) throw new Error('apply-branch-protection.mjs declares no contexts array');
	return array[1]
		.split('\n')
		.map((line) => /^\s*'([^']*)',?\s*(?:\/\/.*)?$/.exec(line)?.[1])
		.filter((context): context is string => context !== undefined);
}

const ci = checkNames(readFileSync(path.join(WORKFLOWS, CI), 'utf8'));
const required = requiredContexts(readFileSync(SCRIPT, 'utf8'));

// ── The gate ─────────────────────────────────────────────────────────────────

describe('branch protection ↔ ci.yml job names', () => {
	it('requires exactly the checks ci.yml reports', () => {
		expect(
			[...required].sort(),
			`the contexts array in ${path.basename(SCRIPT)} and ${CI}'s job names have diverged — a context ci.yml never reports blocks every PR forever, and a job with no context gates nothing`
		).toEqual([...ci].sort());
	});

	it('no other workflow reports a check name the rule requires', () => {
		const colliding = readdirSync(WORKFLOWS)
			.filter((file) => file !== CI && file.endsWith('.yml'))
			.flatMap((file) =>
				checkNames(readFileSync(path.join(WORKFLOWS, file), 'utf8'))
					.filter((name) => required.includes(name))
					.map((name) => `${file}: ${name}`)
			);
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
		expect(required.length).toBe(ci.length);
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

	it('reads the contexts array and drops its comments', () => {
		expect(
			requiredContexts("contexts: [\n\t// a note\n\t'unit',\n\t'e2e (1/4)' // trailing\n]")
		).toEqual(['unit', 'e2e (1/4)']);
		expect(() => requiredContexts('const protection = {};')).toThrow();
	});
});
