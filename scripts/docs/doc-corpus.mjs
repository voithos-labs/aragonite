// The files the repository ships, walked one way by every docs check. A gitignored file (the
// owner's private roadmap and runbook) sits on disk beside them but ships nowhere, so no check
// reads it.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { posix } from 'node:path';

/** Build output and installed packages: never shipped, and slow to walk. */
const SKIPPED_DIRS = new Set(['node_modules', 'build', 'dist', '.svelte-kit']);

/**
 * The ignored paths under `roots`, a wholly ignored directory as one `dir/` entry so an installed
 * example app can't flood the listing. Outside a work tree nothing is ignored, which suits a
 * synthetic corpus in a temp dir; any other git failure throws rather than ignore nothing.
 * @param {string[]} roots
 * @returns {string[]}
 */
export function ignoredPaths(roots) {
	try {
		const listed = execSync(
			`git ls-files --others --ignored --exclude-standard --directory -- ${roots.map((root) => `"${root}"`).join(' ')}`,
			{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
		);
		return listed.split('\n').filter(Boolean);
	} catch (error) {
		const stderr = /** @type {{ stderr?: unknown }} */ (error).stderr;
		if (/not a git repository/i.test(String(stderr ?? ''))) return [];
		throw error;
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
	const ignored = ignoredPaths([...roots]);
	const found = roots.flatMap((root) => {
		if (!existsSync(root)) return [];
		return statSync(root).isDirectory() ? walk(root, extensions, []) : [root];
	});
	return found.filter((file) => !isIgnoredBy(ignored, file)).sort();
}

/**
 * Why a shipped doc can't cite `target` (a path from the working directory), or null when it can:
 * a CI checkout holds only what git tracks, so the target must exist and not be gitignored.
 * @param {string} target
 * @param {readonly string[]} ignored From {@link ignoredPaths} over the repository root.
 * @returns {string | null}
 */
export function citationProblem(target, ignored) {
	if (!existsSync(target)) return 'no such file or directory';
	if (statSync(target).isDirectory() && readdirSync(target).length === 0) {
		return "an empty directory, so a checkout doesn't have it";
	}
	const file = posix.normalize(target.split('\\').join('/'));
	if (isIgnoredBy(ignored, file) || isIgnoredBy(ignored, `${file}/`)) {
		return 'gitignored, so it exists only on this machine';
	}
	return null;
}

/**
 * Whether `file` (a posix path from the working directory) is one of `ignored` or under one of its
 * `dir/` entries.
 * @param {readonly string[]} ignored
 * @param {string} file
 * @returns {boolean}
 */
export function isIgnoredBy(ignored, file) {
	return ignored.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));
}
