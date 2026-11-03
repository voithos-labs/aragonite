#!/usr/bin/env node
// Runs a plugin package's published conformance suite (its `./conformance` export) through the
// editor's kits, the way a plugin listing checks it: `aragonite-plugin-check [package | dir]
// [--json file]`. The kits are this copy of the editor's, the one an install shares with the plugin.
import { createRequire } from 'node:module';
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { configureEditorEnv, runPluginConformance } from '@voithos-labs/aragonite/testing';

// ── Pure parts ───────────────────────────────────────────────────────────────

/**
 * Why `value`, a module's default export, isn't a conformance suite, or null when it is.
 * @param {unknown} value
 * @returns {string | null}
 */
export function suiteProblem(value) {
	if (typeof value !== 'object' || value === null) return 'its default export is not an object';
	const { plugins } = /** @type {{ plugins?: unknown }} */ (value);
	if (!Array.isArray(plugins) || plugins.length === 0) return 'its default export lists no plugins';
	const unnamed = plugins.filter((plugin) => typeof plugin?.name !== 'string');
	return unnamed.length > 0 ? 'a plugin in its default export has no name' : null;
}

/**
 * One line per kit run, for the log a CI job prints.
 * @param {{ kinds: { kind: string, cells: { status: string }[] }[], containers: { kind: string, cells: { status: string }[] }[], inline: { prefix: string, cells: { status: string }[] }[] }} report
 * @returns {string[]}
 */
export function reportLines(report) {
	/** @param {{ status: string }[]} cells */
	const tally = (cells) => {
		/** @type {Record<string, number>} */
		const counts = {};
		for (const { status } of cells) counts[status] = (counts[status] ?? 0) + 1;
		return Object.entries(counts)
			.map(([status, count]) => `${count} ${status}`)
			.join(', ');
	};
	return [
		...report.kinds.map(({ kind, cells }) => `kind checkup, ${kind}: ${tally(cells)}`),
		...report.containers.map(({ kind, cells }) => `container checkup, ${kind}: ${tally(cells)}`),
		...report.inline.map(({ prefix, cells }) => `inline checkup, ${prefix}: ${tally(cells)}`)
	];
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

	const record = { package: name, version: plugin.version, editor: editor.version };
	console.log(`checking ${name}@${plugin.version} against ${editor.name}@${editor.version}`);
	let result;
	try {
		const report = await runPluginConformance(suite);
		for (const line of reportLines(report)) console.log(`  ${line}`);
		result = { ...record, result: 'pass', failures: null };
	} catch (error) {
		console.error(/** @type {Error} */ (error).message);
		result = { ...record, result: 'fail', failures: /** @type {Error} */ (error).message };
	}
	if (jsonFile)
		writeFileSync(path.resolve(cwd, jsonFile), JSON.stringify(result, null, '\t') + '\n');
	console.log(
		result.result === 'pass' ? 'aragonite-plugin-check: passed' : 'aragonite-plugin-check: failed'
	);
	return result.result === 'pass' ? 0 : 1;
}

// npm links the bin, so the path it was started by is compared once the link is resolved.
const startedAs = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : '';
if (import.meta.url === startedAs) {
	process.exitCode = await main(process.argv.slice(2), process.cwd());
}
