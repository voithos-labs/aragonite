// Single source of truth for the published tarball manifest, derived from package.json
// `exports` plus the two files no export entry names. verify-pack.mjs gates the tarball
// against this list; the G4.10 parity lint guards the derivation against the plugin source
// tree, so a new plugin subpath flows into both automatically.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SOURCE_CONDITION, selfImportSpecifiers } from '../lib-alias.mjs';

// Shipped, but named by no `exports` entry: the `/svelte` entry re-exports `Editor.svelte`, which
// imports `editor.css`. Package-root-relative to match `npm pack --json` file paths.
const EXTRA_PATHS = ['dist/components/Editor.svelte', 'dist/styles/editor.css'];

/**
 * @param {unknown} value
 * @param {string[]} out
 */
export function collectLeafStrings(value, out) {
	if (typeof value === 'string') out.push(value);
	else if (value && typeof value === 'object') {
		// The source condition names a repo file, which the tarball doesn't carry.
		for (const [key, nested] of Object.entries(value)) {
			if (key !== SOURCE_CONDITION) collectLeafStrings(nested, out);
		}
	}
}

/**
 * Every path the tarball must contain, package-root-relative, deduped and sorted.
 * @returns {string[]}
 */
export function requiredPackPaths() {
	const pkg = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8'));
	/** @type {string[]} */
	const fromExports = [];
	collectLeafStrings(pkg.exports ?? {}, fromExports);
	const normalized = fromExports.map((target) => target.replace(/^\.\//, ''));
	return [...new Set([...normalized, ...EXTRA_PATHS])].sort();
}

/**
 * The packages the prebuilt build leaves to the host: every dependency and peer but Svelte, which
 * it compiles in so a host without a Svelte toolchain needs no Svelte at all, and the library's
 * own self-imports, which the host resolves by its build's conditions.
 * @returns {string[]}
 */
export function prebuiltExternals() {
	const pkg = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8'));
	const names = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies });
	return [...names.filter((name) => name !== 'svelte'), ...selfImportSpecifiers()].sort();
}
