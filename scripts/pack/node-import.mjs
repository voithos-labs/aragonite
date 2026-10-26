// Every JS entry a wrapper package's `exports` names imports in plain Node with no DOM, as a
// server render does (G4.188). Run after the wrapper builds.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectLeafStrings } from './pack-manifest.mjs';

/**
 * One message per entry that throws on import, naming the package, the entry and the error.
 * @param {string} dir the package's root
 * @returns {string[]}
 */
export function nodeImportFailures(dir) {
	const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
	/** @type {string[]} */
	const named = [];
	collectLeafStrings(pkg.exports ?? {}, named);
	const failures = [];
	for (const entry of named.filter((target) => target.endsWith('.js'))) {
		const url = pathToFileURL(path.resolve(dir, entry)).href;
		// A child process, so the import sees neither this process's modules nor a test runner's DOM.
		const run = spawnSync(
			process.execPath,
			['--input-type=module', '-e', `await import(${JSON.stringify(url)})`],
			{ encoding: 'utf8' }
		);
		if (run.status !== 0) {
			const error = run.stderr.split('\n').find((line) => /^\w*Error\b/.test(line));
			failures.push(`${pkg.name}'s ${entry} fails to import in Node: ${error ?? run.stderr}`);
		}
	}
	return failures;
}
