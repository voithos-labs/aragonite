// How code names the library: the `#lib` alias package.json `imports` declares for source files,
// and the entry points its `exports` publishes. The source scans and the consumer plugin sync read
// both through here, so each is spelled in package.json alone.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A path, not a URL: under a jsdom test the global URL is jsdom's, which `fs` refuses.
const PACKAGE_JSON = path.join(path.dirname(fileURLToPath(import.meta.url)), '../package.json');

const PACKAGE = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
/** @type {Record<string, string>} */
const IMPORTS = PACKAGE.imports ?? {};

const repoPath = (/** @type {string} */ target) => target.replace(/^\.\//, '');

/** Node refuses a `*` match with a `.`, `..` or `node_modules` path segment. */
const isValidMatch = (/** @type {string} */ middle) =>
	middle.split(/[/\\]/).every((part) => !['.', '..', 'node_modules'].includes(part.toLowerCase()));

/**
 * Whether a specifier is spelled with a package.json `imports` key, whether or not it maps to a
 * file (`#lib/x.js` is, `#fff` isn't).
 * @param {string} specifier
 * @returns {boolean}
 */
export function isAliasSpelling(specifier) {
	return Object.keys(IMPORTS).some((key) =>
		key.includes('*') ? specifier.startsWith(key.split('*')[0]) : specifier === key
	);
}

/**
 * The repo path a `#` specifier names as written, following Node's `imports` resolution
 * (`#lib/core/parser.js` names `src/lib/core/parser.js`), or null where Node would resolve none.
 * @param {string} specifier
 * @returns {string | null}
 */
export function aliasPath(specifier) {
	if (!specifier.startsWith('#')) return null;
	if (!specifier.includes('*') && Object.hasOwn(IMPORTS, specifier)) {
		return repoPath(IMPORTS[specifier]);
	}
	let best = null;
	for (const [key, target] of Object.entries(IMPORTS)) {
		const [prefix, suffix] = key.split('*');
		if (suffix === undefined || specifier.length < key.length) continue;
		if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
		const longer =
			best === null ||
			prefix.length > best.prefix.length ||
			(prefix.length === best.prefix.length && key.length > best.key.length);
		if (longer) best = { key, prefix, suffix, target };
	}
	if (best === null) return null;
	const middle = specifier.slice(best.prefix.length, specifier.length - best.suffix.length);
	return isValidMatch(middle) ? repoPath(best.target.replace('*', middle)) : null;
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

/**
 * Each published entry point, from package.json `exports`: the library path it is built from, as an
 * import names it, mapped to the package specifier a consumer imports it by
 * (`src/lib/plugin.js` to `@voithos-labs/aragonite/plugin`).
 * @returns {Map<string, string>}
 */
export function publishedEntries() {
	const out = new Map();
	for (const [subpath, target] of Object.entries(PACKAGE.exports ?? {})) {
		const built = typeof target === 'object' ? /^\.\/dist\/(.+\.js)$/.exec(target.default) : null;
		if (built !== null) out.set(`src/lib/${built[1]}`, `${PACKAGE.name}${subpath.slice(1)}`);
	}
	return out;
}
