// How code names the library: the `#lib` alias package.json `imports` declares for source files,
// the entry points its `exports` publishes, and the subpaths the library imports by its own name.
// The source scans and the consumer plugin sync read all three through here, so each is spelled in
// package.json alone.
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A path, not a URL: under a jsdom test the global URL is jsdom's, which `fs` refuses.
const PACKAGE_JSON = path.join(path.dirname(fileURLToPath(import.meta.url)), '../package.json');

const PACKAGE = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
/** @type {Record<string, string>} */
const IMPORTS = PACKAGE.imports ?? {};

const repoPath = (/** @type {string} */ target) => target.replace(/^\.\//, '');

/** The export condition the repo's own toolchain resolves, so a library import by package name
 *  reaches the source file rather than a build. */
export const SOURCE_CONDITION = 'aragonite-source';

/** Each subpath the library imports by its own package name (an `exports` entry carrying the
 *  source condition), from specifier to source file. */
const SELF_IMPORTS = new Map(
	Object.entries(PACKAGE.exports ?? {}).flatMap(([subpath, target]) => {
		if (typeof target !== 'object' || typeof target[SOURCE_CONDITION] !== 'string') return [];
		// Conditions match in key order, so behind `types` or `production` the source would lose.
		if (Object.keys(target)[0] !== SOURCE_CONDITION) {
			throw new Error(`package.json exports["${subpath}"] must list "${SOURCE_CONDITION}" first`);
		}
		return [[`${PACKAGE.name}${subpath.slice(1)}`, repoPath(target[SOURCE_CONDITION])]];
	})
);

/** Make this Node process resolve the source condition too, so a test runner that loads library
 *  source outside Vite (Playwright) reaches the self-imports' source files. */
export function resolveSelfImportsFromSource() {
	// Vitest resolves the condition through its own config and refuses Node's hooks. A process it
	// spawns inherits VITEST, so the check asks whether this process is a Vitest worker.
	if ('__vitest_worker__' in globalThis) return;
	registerHooks({
		resolve: (specifier, context, nextResolve) =>
			nextResolve(specifier, { ...context, conditions: [...context.conditions, SOURCE_CONDITION] })
	});
}

/** The specifiers the library imports itself by (`@voithos-labs/aragonite/dev-checks`). */
export function selfImportSpecifiers() {
	return [...SELF_IMPORTS.keys()];
}

/** Node refuses a `*` match with a `.`, `..` or `node_modules` path segment. */
const isValidMatch = (/** @type {string} */ middle) =>
	middle.split(/[/\\]/).every((part) => !['.', '..', 'node_modules'].includes(part.toLowerCase()));

/**
 * Whether a specifier names library source: a package.json `imports` key, whether or not it maps
 * to a file (`#lib/x.js` is, `#fff` isn't), or a subpath the library imports by its own name.
 * @param {string} specifier
 * @returns {boolean}
 */
export function isAliasSpelling(specifier) {
	if (SELF_IMPORTS.has(specifier)) return true;
	return Object.keys(IMPORTS).some((key) =>
		key.includes('*') ? specifier.startsWith(key.split('*')[0]) : specifier === key
	);
}

/**
 * The repo path a `#` specifier or a self-import names (`#lib/core/parser.js` names
 * `src/lib/core/parser.js`), or null when no `imports` key matches it Node's way or its `*` part
 * has a segment Node refuses.
 * @param {string} specifier
 * @returns {string | null}
 */
export function aliasPath(specifier) {
	const selfImport = SELF_IMPORTS.get(specifier);
	if (selfImport !== undefined) return selfImport;
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
 * The repo file an import names: a relative path, or what `bare` maps any other specifier to (a
 * `#` alias or a self-import, by default). Tried as written, as the `.ts` behind a `.js`, with
 * `.ts` or `.svelte` added, and as a directory's `index.ts`; null when none of those is a file.
 * @param {string} importer The importing file's repo path.
 * @param {string} specifier
 * @param {(candidate: string) => boolean} isFile
 * @param {(specifier: string) => string | null} [bare]
 * @returns {string | null}
 */
export function importedFile(importer, specifier, isFile, bare = aliasPath) {
	const written = specifier.replace(/\?.*$/, '');
	const base = written.startsWith('.')
		? path.posix.join(path.posix.dirname(importer), written)
		: bare(written);
	if (base === null) return null;
	const sourceOfJs = base.endsWith('.js') ? [`${base.slice(0, -'.js'.length)}.ts`] : [];
	const candidates = [base, ...sourceOfJs, `${base}.ts`, `${base}.svelte`, `${base}/index.ts`];
	return candidates.find(isFile) ?? null;
}

/**
 * @typedef {object} EntryPoint
 * @property {string} subpath The `exports` key, e.g. `./plugin`.
 * @property {string} source The library file it is built from, e.g. `src/lib/plugin.ts`.
 * @property {string} svelte The `svelte` condition's build, e.g. `dist/plugin.js`.
 * @property {string} prebuilt The `default` condition's build, e.g. `dist/prebuilt/plugin.js`.
 */

/**
 * Each published JavaScript entry point in package.json `exports`, with both of its builds (a
 * self-import subpath is not one). Throws on an entry whose `default` is not its `svelte` path
 * moved under `dist/prebuilt/` (G4.174).
 * @param {{ exports?: Record<string, any> }} [pkg] The manifest to read, this repo's by default.
 * @returns {EntryPoint[]}
 */
export function publishedEntryPoints(pkg = PACKAGE) {
	/** @type {EntryPoint[]} */
	const out = [];
	for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
		if (typeof target !== 'object' || SOURCE_CONDITION in target) continue;
		const svelte = repoPath(target.svelte ?? '');
		const prebuilt = repoPath(target.default ?? '');
		const built = /^dist\/(.+)\.js$/.exec(svelte);
		if (built === null || prebuilt !== `dist/prebuilt/${built[1]}.js`) {
			throw new Error(
				`package.json exports["${subpath}"] needs "svelte": "./dist/<path>.js" and "default": ` +
					`"./dist/prebuilt/<path>.js", but has "${svelte}" and "${prebuilt}"`
			);
		}
		out.push({ subpath, source: `src/lib/${built[1]}.ts`, svelte, prebuilt });
	}
	return out;
}

/**
 * Each published entry point's library path, as an import names it, mapped to the package
 * specifier a consumer imports it by (`src/lib/plugin.js` to `@voithos-labs/aragonite/plugin`).
 * @returns {Map<string, string>}
 */
export function publishedEntries() {
	return new Map(
		publishedEntryPoints().map(({ subpath, source }) => [
			source.replace(/\.ts$/, '.js'),
			`${PACKAGE.name}${subpath.slice(1)}`
		])
	);
}
