/**
 * The CI shard split (`scripts/ci/e2e-shards.mjs`) places every spec file in exactly one shard, from
 * the checked-in timing table alone; the table names only spec files that exist and has a time or
 * an estimate for every one; and the census (`scripts/ci/e2e-census.mjs`) catches an engine or a shard
 * that lost, doubled or skipped tests. The census job waits on every sharded job and is required.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { collectFiles } from '../../test/invariants/lint/scan-source';
import {
	TIMINGS_FILE,
	estimateSeconds,
	partition,
	testListLines
} from '../../../../scripts/ci/e2e-shards.mjs';
import { censusProblems } from '../../../../scripts/ci/e2e-census.mjs';
import { CI_CONTEXTS } from '../../../../scripts/release/branch-protection-contexts.mjs';

const SPEC_DIR = 'src/lib/e2e/tests';
const CONFIG = 'playwright.config.ts';
const CI = '.github/workflows/ci.yml';

const timings: Record<string, Record<string, number>> = JSON.parse(
	readFileSync(TIMINGS_FILE, 'utf8')
);
const specFiles = collectFiles(SPEC_DIR, { extensions: ['.spec.ts'] }).map((file) =>
	path.posix.relative(SPEC_DIR, file)
);
const engines = [
	...readFileSync(CONFIG, 'utf8').matchAll(/^\t(\w+): \{\s*\n?\s*browserName:/gm)
].map((match) => match[1]);

type Group = { project: string; file: string; tests: number };
const groupsOf = (files: string[]): Group[] =>
	files.map((file) => ({ project: 'e2e', file, tests: 1 }));

describe('the shard timing table', () => {
	it('has a table for every engine the config runs', () => {
		expect(engines.length).toBeGreaterThan(1);
		expect(Object.keys(timings).sort()).toEqual([...engines].sort());
	});

	it('names only spec files that exist', () => {
		const stale = Object.entries(timings).flatMap(([engine, table]) =>
			Object.keys(table)
				.filter((file) => !specFiles.includes(file))
				.map((file) => `${engine}: ${file}`)
		);
		expect(
			stale,
			`a spec moved or went: rename or delete its key in ${TIMINGS_FILE}, or refresh the table with node scripts/ci/refresh-shard-timings.mjs <run-id>`
		).toEqual([]);
	});

	it('has a time or an estimate for every spec file on every engine', () => {
		const missing = engines.flatMap((engine) =>
			specFiles
				.filter((file) => {
					const seconds = estimateSeconds(timings[engine] ?? {}, file);
					return !Number.isInteger(seconds) || seconds <= 0;
				})
				.map((file) => `${engine}: ${file}`)
		);
		expect(missing).toEqual([]);
	});
});

describe('the shard split', () => {
	const table = timings.firefox;
	const groups = groupsOf(specFiles);

	it('places every group in exactly one shard, at every shard count', () => {
		for (let total = 1; total <= 12; total++) {
			const placed = partition(groups, table, total).flatMap((shard) =>
				testListLines(shard.groups)
			);
			expect(placed.length, `${total} shards`).toBe(groups.length);
			expect(new Set(placed).size, `${total} shards`).toBe(groups.length);
		}
	});

	it('depends on the groups and the table, not their order', () => {
		const reversed = [...groups].reverse();
		const lines = (input: Group[]) =>
			partition(input, table, 8).map((shard) => testListLines(shard.groups));
		expect(lines(reversed)).toEqual(lines(groups));
	});

	it('balances the measured suite within a few percent', () => {
		for (const total of [4, 5, 8]) {
			const seconds = partition(groups, table, total).map((shard) => shard.seconds);
			const mean = seconds.reduce((a, b) => a + b, 0) / total;
			expect(Math.max(...seconds) / mean, `${total} shards`).toBeLessThan(1.05);
		}
	});

	it("estimates a file the table hasn't seen at the engine's median file time", () => {
		expect(estimateSeconds({ a: 1, b: 5, c: 9 }, 'new.spec.ts')).toBe(5);
		expect(estimateSeconds({ a: 1, b: 5, c: 9 }, 'c')).toBe(9);
	});
});

// ── The census ───────────────────────────────────────────────────────────────

const plan = (shard: string, tests: number, groups: string[]) => ({
	shard,
	listTotal: 10,
	groupTotal: 3,
	tests,
	groups
});
const summary = (shard: string, ran: number, planned: ReturnType<typeof plan> | null) => ({
	engine: 'webkit',
	shard: `shard ${shard}`,
	counts: { passed: ran, failed: 0, flaky: 0, skipped: 0 },
	plan: planned
});
const complete = () => [
	summary('1/2', 6, plan('1/2', 6, ['[p] › a', '[p] › b'])),
	summary('2/2', 4, plan('2/2', 4, ['[p] › c']))
];

const census = (summaries: ReturnType<typeof complete>) => censusProblems(summaries, ['webkit']);

describe('the census', () => {
	it('passes a complete run', () => {
		expect(census(complete())).toEqual([]);
	});

	it('names an engine that reported nothing at all', () => {
		expect(census([])).toEqual(['webkit: no shard reported']);
		expect(censusProblems(complete(), ['webkit', 'firefox'])).toEqual([
			'firefox: no shard reported'
		]);
	});

	it('names a missing shard, a short shard, a doubled file and a lost one', () => {
		expect(census(complete().slice(0, 1)).join('\n')).toMatch(/shard 2\/2 reported nothing/);
		const short = complete();
		short[1].counts.passed = 3;
		expect(census(short).join('\n')).toMatch(/ran 3 tests of the 4 planned/);
		const doubled = complete();
		doubled[1].plan!.groups = ['[p] › b'];
		expect(census(doubled).join('\n')).toMatch(/ran in two shards/);
		expect(census(doubled).join('\n')).toMatch(/planned 2 of the 3 spec files/);
		const unplanned = complete();
		unplanned[0].plan = null;
		expect(census(unplanned).join('\n')).toMatch(/no plan/);
	});
});

describe('the census job', () => {
	const jobs = new Map<string, string>();
	let current = '';
	const jobsBlock = readFileSync(CI, 'utf8').split(/^jobs:$/m)[1] ?? '';
	for (const line of jobsBlock.split('\n')) {
		const id = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)?.[1];
		if (id) current = id;
		else if (current) jobs.set(current, (jobs.get(current) ?? '') + line + '\n');
	}
	const sharded = [...jobs].filter(([, body]) => body.includes('node scripts/ci/e2e-shards.mjs'));

	it('waits on every job the shard split runs in, and is required', () => {
		const needs = /^ {4}needs:\s*\[(.*)\]/m.exec(jobs.get('e2e-census') ?? '')?.[1] ?? '';
		const waitsOn = needs.split(',').map((name) => name.trim());
		expect(sharded.map(([id]) => id)).toEqual(['e2e', 'e2e-webkit', 'e2e-firefox']);
		for (const [id] of sharded) expect(waitsOn, id).toContain(id);
		expect(CI_CONTEXTS).toContain('e2e-census');
	});

	it('expects every engine a sharded job runs, and each job uploads the summary it counts', () => {
		const census = jobs.get('e2e-census') ?? '';
		const expected = /node scripts\/ci\/e2e-census\.mjs \S+ (.*)$/m.exec(census)?.[1].split(' ');
		const downloads = /^ {10}pattern: (\S+)\*$/m.exec(census)?.[1] ?? '';
		const engineOf = (body: string) => /^ {10}engine: (\w+)$/m.exec(body)?.[1];
		expect(downloads, 'the census downloads the summaries by a name prefix').not.toBe('');
		expect(expected?.sort()).toEqual(sharded.map(([, body]) => engineOf(body)).sort());
		for (const [id, body] of sharded) {
			expect(body, id).toMatch(/^( {10}path: | {12})test-results\/ci-summary\.json$/m);
			expect(/^ {10}name: (.+)$/m.exec(body)?.[1].startsWith(downloads), id).toBe(true);
		}
	});
});
