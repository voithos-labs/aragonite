// The files the repository ships, walked one way by every docs check. A gitignored file (the
// owner's private roadmap and runbook) sits on disk beside them but ships nowhere, so no check
// reads it.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';

/** Build output and installed packages: never shipped, and slow to walk. */
const SKIPPED_DIRS = new Set(['node_modules', 'build', 'dist', '.svelte-kit']);

/**
 * Outside a work tree nothing is ignored, which suits a synthetic corpus in a temp dir.
 * @param {string[]} roots
 * @returns {Set<string>}
 */
function ignoredFiles(roots) {
	try {
		const listed = execSync(
			`git ls-files --others --ignored --exclude-standard -- ${roots.join(' ')}`,
			{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
		);
		return new Set(listed.split('\n').filter(Boolean));
	} catch {
		return new Set();
	}
}

/**
 * @param {string} dir
 * @param {readonly string[]} extensions
 * @param {string[]} out
 * @returns {string[]}
 */
function walk(dir, extensions, out) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (SKIPPED_DIRS.has(entry.name)) continue;
		const full = `${dir}/${entry.name}`;
		if (entry.isDirectory()) walk(full, extensions, out);
		else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(full);
	}
	return out;
}

/**
 * Every file under `roots` (a root may name one file) ending in one of `extensions`, as sorted
 * posix paths from the working directory, gitignored files dropped.
 * @param {readonly string[]} roots
 * @param {readonly string[]} extensions
 * @returns {string[]}
 */
export function corpusFiles(roots, extensions) {
	const ignored = ignoredFiles([...roots]);
	const found = roots.flatMap((root) => {
		if (!existsSync(root)) return [];
		return statSync(root).isDirectory() ? walk(root, extensions, []) : [root];
	});
	return found.filter((file) => !ignored.has(file)).sort();
}
