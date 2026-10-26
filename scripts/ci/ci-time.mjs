#!/usr/bin/env node
// How long CI takes on a dev push: the wall time from push to the last job, and the runner minutes
// every job spent. Report-only. `node scripts/ci/ci-time.mjs [run-id]` reads one run (the latest
// successful dev push by default) and the median of the last five; it needs an authenticated `gh`.
import { execFileSync } from 'node:child_process';

/** @typedef {{ name: string, startedAt: string, completedAt: string }} Job */

const RECENT = 5;
const LIST_RUNS =
	'run list --workflow ci.yml --branch dev --event push --status success --json databaseId --limit';

/** @param {string[]} args */
const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));

/** @param {string} from @param {string} to */
const minutes = (from, to) => (Date.parse(to) - Date.parse(from)) / 60_000;

/** @param {number | string} id */
function readRun(id) {
	const run = gh(['run', 'view', String(id), '--json', 'createdAt,updatedAt,headSha,jobs']);
	/** @type {Job[]} */
	const jobs = run.jobs.filter((/** @type {Job} */ job) => job.startedAt && job.completedAt);
	const timed = jobs.map((job) => ({
		name: job.name,
		minutes: minutes(job.startedAt, job.completedAt)
	}));
	return {
		id,
		sha: String(run.headSha).slice(0, 9),
		wall: minutes(run.createdAt, run.updatedAt),
		runner: timed.reduce((sum, job) => sum + job.minutes, 0),
		slowest: timed.sort((a, b) => b.minutes - a.minutes).slice(0, 3)
	};
}

/** @param {number[]} values */
function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const recentIds = gh([...LIST_RUNS.split(' '), String(RECENT)]).map(
	(/** @type {{ databaseId: number }} */ run) => run.databaseId
);
const runs = recentIds.map(readRun);
const chosen = process.argv[2] ? readRun(process.argv[2]) : runs[0];
const fmt = (/** @type {number} */ value) => value.toFixed(1);

console.log(
	`ci-time: run ${chosen.id} (${chosen.sha}) ${fmt(chosen.wall)} min wall, ` +
		`${fmt(chosen.runner)} runner-min; slowest ` +
		chosen.slowest.map((job) => `${job.name} ${fmt(job.minutes)}`).join(', ')
);
console.log(
	`ci-time: median of the last ${runs.length} successful dev pushes ` +
		`${fmt(median(runs.map((run) => run.wall)))} min wall, ` +
		`${fmt(median(runs.map((run) => run.runner)))} runner-min`
);
