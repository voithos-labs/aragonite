// Single source of truth for the published tarball manifest: every path the pack
// MUST ship. Derived from package.json `exports` (each subpath's resolved dist
// targets) plus the two files no export entry names — the Svelte component the
// barrel re-exports and the structural stylesheet it pulls. verify-pack.mjs gates
// the tarball against this list; the G4.10 parity lint guards the derivation
// against the plugin source tree. A new plugin subpath added to `exports` flows
// into both automatically, so it can't be forgotten.
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Shipped, but named by no `exports` entry: `Editor.svelte` is re-exported by the
// barrel rather than being its own subpath; `editor.css` is the structural
// stylesheet the component imports (`editor-theme.css` IS an export). Paths are
// package-root-relative to match `npm pack --json` file paths (`dist/...`, no
// leading `./`).
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
