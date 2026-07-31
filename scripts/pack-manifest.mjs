// Single source of truth for the published tarball manifest, derived from package.json
// `exports` plus the two files no export entry names. verify-pack.mjs gates the tarball
// against this list; the G4.10 parity lint guards the derivation against the plugin source
// tree, so a new plugin subpath flows into both automatically.
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Shipped, but named by no `exports` entry: the barrel re-exports `Editor.svelte`, which
// imports `editor.css`. Package-root-relative to match `npm pack --json` file paths.
const EXTRA_PATHS = ['dist/components/Editor.svelte', 'dist/styles/editor.css'];

/**
 * @param {unknown} value
 * @param {string[]} out
 */
function collectLeafStrings(value, out) {
	if (typeof value === 'string') out.push(value);
	else if (value && typeof value === 'object') {
		for (const nested of Object.values(value)) collectLeafStrings(nested, out);
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
