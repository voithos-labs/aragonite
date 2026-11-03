// Writes each listed plugin's `verified` record into the listing, then regenerates the gallery
// table, from the result files `plugin-listing.yml`'s manual run downloads.
//
//   node scripts/plugins/check-listing.mjs --results dir [--dry-run]
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listingProblems, readListing, writeListing } from './listing.mjs';

/**
 * @typedef {import('./listing.mjs').Entry} Entry
 * @typedef {import('./listing.mjs').Verified} Verified
 * @typedef {{ package: string, version: string | null, editor: string, result: string, failures: string | null }} CheckResult
 */

// ── Pure parts ───────────────────────────────────────────────────────────────

/**
 * The broken cells a failed run names (`kind: cell`), or its first problem line when no cell
 * broke, the way `runPluginConformance` writes them.
 * @param {string} message
 * @returns {string[]}
 */
export function failedCells(message) {
	const cells = [];
	let subject = null;
	for (const line of message.split('\n')) {
		const heading = /conformance failed for (?:rung )?"([^"]+)"/.exec(line);
		if (heading && !line.startsWith('plugin ')) subject = heading[1];
		const cell = /^ {6}- (\w+): /.exec(line);
		if (cell && subject) cells.push(`${subject}: ${cell[1]}`);
	}
	if (cells.length > 0) return cells;
	const first = message.split('\n').find((line) => line.startsWith('  - '));
	return [first ? first.slice(4) : message.split('\n')[0]];
}

/**
 * Why `value`, a result file the plugin check wrote, can't be recorded, or null when it can. The
 * file comes out of a job that ran a plugin's code, so nothing in it is trusted unchecked.
 * @param {unknown} value
 */
export function resultProblem(value) {
	if (typeof value !== 'object' || value === null) return 'not an object';
	const { package: name, version, editor, result, failures } = /** @type {CheckResult} */ (value);
	if (typeof name !== 'string') return 'no package';
	if (version !== null && typeof version !== 'string') return 'version is no string';
	if (typeof editor !== 'string' || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(editor))
		return 'editor is no version';
	if (!['pass', 'fail', 'out-of-range'].includes(result)) return `unknown result ${result}`;
	if ((result === 'fail') !== (typeof failures === 'string')) return 'failures goes with fail only';
	return null;
}

/**
 * The listing's record of one check.
 * @param {CheckResult} result
 * @returns {Verified}
 */
export function verifiedFrom(result) {
	const record = {
		editor: result.editor,
		plugin: result.version,
		result: /** @type {Verified['result']} */ (result.result)
	};
	return result.result === 'fail'
		? { ...record, failures: failedCells(result.failures ?? '') }
		: record;
}

/**
 * `entries` with each result recorded on its package's entry; a result for no listed package is
 * an error, since a check can only report what the listing asked for.
 * @param {Entry[]} entries
 * @param {CheckResult[]} results
 */
export function recorded(entries, results) {
	const byName = new Map(results.map((result) => [result.package, result]));
	for (const name of byName.keys()) {
		if (!entries.some((entry) => entry.package === name))
			throw new Error(`a result for ${name}, which the listing doesn't hold`);
	}
	return entries.map((entry) => {
		const result = byName.get(entry.package);
		return result ? { ...entry, verified: verifiedFrom(result) } : entry;
	});
}

// ── Recording a run ──────────────────────────────────────────────────────────

/** @param {string[]} argv @param {string} flag */
const option = (argv, flag) => {
	const at = argv.indexOf(flag);
	return at === -1 ? null : argv[at + 1];
};

/** @param {string[]} argv */
function main(argv) {
	const entries = readListing();
	const problems = listingProblems(entries);
	if (problems.length > 0) throw new Error(problems.join('\n'));

	const resultsDir = option(argv, '--results');
	if (!resultsDir) throw new Error('--results <dir> is required');
	/** @type {CheckResult[]} */
	const results = readdirSync(resultsDir, { recursive: true })
		.map(String)
		.filter((file) => file.endsWith('.json'))
		.map((file) => {
			const value = JSON.parse(readFileSync(path.join(resultsDir, file), 'utf8'));
			const problem = resultProblem(value);
			if (problem) throw new Error(`${file}: ${problem}`);
			return value;
		});
	if (!argv.includes('--dry-run')) writeListing(recorded(entries, results));
	for (const result of results)
		console.log(`check-listing: ${result.package} ${result.result} on ${result.editor}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2));
}
