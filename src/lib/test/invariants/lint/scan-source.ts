/**
 * Shared primitives for the source-scan guards: editor source off disk, asserted against
 * structural patterns the type system can't express. Comment-stripping matters — an
 * invariant is documented in comments naming the very tokens its scan looks for, so a raw
 * substring match would flag its own documentation.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const EDITOR_SRC = path.resolve('src/lib');

/** The demo/dev harness tree. Reachable only with `includeTests` — most of it sits under `test`. */
export const ROUTES_SRC = path.resolve('src/routes');

/**
 * The roots a repo-wide scan must cover: the library, plus the repo's only first-party
 * stand-ins for an external author (the reference plugins and the consumer example). A
 * rule that holds for `src/lib` and not for them ships a reference implementation that
 * models the violation. A genuinely library-internal lint opts out by passing
 * `EDITOR_SRC` explicitly and saying why.
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
 * Blank comments to spaces, preserving offsets, so a token inside a comment can't trip a
 * code scan. Naive w.r.t. markers inside string/regex literals, which is acceptable: the
 * scans match call/read shapes rather than bare tokens.
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
 * `includeTests` is for a rule that binds the whole packaged tree, not just runtime code;
 * `includeStyles` adds `.css`, off by default so a code-shape scan never reads stylesheet
 * text (a `url(//…)` would blank as a comment).
 */
export function collectEditorSources(
	dir?: string,
	options: { includeTests?: boolean; includeStyles?: boolean } = {}
): SourceFile[] {
	const repoRoot = path.resolve('.');
	const files: SourceFile[] = [];

	function walk(current: string): void {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) {
				if (!options.includeTests && (entry.name === 'test' || entry.name === 'e2e')) continue;
				walk(full);
				continue;
			}
			const isScannable =
				(entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) ||
				entry.name.endsWith('.svelte') ||
				(options.includeStyles === true && entry.name.endsWith('.css'));
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

// ── Raw-write statements ─────────────────────────────────────────────────────

/** Bound on a statement's span, so a missing semicolon can't swallow the rest of the file. */
const MAX_STATEMENT_SPAN = 600;

/**
 * Every `<expr>.raw = …;` / `.raw += …;` statement, terminated at the semicolon and NOT at a
 * newline: Prettier wraps exactly the long concatenations G4.20's literal arm reads, and
 * stopping at the first newline truncates them to `.raw =` with no right-hand side in sight.
 * G4.28 reads the same statements as its bare-write census.
 */
export function rawAssignments(
	sources: SourceFile[]
): Array<{ relPath: string; statement: string }> {
	const out: Array<{ relPath: string; statement: string }> = [];
	for (const f of sources) {
		const re = /\.raw\s*\+?=(?!=)/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(f.code)) !== null) {
			let depth = 0;
			let quote: string | null = null;
			const limit = Math.min(f.code.length, m.index + MAX_STATEMENT_SPAN);
			let end = limit;
			for (let i = m.index; i < limit; i++) {
				const c = f.code[i];
				if (quote) {
					if (c === '\\') i++;
					else if (c === quote) quote = null;
					continue;
				}
				if (c === "'" || c === '"' || c === '`') quote = c;
				else if (c === '(' || c === '[' || c === '{') depth++;
				else if (c === ')' || c === ']' || c === '}') depth--;
				else if (c === ';' && depth <= 0) {
					end = i;
					break;
				} else if (c === '\n' && f.code[i + 1] === '\n' && depth <= 0) {
					end = i;
					break;
				}
			}
			out.push({ relPath: f.relPath, statement: f.code.slice(m.index, end) });
		}
	}
	return out;
}

// ── Call arguments ───────────────────────────────────────────────────────────

/**
 * A call to `name`. A spread (`...name(`) is one — the seam scans read call sites, and a result
 * spread into an array is where one of them hid; a property access (`x.name(`) is not.
 */
function callSiteRegex(name: string): RegExp {
	return new RegExp(`(?:(?<![\\w$.])|(?<=\\.\\.\\.))${name}\\s*\\(`, 'g');
}

/** The argument text of every call to `name`; pass comment-stripped code. Skips the declaration. */
export function callsTo(code: string, name: string): string[] {
	const out: string[] = [];
	const re = callSiteRegex(name);
	let m: RegExpExecArray | null;
	while ((m = re.exec(code)) !== null) {
		if (/function\s+$/.test(code.slice(Math.max(0, m.index - 12), m.index))) continue;
		const call = balancedCall(code, m.index + m[0].length);
		if (call !== null) out.push(call);
	}
	return out;
}

/** Whether `code` calls `name` at all — the membership form of {@link callsTo}. */
export function callsAnywhere(code: string, name: string): boolean {
	return callSiteRegex(name).test(code);
}

/**
 * Just after a call's opening paren to its matching close, parens balanced. Strings are skipped, so
 * a `)` inside an argument cannot truncate the slot a census then reads by position; the
 * string-blind read is the fallback, because `stripComments` leaves regex literals intact and a
 * lone quote in one runs the skip to EOF — dropping the site from the population entirely.
 */
export function balancedCall(code: string, openParenIndex: number): string | null {
	return matchingParen(code, openParenIndex, true) ?? matchingParen(code, openParenIndex, false);
}

function matchingParen(code: string, from: number, skipStrings: boolean): string | null {
	let depth = 1;
	let quote: string | null = null;
	for (let i = from; i < code.length; i++) {
		const ch = code[i];
		if (quote) {
			if (ch === '\\') i++;
			else if (ch === quote) quote = null;
			continue;
		}
		if (skipStrings && (ch === "'" || ch === '"' || ch === '`')) quote = ch;
		else if (ch === '(') depth++;
		else if (ch === ')' && --depth === 0) return code.slice(from, i);
	}
	return null;
}

/** A call's top-level arguments: split on the commas outside every bracket and string literal. */
export function callArguments(args: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let quote: string | null = null;
	let start = 0;
	for (let i = 0; i < args.length; i++) {
		const ch = args[i];
		if (quote) {
			if (ch === '\\') i++;
			else if (ch === quote) quote = null;
			continue;
		}
		if (ch === "'" || ch === '"' || ch === '`') quote = ch;
		else if (ch === '(' || ch === '[' || ch === '{') depth++;
		else if (ch === ')' || ch === ']' || ch === '}') depth--;
		else if (ch === ',' && depth === 0) {
			out.push(args.slice(start, i).trim());
			start = i + 1;
		}
	}
	out.push(args.slice(start).trim());
	return out;
}

/** The last top-level argument of a call's argument text — the slot the threading scans read. */
export function lastArgument(args: string): string {
	const parts = callArguments(args);
	return parts[parts.length - 1];
}
