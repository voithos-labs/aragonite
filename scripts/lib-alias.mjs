// How a source file names library code through the `#lib` alias package.json `imports` declares.
// The source scans and the consumer plugin sync read specifiers through here, so the alias is
// spelled in package.json alone.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A path, not a URL: under a jsdom test the global URL is jsdom's, which `fs` refuses.
const PACKAGE_JSON = path.join(path.dirname(fileURLToPath(import.meta.url)), '../package.json');

/** @type {Record<string, string>} */
const IMPORTS = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')).imports ?? {};

const repoPath = (/** @type {string} */ target) => target.replace(/^\.\//, '');

/**
 * The repo path a `#` specifier names as written, read the way Node reads package.json `imports`
 * (`#lib/core/parser.js` names `src/lib/core/parser.js`), or null for any other specifier.
 * @param {string} specifier
 * @returns {string | null}
 */
export function aliasPath(specifier) {
	if (!specifier.startsWith('#')) return null;
	if (specifier in IMPORTS) return repoPath(IMPORTS[specifier]);
	let match = null;
	for (const [key, target] of Object.entries(IMPORTS)) {
		const [prefix, suffix] = key.split('*');
		if (suffix === undefined || specifier.length < key.length - 1) continue;
		if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
		if (match !== null && match.prefix.length >= prefix.length) continue;
		const middle = specifier.slice(prefix.length, specifier.length - suffix.length);
		match = { prefix, path: repoPath(target.replace('*', middle)) };
	}
	return match?.path ?? null;
}

/**
 * The `#` specifier that imports a repo file or directory, a `.ts` file spelled `.js` the way an
 * import names it (`src/lib/core/parser.ts` is `#lib/core/parser.js`).
 * @param {string} relPath
 * @returns {string}
 */
export function aliasSpecifier(relPath) {
	const written = relPath.replace(/\.ts$/, '.js');
	for (const [key, target] of Object.entries(IMPORTS)) {
		if (!key.includes('*') && repoPath(target) === written) return key;
	}
	for (const [key, target] of Object.entries(IMPORTS)) {
		const [prefix, suffix] = repoPath(target).split('*');
		if (suffix === undefined || !written.startsWith(prefix) || !written.endsWith(suffix)) continue;
		return key.replace('*', written.slice(prefix.length, written.length - suffix.length));
	}
	throw new Error(`no package.json imports entry covers ${relPath}`);
}
