#!/usr/bin/env node
// Whether a change touches more than docs, for the CI jobs that skip a docs-only change.
// `node scripts/ci/ci-code-changed.mjs <base-sha>` prints `code=true` or `code=false`; a base git
// can't resolve (a new branch, a manual run) prints `code=true`, so a doubt runs everything.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Docs, which the browser suites never load, less the app content below. */
export const DOCS_ONLY = [/^docs\//, /\.md$/, /^\.github\/ISSUE_TEMPLATE\//];

/** Markdown the app itself renders (the changelog page, the showcase), which is code here. */
export const APP_CONTENT = [/^docs\/changelog\//, /^examples\/showcase\//];

/** @param {string[]} paths */
export function touchesCode(paths) {
	return paths.some(
		(file) =>
			APP_CONTENT.some((pattern) => pattern.test(file)) ||
			!DOCS_ONLY.some((pattern) => pattern.test(file))
	);
}

/** @param {string} base @returns {string[] | null} */
function changedSince(base) {
	try {
		execFileSync('git', ['cat-file', '-e', `${base}^{commit}`], { stdio: 'ignore' });
	} catch {
		return null;
	}
	const out = execFileSync('git', ['diff', '--name-only', base, 'HEAD'], { encoding: 'utf8' });
	return out.split('\n').filter((line) => line !== '');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const base = process.argv[2] ?? '';
	const paths = base === '' ? null : changedSince(base);
	console.log(`code=${paths === null || touchesCode(paths)}`);
}
