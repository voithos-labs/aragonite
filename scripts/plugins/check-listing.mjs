// Records what each listed plugin's check found into `checks.json`, beside the repository and
// peer range its own manifest names, then regenerates the gallery table, from the result files
// `plugin-listing.yml`'s manual run downloads.
//
//   node scripts/plugins/check-listing.mjs --results dir [--dry-run]
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CORE,
	VERSION,
	listingProblems,
	publishedManifest,
	readChecks,
	readListing,
	registryProblem,
	repositoryUrl,
	writeChecks
} from './listing.mjs';

/**
 * @typedef {import('./listing.mjs').Checks} Checks
 * @typedef {import('./listing.mjs').CheckRecord} CheckRecord
 * @typedef {import('./listing.mjs').PublishedManifest} PublishedManifest
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
	if (version !== null && (typeof version !== 'string' || !VERSION.test(version)))
		return 'version is no version';
	if (typeof editor !== 'string' || !VERSION.test(editor)) return 'editor is no version';
	if (!['pass', 'fail', 'out-of-range'].includes(result)) return `unknown result ${result}`;
	if ((result === 'fail') !== (typeof failures === 'string')) return 'failures goes with fail only';
	return null;
}

/**
 * The record of one check, with the repository and peer range read from the manifest of the
 * version it checked, so the gallery can't disagree with the package.
 * @param {CheckResult} result
 * @param {PublishedManifest} published
 * @returns {CheckRecord}
 */
export function recordFrom(result, published) {
	const problem = registryProblem(result.package, published);
	if (problem !== null) throw new Error(problem);
	const record = {
		version: result.version,
		repository: /** @type {string} */ (repositoryUrl(published.repository)),
		peer: /** @type {string} */ (published.peerDependencies?.[CORE]),
		editor: result.editor,
		result: /** @type {CheckRecord['result']} */ (result.result)
	};
	return result.result === 'fail'
		? { ...record, failures: failedCells(result.failures ?? '') }
		: record;
}

/**
 * The artifact `plugin-check.yml` uploads a package's result in, named before the plugin's code
 * runs: its `upload` job's `tr '@/' '-_'`.
 * @param {string} name
 */
export const resultArtifact = (name) =>
	`plugin-check-${name.replaceAll('@', '-').replaceAll('/', '_')}`;

/**
 * `checks` with each result recorded under the listed package whose artifact it arrived in. The
 * file itself was written beside the plugin's code, so a result naming another package, or an
 * artifact no single listed package uploads, is an error.
 * @param {string[]} names
 * @param {Checks} checks
 * @param {{ artifact: string, result: CheckResult }[]} arrivals
 * @param {(name: string, version: string) => PublishedManifest} manifestOf
 * @returns {Checks}
 */
export function recorded(names, checks, arrivals, manifestOf) {
	const next = { ...checks };
	for (const { artifact, result } of arrivals) {
		const owners = names.filter((name) => resultArtifact(name) === artifact);
		if (owners.length !== 1)
			throw new Error(
				`${artifact} is the artifact of ${owners.join(' and ') || 'no listed package'}`
			);
		const [name] = owners;
		if (result.package !== name)
			throw new Error(`${artifact} holds a result for ${result.package}, not ${name}`);
		// An out-of-range check installed nothing, so it read the newest version's manifest.
		next[name] = recordFrom(result, manifestOf(name, result.version ?? 'latest'));
	}
	return next;
}

// ── Recording a run ──────────────────────────────────────────────────────────

/** @param {string[]} argv @param {string} flag */
const option = (argv, flag) => {
	const at = argv.indexOf(flag);
	return at === -1 ? null : argv[at + 1];
};

/** @param {string[]} argv */
function main(argv) {
	const names = readListing();
	const problems = listingProblems(names);
	if (problems.length > 0) throw new Error(problems.join('\n'));

	const resultsDir = option(argv, '--results');
	if (!resultsDir) throw new Error('--results <dir> is required');
	// The workflow downloads every artifact into one folder, each a single `<artifact>.json`.
	const arrivals = readdirSync(resultsDir, { withFileTypes: true }).map((entry) => {
		if (!entry.isFile() || !entry.name.endsWith('.json'))
			throw new Error(
				`${entry.name}: the results hold one <artifact>.json per check and nothing else`
			);
		const value = JSON.parse(readFileSync(path.join(resultsDir, entry.name), 'utf8'));
		const problem = resultProblem(value);
		if (problem) throw new Error(`${entry.name}: ${problem}`);
		return {
			artifact: entry.name.slice(0, -'.json'.length),
			result: /** @type {CheckResult} */ (value)
		};
	});
	const checks = recorded(names, readChecks(), arrivals, publishedManifest);
	if (!argv.includes('--dry-run')) writeChecks(names, checks);
	for (const { result } of arrivals)
		console.log(`check-listing: ${result.package} ${result.result} on ${result.editor}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2));
}
