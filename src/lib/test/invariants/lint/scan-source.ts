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

/** Recursively collect `.ts`/`.svelte` files under `dir`, excluding test, e2e, and `.d.ts`. */
export function collectEditorSources(dir = EDITOR_SRC): SourceFile[] {
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

	walk(dir);
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
