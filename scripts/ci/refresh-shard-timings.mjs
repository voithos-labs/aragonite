#!/usr/bin/env node
// Rewrites `src/lib/e2e/shard-timings.json` from CI runs' per-file seconds, a step of release prep.
// `node scripts/ci/refresh-shard-timings.mjs <run-id>...` downloads each run's e2e summaries with `gh`
// and averages a file's seconds over the runs that ran it; an engine no run carries keeps its table.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIMINGS_FILE } from './e2e-shards.mjs';

/**
 * Per engine, each file's mean seconds over the summaries; a run's shards add up per file first.
 * @param {{ run: string, engine: string, fileSeconds: [string, number][] }[]} summaries
 * @returns {Record<string, Record<string, number>>}
 */
export function meanTimings(summaries) {
	/** @type {Map<string, Map<string, Map<string, number>>>} engine → file → run → seconds */
	const sums = new Map();
	for (const { run, engine, fileSeconds } of summaries) {
		const files = sums.get(engine) ?? new Map();
		sums.set(engine, files);
		for (const [file, seconds] of fileSeconds) {
			const runs = files.get(file) ?? new Map();
			files.set(file, runs);
			runs.set(run, (runs.get(run) ?? 0) + seconds);
		}
	}
	/** @type {Record<string, Record<string, number>>} */
	const out = {};
	for (const [engine, files] of [...sums].sort()) {
		out[engine] = {};
		for (const [file, runs] of [...files].sort()) {
			const values = [...runs.values()];
			out[engine][file] = Math.max(
				1,
				Math.round(values.reduce((a, b) => a + b, 0) / values.length)
			);
		}
	}
	return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const runs = process.argv.slice(2);
	if (runs.length === 0)
		throw new Error('usage: node scripts/ci/refresh-shard-timings.mjs <run-id>...');
	const summaries = [];
	for (const run of runs) {
		const dir = mkdtempSync(path.join(tmpdir(), 'shard-timings-'));
		try {
			execFileSync('gh', ['run', 'download', run, '-D', dir, '-p', 'e2e-*'], { stdio: 'inherit' });
			for (const artifact of readdirSync(dir)) {
				const summary = JSON.parse(
					readFileSync(path.join(dir, artifact, 'ci-summary.json'), 'utf8')
				);
				summaries.push({ run, engine: summary.engine, fileSeconds: summary.fileSeconds });
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
	const current = JSON.parse(readFileSync(TIMINGS_FILE, 'utf8'));
	const next = { ...current, ...meanTimings(summaries) };
	const sorted = Object.fromEntries(
		Object.keys(next)
			.sort()
			.map((engine) => [engine, next[engine]])
	);
	writeFileSync(TIMINGS_FILE, JSON.stringify(sorted, null, '\t') + '\n');
	console.log(
		`${TIMINGS_FILE}: ${Object.keys(meanTimings(summaries)).join(', ')} refreshed from ${runs.join(', ')}`
	);
}
