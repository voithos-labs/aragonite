/**
 * Shared primitives for the reactivity/timing source-scan guards (G4.1, G4.2,
 * G4.4). These read editor source off disk and assert structural patterns the
 * type system can't express. Comment-stripping matters: the invariants are
 * documented in comments that mention the very tokens we scan for, so a raw
 * substring match would flag its own documentation.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const EDITOR_SRC = path.resolve('src/lib');

/**
 * The roots a repo-wide scan must cover. The library is the obvious one; the
 * other two are the repo's only first-party stand-ins for an external author —
 * the reference plugins the e2e plugin suite drives, and the freeze-surface
 * consumer example. A rule that holds for `src/lib` and not for them ships a
 * reference implementation that models the violation, which is how an external
 * author learns it. Scanning defaults to all three (G4.x lint N+1 is wide by
 * construction); a lint whose rule is genuinely library-internal opts out by
 * passing `EDITOR_SRC` explicitly and saying why.
 *
 * `src/routes` cannot be a root: the walk skips any directory named `test`, so
 * the reference plugins are reachable only by naming their path directly.
 */
export const REPO_WIDE_ROOTS = [
	EDITOR_SRC,
	path.resolve('src/routes/test/plugins'),
	path.resolve('examples/consumer/src')
];

export interface SourceFile {
	/** Posix-style path relative to repo root, e.g. `src/lib/x.ts`. */
	relPath: string;
	/** Raw file text, comments intact. */
	text: string;
	/** File text with line and block comments blanked to whitespace. */
	code: string;
}

/**
 * Blank line and block comments to spaces (preserving offsets and newlines)
 * so a token inside a comment can't trip a code scan. Naive w.r.t. comment
 * markers inside string/regex literals — acceptable here: the scans match
 * specific call/read shapes, not bare tokens, so a marker in a literal won't
 * produce a false negative that hides a real violation.
 */
export function stripComments(text: string): string {
	let out = '';
	let i = 0;
	while (i < text.length) {
		const two = text.slice(i, i + 2);
		if (two === '//') {
			while (i < text.length && text[i] !== '\n') {
				out += ' ';
				i++;
			}
		} else if (two === '/*') {
			out += '  ';
			i += 2;
			while (i < text.length && text.slice(i, i + 2) !== '*/') {
				out += text[i] === '\n' ? '\n' : ' ';
				i++;
			}
			out += '  ';
			i += 2;
		} else {
			out += text[i];
			i++;
		}
	}
	return out;
}

/**
 * Recursively collect `.ts`/`.svelte` files under `dir`, excluding test, e2e,
 * and `.d.ts`. With no argument, scans every root in `REPO_WIDE_ROOTS`.
 */
export function collectEditorSources(dir?: string): SourceFile[] {
	const repoRoot = path.resolve('.');
	const files: SourceFile[] = [];

	function walk(current: string): void {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === 'test' || entry.name === 'e2e') continue;
				walk(full);
				continue;
			}
			const isScannable =
				(entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) ||
				entry.name.endsWith('.svelte');
			if (!isScannable) continue;
			const text = readFileSync(full, 'utf8');
			files.push({
				relPath: path.relative(repoRoot, full).split(path.sep).join('/'),
				text,
				code: stripComments(text)
			});
		}
	}

	for (const root of dir === undefined ? REPO_WIDE_ROOTS : [dir]) walk(root);
	return files;
}

export function readEditorFile(relFromEditor: string): SourceFile {
	const full = path.join(EDITOR_SRC, relFromEditor);
	const repoRoot = path.resolve('.');
	const text = readFileSync(full, 'utf8');
	return {
		relPath: path.relative(repoRoot, full).split(path.sep).join('/'),
		text,
		code: stripComments(text)
	};
}
