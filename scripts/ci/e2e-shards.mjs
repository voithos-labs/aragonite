#!/usr/bin/env node
// Splits the e2e suite into CI shards of about equal measured time, one engine at a time.
// `node scripts/ci/e2e-shards.mjs <current>/<total> <out>` lists the suite (`playwright test --list`
// under the job's `ENGINE`), writes this shard's `--test-list` file to <out> and its plan beside it.
// Every shard computes the same split from the same list and `src/lib/e2e/shard-timings.json`.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const TIMINGS_FILE = 'src/lib/e2e/shard-timings.json';

/**
 * @typedef {{ project: string, file: string, tests: number }} Group
 * One project's tests in one spec file; `file` is relative to the Playwright `testDir`.
 */

/** @param {Record<string, number>} table @returns {number} */
function medianSeconds(table) {
	const values = Object.values(table).sort((a, b) => a - b);
	return values.length === 0 ? 1 : values[Math.floor(values.length / 2)];
}

/**
 * A file's seconds on an engine: its measured time, or the engine's median file time for a file
 * the timing table has not seen yet.
 * @param {Record<string, number>} table @param {string} file
 */
export function estimateSeconds(table, file) {
	return table[file] ?? medianSeconds(table);
}

/**
 * Longest first onto the least loaded shard, ties broken by key, so the split depends only on the
 * groups and the table, never on their order.
 * @param {Group[]} groups @param {Record<string, number>} table @param {number} total
 * @returns {{ groups: Group[], seconds: number }[]}
 */
export function partition(groups, table, total) {
	const shards = Array.from({ length: total }, () => ({
		groups: /** @type {Group[]} */ ([]),
		seconds: 0
	}));
	const key = (/** @type {Group} */ g) => `${g.project} › ${g.file}`;
	const ordered = [...groups].sort(
		(a, b) =>
			estimateSeconds(table, b.file) - estimateSeconds(table, a.file) ||
			(key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)
	);
	for (const group of ordered) {
		const lightest = shards.reduce(
			(min, shard, i) => (shard.seconds < shards[min].seconds ? i : min),
			0
		);
		shards[lightest].groups.push(group);
		shards[lightest].seconds += estimateSeconds(table, group.file);
	}
	for (const shard of shards) shard.groups.sort((a, b) => (key(a) < key(b) ? -1 : 1));
	return shards;
}

/** The `--test-list` lines for one shard. @param {Group[]} groups */
export function testListLines(groups) {
	return groups.map((g) => `[${g.project}] › ${g.file}`);
}

/**
 * Groups from `playwright test --list --reporter=json`.
 * @param {{ suites?: unknown[] }} listing @returns {Group[]}
 */
export function groupsOfListing(listing) {
	/** @type {Map<string, Group>} */
	const byKey = new Map();
	/** @param {any} suite */
	const walk = (suite) => {
		for (const spec of suite.specs ?? []) {
			for (const test of spec.tests) {
				const k = `${test.projectName}\n${spec.file}`;
				const group = byKey.get(k) ?? { project: test.projectName, file: spec.file, tests: 0 };
				group.tests++;
				byKey.set(k, group);
			}
		}
		for (const child of suite.suites ?? []) walk(child);
	};
	for (const suite of listing.suites ?? []) walk(suite);
	return [...byKey.values()];
}

/** @param {string} arg @returns {{ current: number, total: number }} */
export function parseShard(arg) {
	const match = /^(\d+)\/(\d+)$/.exec(arg);
	const current = Number(match?.[1]);
	const total = Number(match?.[2]);
	if (!match || current < 1 || current > total)
		throw new Error(`shard "${arg}": expected <current>/<total>`);
	return { current, total };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [shardArg, out] = process.argv.slice(2);
	const { current, total } = parseShard(shardArg ?? '');
	const engine = process.env.ENGINE ?? 'chromium';
	const table = JSON.parse(readFileSync(TIMINGS_FILE, 'utf8'))[engine];
	if (!table) throw new Error(`${TIMINGS_FILE} has no table for ${engine}`);
	const listing = JSON.parse(
		execFileSync(
			process.execPath,
			[
				createRequire(import.meta.url).resolve('@playwright/test/cli'),
				'test',
				'--list',
				'--reporter=json'
			],
			{ encoding: 'utf8', maxBuffer: 1 << 28 }
		)
	);
	const groups = groupsOfListing(listing);
	const shards = partition(groups, table, total);
	const mine = shards[current - 1];
	writeFileSync(out, testListLines(mine.groups).join('\n') + '\n');
	const plan = {
		engine,
		shard: `${current}/${total}`,
		listTotal: groups.reduce((sum, g) => sum + g.tests, 0),
		groupTotal: groups.length,
		tests: mine.groups.reduce((sum, g) => sum + g.tests, 0),
		groups: testListLines(mine.groups),
		predictedSeconds: Math.round(mine.seconds)
	};
	writeFileSync(`${out}.plan.json`, JSON.stringify(plan, null, 1));
	const minutes = shards.map((s) => (s.seconds / 60).toFixed(1)).join(', ');
	console.log(
		`shard ${plan.shard} (${engine}): ${mine.groups.length} files, ${plan.tests} of ${plan.listTotal} tests; predicted test-minutes per shard: ${minutes}`
	);
}
