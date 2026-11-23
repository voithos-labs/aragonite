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
 * @typedef {{ of: string, subject: string, check: string, status: string, detail: string }} CheckRow
 * @typedef {{ package: string, version: string | null, editor: string, result: string, rows: CheckRow[], warnings: { tag: string, message: string }[] }} CheckResult
 */

// ── Pure parts ───────────────────────────────────────────────────────────────

const OF = ['plugin', 'block', 'inline', 'command', 'menu', 'pasteRewrite', 'blockRewrite'];
const STATUSES = ['passed', 'failed', 'advisory', 'excused', 'not-applicable', 'unchecked'];
// What reaches the gallery table is held to a shape no Markdown or HTML hides in; a name outside it
// shows as `(unshown)`, so one stray name never refuses the whole run.
const SUBJECT = /^(?!.*\]\()[^\r\n|`<>]{1,120}$/;
const CHECK = /^[A-Za-z]{1,40}$/;
/** @param {string} text @param {RegExp} shape */
const shown = (text, shape) => (shape.test(text) ? text : '(unshown)');
const TAG = /^[\w:.-]{1,60}$/;

/** @param {unknown} row */
function rowProblem(row) {
	const { of, subject, check, status } = /** @type {Partial<CheckRow>} */ (row ?? {});
	if (!OF.includes(/** @type {string} */ (of))) return `a row of ${of}`;
	if (typeof subject !== 'string' || typeof check !== 'string')
		return 'a row with no subject or check';
	if (!STATUSES.includes(/** @type {string} */ (status))) return `a row with status ${status}`;
	return null;
}

/**
 * Why `value`, a result file the plugin check wrote, can't be recorded, or null when it can. The
 * file comes out of a job that ran a plugin's code, so nothing in it is trusted unchecked; a row's
 * `detail` is never recorded.
 * @param {unknown} value
 */
export function resultProblem(value) {
	if (typeof value !== 'object' || value === null) return 'not an object';
	const {
		package: name,
		version,
		editor,
		result,
		rows,
		warnings
	} = /** @type {CheckResult} */ (value);
	if (typeof name !== 'string') return 'no package';
	if (version !== null && (typeof version !== 'string' || !VERSION.test(version)))
		return 'version is no version';
	if (typeof editor !== 'string' || !VERSION.test(editor)) return 'editor is no version';
	if (!['pass', 'fail', 'out-of-range'].includes(result)) return `unknown result ${result}`;
	if (!Array.isArray(rows)) return 'rows is no list, so a check before rows wrote it';
	const bad = rows.map(rowProblem).find((problem) => problem !== null);
	if (bad) return bad;
	if (result !== 'out-of-range' && rows.length === 0) return 'a run with no rows checked nothing';
	if (!Array.isArray(warnings) || warnings.some((w) => !TAG.test(w?.tag)))
		return 'warnings is no list of tagged warnings';
	if ((result === 'fail') !== failuresOf(/** @type {CheckResult} */ (value)).length > 0)
		return 'a failed result, and only one, names what failed';
	return null;
}

/**
 * What a run failed on, as the gallery shows it: `subject: check` per failed row, then each dev
 * warning's tag.
 * @param {CheckResult} result
 * @returns {string[]}
 */
function failuresOf({ rows, warnings }) {
	return [
		...rows
			.filter((row) => row.status === 'failed')
			.map((row) => `${shown(row.subject, SUBJECT)}: ${shown(row.check, CHECK)}`),
		...warnings.map(({ tag }) => `dev warning [${tag}]`)
	];
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
	/** @type {CheckRecord} */
	const record = {
		version: result.version,
		repository: /** @type {string} */ (repositoryUrl(published.repository)),
		peer: /** @type {string} */ (published.peerDependencies?.[CORE]),
		editor: result.editor,
		result: /** @type {CheckRecord['result']} */ (result.result)
	};
	const unchecked = result.rows.filter((row) => row.status === 'unchecked').length;
	if (unchecked > 0) record.unchecked = unchecked;
	if (result.result === 'fail') record.failures = failuresOf(result);
	return record;
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
