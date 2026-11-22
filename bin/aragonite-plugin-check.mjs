#!/usr/bin/env node
// Runs a plugin package's published conformance suite (its `./conformance` export) the way a plugin
// listing checks it: `aragonite-plugin-check [package | dir] [--json file]`. A suite holding a
// plugin value runs through `check`, one listing `setup` plugins through the old kits. Both are
// this copy of the editor's, the one an install shares with the plugin.
import { createRequire } from 'node:module';
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	check,
	configureEditorEnv,
	isCheckFailure,
	runPluginConformance
} from '@voithos-labs/aragonite/testing';

/**
 * @typedef {{ of: string, subject: string, check: string, status: string, detail: string }} Row
 * @typedef {{ result: 'pass' | 'fail', rows: Row[], warnings: { tag: string, message: string }[], message: string | null }} Outcome
 */

// ── Pure parts ───────────────────────────────────────────────────────────────

/**
 * Why `value`, a module's default export, isn't a conformance suite, or null when it is.
 * @param {unknown} value
 * @returns {string | null}
 */
export function suiteProblem(value) {
	if (typeof value !== 'object' || value === null) return 'its default export is not an object';
	if ('plugin' in value) {
		const { plugin } = /** @type {{ plugin?: { name?: unknown } }} */ (value);
		return typeof plugin === 'function' && typeof plugin.name === 'string'
			? null
			: 'its default export holds no plugin value';
	}
	const { plugins } = /** @type {{ plugins?: unknown }} */ (value);
	if (!Array.isArray(plugins) || plugins.length === 0) return 'its default export lists no plugins';
	const unnamed = plugins.filter((plugin) => typeof plugin?.name !== 'string');
	return unnamed.length > 0 ? 'a plugin in its default export has no name' : null;
}

/**
 * A line per row, for the log a CI job prints, then a count of each status.
 * @param {Row[]} rows
 * @returns {string[]}
 */
export function rowLines(rows) {
	/** @type {Record<string, number>} */
	const counts = {};
	for (const { status } of rows) counts[status] = (counts[status] ?? 0) + 1;
	const tally = Object.entries(counts).map(([status, count]) => `${count} ${status}`);
	return [
		...rows.map(({ status, subject, check, detail }) =>
			status === 'passed'
				? `${status} ${subject} ${check}`
				: `${status} ${subject} ${check}: ${detail}`
		),
		`${rows.length} rows: ${tally.join(', ')}`
	];
}

/**
 * Runs a suite of either shape: `{ plugin, options?, excuse? }` through `check`, and the old
 * `{ plugins, containers?, inline? }` through `runPluginConformance`.
 * @param {any} suite
 * @returns {Promise<Outcome>}
 */
export async function runSuite(suite) {
	if ('plugin' in suite) {
		try {
			const { rows, warnings } = await check(suite.plugin, {
				options: suite.options,
				excuse: suite.excuse
			});
			return { result: 'pass', rows: [...rows], warnings: [...warnings], message: null };
		} catch (error) {
			if (!isCheckFailure(error)) throw error;
			const { rows, warnings } = error.report;
			return { result: 'fail', rows: [...rows], warnings: [...warnings], message: error.message };
		}
	}
	try {
		const { rows } = await runPluginConformance(suite);
		return { result: 'pass', rows, warnings: [], message: null };
	} catch (error) {
		const { rows = [], warnings = [], message } = /** @type {any} */ (error);
		return { result: 'fail', rows, warnings, message };
	}
}

/**
 * The package to check and where to resolve it from: a directory checks the package it holds.
 * @param {string} target
 * @param {string} cwd
 */
export function resolveTarget(target, cwd) {
	const dir = path.resolve(cwd, target);
	if (existsSync(dir) && statSync(dir).isDirectory()) {
		const { name } = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
		return { name: /** @type {string} */ (name), from: path.join(dir, 'package.json') };
	}
	return { name: target, from: path.join(cwd, 'package.json') };
}

/**
 * The manifest of package `name`, found by walking up from one of its files, since a package's
 * `exports` needn't publish its `package.json`.
 * @param {string} file
 * @param {string} name
 * @returns {{ version: string }}
 */
export function manifestAbove(file, name) {
	for (let dir = path.dirname(file); dir !== path.dirname(dir); dir = path.dirname(dir)) {
		const manifest = path.join(dir, 'package.json');
		if (!existsSync(manifest)) continue;
		const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
		if (parsed.name === name) return parsed;
	}
	throw new Error(`no package.json named ${name} above ${file}`);
}

// ── The run ──────────────────────────────────────────────────────────────────

/**
 * @param {string[]} argv
 * @param {string} cwd
 * @returns {Promise<number>} the exit code: 0 passed, 1 a contract broke, 2 nothing to check
 */
export async function main(argv, cwd) {
	const jsonAt = argv.indexOf('--json');
	const jsonFile = jsonAt === -1 ? null : argv[jsonAt + 1];
	const target =
		argv.find((arg, i) => !arg.startsWith('--') && (jsonAt === -1 || i !== jsonAt + 1)) ?? '.';
	const { name, from } = resolveTarget(target, cwd);
	const require = createRequire(from);

	let suitePath;
	try {
		suitePath = require.resolve(`${name}/conformance`);
	} catch {
		console.error(`${name} publishes no ./conformance export, so there is no suite to run`);
		return 2;
	}
	const editor = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	const plugin = manifestAbove(suitePath, name);
	configureEditorEnv({ isTest: true, isDev: true });

	const suite = (await import(pathToFileURL(suitePath).href)).default;
	const problem = suiteProblem(suite);
	if (problem !== null) {
		console.error(`${name}/conformance: ${problem}`);
		return 2;
	}

	console.log(`checking ${name}@${plugin.version} against ${editor.name}@${editor.version}`);
	/** @type {Outcome} */
	let outcome;
	try {
		outcome = await runSuite(suite);
	} catch (error) {
		const message = /** @type {Error} */ (error).message;
		// A run that threw before it answered still names what failed, so a listing can show it.
		const row = { of: 'plugin', subject: name, check: 'run', status: 'failed', detail: message };
		outcome = { result: 'fail', rows: [row], warnings: [], message };
	}
	for (const line of rowLines(outcome.rows)) console.log(`  ${line}`);
	if (outcome.message) console.error(outcome.message);
	const { result, rows, warnings } = outcome;
	const record = {
		package: name,
		version: plugin.version,
		editor: editor.version,
		result,
		rows,
		warnings
	};
	if (jsonFile)
		writeFileSync(path.resolve(cwd, jsonFile), JSON.stringify(record, null, '\t') + '\n');
	console.log(
		result === 'pass' ? 'aragonite-plugin-check: passed' : 'aragonite-plugin-check: failed'
	);
	return result === 'pass' ? 0 : 1;
}

// npm links the bin, so the path it was started by is compared once the link is resolved.
const startedAs = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : '';
if (import.meta.url === startedAs) {
	process.exitCode = await main(process.argv.slice(2), process.cwd());
}
