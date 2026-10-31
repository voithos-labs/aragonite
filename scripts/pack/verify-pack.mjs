// Packs the library and gates the tarball: every published path must be present, and no
// test/e2e/spec file may ship. Then each workspace package's own. Run after `npm run package`.
// REQUIRED comes from package.json `exports` (pack-manifest.mjs), so an entry can't ship unbuilt.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { nodeImportFailures } from './node-import.mjs';
import { collectLeafStrings, requiredPackPaths } from './pack-manifest.mjs';
import { BLESS_COMMAND, verifyDevStrip } from './verify-dev-strip.mjs';
import { checkBudgets, readBaseline } from './size-budget.mjs';
import { verifyPrebuilt } from './verify-prebuilt.mjs';
import { verifyTypes } from './verify-types.mjs';
import { verifyPluginPackage } from './verify-plugin-package.mjs';
import { PLUGIN_KEYWORD, workspacePackages } from '../lib-alias.mjs';

// `npm pack --json` reports files[].path relative to the package root (`dist/index.js`), with no
// `package/` prefix.
const REQUIRED = requiredPackPaths();

// A broken derivation fails here rather than passing an unchecked tarball. The anchors are the two
// entry points every build ships.
if (
	REQUIRED.length === 0 ||
	!REQUIRED.includes('dist/index.js') ||
	!REQUIRED.includes('dist/plugin.js')
) {
	console.error(
		'verify-pack: derived REQUIRED is empty or missing anchor paths; check package.json exports'
	);
	process.exit(1);
}

/**
 * `npm pack --json` reported an array of pack results through npm 10 and switched to an
 * object keyed by package name in npm 11; both carry the same per-package `files[]`.
 * @param {string} json
 * @returns {string[]}
 */
function packedPaths(json) {
	const parsed = JSON.parse(json);
	const results = Array.isArray(parsed) ? parsed : Object.values(parsed ?? {});
	const files = results[0]?.files;
	return Array.isArray(files) ? files.map((f) => f.path) : [];
}

// --ignore-scripts, or the `prepack` script runs again and its output corrupts the JSON. A shell, so
// Windows resolves `npm` to `npm.cmd`.
const out = execSync('npm pack --dry-run --json --ignore-scripts', { encoding: 'utf8' });
const files = packedPaths(out);

// An unreadable pack report would pass every check below over an empty list.
if (files.length === 0) {
	console.error('verify-pack: `npm pack --json` reported no files; unrecognized output shape?');
	process.exit(1);
}

const missing = REQUIRED.filter((p) => !files.includes(p));

if (missing.length) {
	console.error('verify-pack: tarball missing required paths:\n  ' + missing.join('\n  '));
	process.exit(1);
}

const FORBIDDEN = files.filter((p) => /(^|\/)(test|e2e)\//.test(p) || /\.(test|spec)\./.test(p));
if (FORBIDDEN.length) {
	console.error(
		`verify-pack: tarball ships ${FORBIDDEN.length} test/e2e file(s), e.g.:\n  ` +
			FORBIDDEN.slice(0, 5).join('\n  ')
	);
	process.exit(1);
}

const prebuiltFailures = await verifyPrebuilt();
if (prebuiltFailures.length) {
	console.error('verify-pack: the prebuilt build fails:\n  ' + prebuiltFailures.join('\n  '));
	process.exit(1);
}

const strip = await verifyDevStrip();
if (strip.failures.length) {
	console.error(
		'verify-pack: a production build keeps the dev checks:\n  ' + strip.failures.join('\n  ')
	);
	process.exit(1);
}
const sizeFailures = checkBudgets(strip.sizes, readBaseline(), BLESS_COMMAND);
if (sizeFailures.length) {
	console.error(
		'verify-pack: a minimal app moved past its size budget (docs/contributing/testing.md § Size budgets):\n  ' +
			sizeFailures.join('\n  ')
	);
	process.exit(1);
}

const typeFailures = verifyTypes();
if (typeFailures.length) {
	console.error(
		'verify-pack: published types reach Svelte or a stylesheet:\n  ' + typeFailures.join('\n  ')
	);
	process.exit(1);
}

const workspaceFailures = workspacePackages().flatMap(({ dir, manifest }) => [
	...verifyWorkspacePackage(dir),
	...((manifest.keywords ?? []).includes(PLUGIN_KEYWORD) ? verifyPluginPackage(dir) : [])
]);
if (workspaceFailures.length) {
	console.error('verify-pack: a workspace package fails:\n  ' + workspaceFailures.join('\n  '));
	process.exit(1);
}

console.log(
	`verify-pack: OK (${files.length} files, all ${REQUIRED.length} required paths present)`
);

/**
 * A workspace package's tarball holds every path its `exports` names plus its license and readme,
 * each entry imports in Node with no DOM as a server render does, and a React wrapper's entries
 * open with `'use client'`, so a Next server component can render them. Run after it builds.
 * @param {string} dir
 * @returns {string[]}
 */
function verifyWorkspacePackage(dir) {
	const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
	const packed = packedPaths(
		execSync('npm pack --dry-run --json --ignore-scripts', { cwd: dir, encoding: 'utf8' })
	);
	/** @type {string[]} */
	const named = [];
	collectLeafStrings(pkg.exports ?? {}, named);
	const failures = [...named.map((target) => target.replace(/^\.\//, '')), 'LICENSE', 'README.md']
		.filter((target) => !packed.includes(target))
		.map((target) => `${pkg.name} ships no ${target}`);
	failures.push(...nodeImportFailures(dir));
	if (pkg.peerDependencies?.react) {
		for (const entry of named.filter((target) => target.endsWith('.js'))) {
			const file = path.join(dir, entry);
			if (existsSync(file) && !/^['"]use client['"]/.test(readFileSync(file, 'utf8'))) {
				failures.push(`${pkg.name}'s ${entry} doesn't open with 'use client'`);
			}
		}
	}
	return failures;
}
