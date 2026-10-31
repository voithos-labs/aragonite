// Writes each listed plugin's `verified` record into the listing, then regenerates the gallery
// table, at each release cut. `--packs` checks the bundled plugins from that folder's tarballs;
// everyone else's run only in CI, so `--results` records the listing workflow's artifacts.
//
//   node scripts/plugins/check-listing.mjs --packs tmp/plugin-packs [--only name] [--dry-run]
//   node scripts/plugins/check-listing.mjs --results dir [--dry-run]
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listingProblems, partitionEntries, readListing, writeListing } from './listing.mjs';
import { pluginPackages } from '../lib-alias.mjs';

const EDITOR = '@voithos-labs/aragonite';

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

// ── Running one check ────────────────────────────────────────────────────────

/**
 * The tarball in `packs` for package `name`, as `npm pack` names it, or null.
 * @param {string | null} packs
 * @param {string} name
 */
function tarballFor(packs, name) {
	if (!packs) return null;
	const stem = name.replace(/^@/, '').replace('/', '-');
	const file = readdirSync(packs).find(
		(f) => f.startsWith(`${stem}-`) && /^\d/.test(f.slice(stem.length + 1))
	);
	return file ? path.join(packs, file) : null;
}

/**
 * Installs `pluginSpec` beside `editorSpec` in an empty project and runs the plugin check there.
 * @param {string} name
 * @param {string} pluginSpec
 * @param {string} editorSpec
 * @param {string} editorVersion
 * @returns {CheckResult}
 */
function checkOne(name, pluginSpec, editorSpec, editorVersion) {
	const dir = mkdtempSync(path.join(tmpdir(), 'aragonite-listing-'));
	try {
		execSync('npm init -y', { cwd: dir, stdio: 'ignore' });
		const install = spawnSync(
			`npm install --no-save --ignore-scripts "${pluginSpec}" "${editorSpec}"`,
			{ cwd: dir, encoding: 'utf8', shell: true }
		);
		if (install.status !== 0) {
			if (install.stderr.includes('ERESOLVE')) {
				return {
					package: name,
					version: null,
					editor: editorVersion,
					result: 'out-of-range',
					failures: null
				};
			}
			throw new Error(`installing ${pluginSpec} failed:\n${install.stderr}`);
		}
		spawnSync(`npx --no-install aragonite-plugin-check ${name} --json result.json`, {
			cwd: dir,
			stdio: 'inherit',
			shell: true
		});
		const file = path.join(dir, 'result.json');
		if (!existsSync(file)) throw new Error(`the check over ${name} wrote no result`);
		return JSON.parse(readFileSync(file, 'utf8'));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** @param {string[]} argv @param {string} flag */
const option = (argv, flag) => {
	const at = argv.indexOf(flag);
	return at === -1 ? null : argv[at + 1];
};

/** @param {string[]} argv */
async function main(argv) {
	const entries = readListing();
	const problems = listingProblems(entries);
	if (problems.length > 0) throw new Error(problems.join('\n'));

	/** @type {CheckResult[]} */
	let results;
	const resultsDir = option(argv, '--results');
	if (resultsDir) {
		results = readdirSync(resultsDir, { recursive: true })
			.map(String)
			.filter((file) => file.endsWith('.json'))
			.map((file) => {
				const value = JSON.parse(readFileSync(path.join(resultsDir, file), 'utf8'));
				const problem = resultProblem(value);
				if (problem) throw new Error(`${file}: ${problem}`);
				return value;
			});
	} else {
		const packsOption = option(argv, '--packs');
		if (!packsOption) throw new Error('--packs <dir> or --results <dir> is required');
		const packs = path.resolve(packsOption);
		const only = option(argv, '--only');
		const editorSpec = tarballFor(packs, EDITOR);
		if (!editorSpec) throw new Error(`${packs} holds no ${EDITOR} tarball`);
		// `npm pack` names a tarball after the version it holds.
		const editorVersion = /-(\d[\w.-]*)\.tgz$/.exec(editorSpec)?.[1] ?? '';
		const bundled = pluginPackages();
		const names = entries.map((entry) => entry.package).filter((name) => !only || name === only);
		const { outside } = partitionEntries(names, bundled);
		for (const name of outside) console.log(`check-listing: ${name} is checked in CI, not here`);
		results = names
			.filter((name) => !outside.includes(name))
			.map((name) => {
				const tarball = tarballFor(packs, name);
				if (!tarball) throw new Error(`${packs} holds no tarball for ${name}`);
				return checkOne(name, tarball, editorSpec, editorVersion);
			});
	}
	if (!argv.includes('--dry-run')) writeListing(recorded(entries, results));
	for (const result of results)
		console.log(`check-listing: ${result.package} ${result.result} on ${result.editor}`);
	// Recording results is no verdict on them; a run of the checks fails when one didn't pass.
	return resultsDir || results.every((result) => result.result === 'pass') ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await main(process.argv.slice(2));
}
