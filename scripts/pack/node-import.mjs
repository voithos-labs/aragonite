// Every JS entry Node resolves from a workspace package's `exports` imports in plain Node with no
// DOM, as a server render does (G4.188). Run after the package builds.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CORE_HOOK = pathToFileURL(
	path.join(path.dirname(fileURLToPath(import.meta.url)), 'core-from-checkout.mjs')
).href;

/**
 * One message per entry that throws on import, naming the package, the entry and the error. An
 * entry importing a stylesheet is skipped: Node loads no CSS, and a host's bundler does.
 * @param {string} dir the package's root
 * @returns {string[]}
 */
export function nodeImportFailures(dir) {
	const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
	const entries = Object.values(pkg.exports ?? {})
		.map((target) => (typeof target === 'string' ? target : target?.default))
		.filter((target) => typeof target === 'string' && target.endsWith('.js'))
		.filter(
			(target) =>
				!/^\s*import\s+['"][^'"]+\.css['"]/m.test(readFileSync(path.resolve(dir, target), 'utf8'))
		);
	const failures = [];
	for (const entry of entries) {
		const url = pathToFileURL(path.resolve(dir, entry)).href;
		// A child process, so the import sees neither this process's modules nor a test runner's DOM.
		const run = spawnSync(
			process.execPath,
			['--import', CORE_HOOK, '--input-type=module', '-e', `await import(${JSON.stringify(url)})`],
			{ encoding: 'utf8' }
		);
		if (run.status !== 0) {
			const error = run.stderr.split('\n').find((line) => /^\w*Error\b/.test(line));
			failures.push(`${pkg.name}'s ${entry} fails to import in Node: ${error ?? run.stderr}`);
		}
	}
	return failures;
}
