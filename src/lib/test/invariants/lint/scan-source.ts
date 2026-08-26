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
 * Blank comments to spaces, preserving offsets, so a token inside a comment can't trip a code
 * scan. A marker inside a string, template or regex literal is text: blanking one truncates the
 * line and drops whatever followed from the census that reads it.
 */
export function stripComments(text: string): string {
	let out = '';
	let i = 0;
	while (i < text.length) {
		const span = spanAt(text, i);
		if (span === null) {
			out += text[i];
			i++;
			continue;
		}
		const source = text.slice(i, span.end);
		out += span.isComment ? source.replace(/[^\n]/g, ' ') : source;
		i = span.end;
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

// ── Literal-aware walk ───────────────────────────────────────────────────────

/**
 * Visit each character of `code` from `from` that is real code — strings, templates, comments
 * and regex literals are stepped over whole, so a bracket, comma or semicolon inside one never
 * reaches a census. Returns the index `visit` stopped at, or `code.length` if it ran out.
 */
function walkCode(
	code: string,
	from: number,
	visit: (ch: string, index: number) => boolean | void
): number {
	for (let i = from; i < code.length; i++) {
		const span = spanAt(code, i);
		if (span !== null) {
			i = span.end - 1;
			continue;
		}
		if (visit(code[i], i) === true) return i;
	}
	return code.length;
}

/**
 * The non-code span starting at `i` — string, template, comment or regex literal — or null
 * where code continues. The one place the lexing rules live.
 */
function spanAt(code: string, i: number): { end: number; isComment: boolean } | null {
	const ch = code[i];
	if (ch === "'" || ch === '"') return { end: skipString(code, i), isComment: false };
	if (ch === '`') return { end: skipTemplate(code, i), isComment: false };
	if (ch !== '/') return null;
	if (code[i + 1] === '/') return { end: endOfLine(code, i), isComment: true };
	if (code[i + 1] === '*') return { end: skipBlockComment(code, i), isComment: true };
	const past = opensRegex(code, i) ? skipRegex(code, i) : null;
	return past === null ? null : { end: past, isComment: false };
}

/** Index just past the string at `i`; an unterminated one ends at its line, as JS requires. */
function skipString(code: string, i: number): number {
	const quote = code[i];
	for (let j = i + 1; j < code.length; j++) {
		const ch = code[j];
		if (ch === '\\') j++;
		else if (ch === quote) return j + 1;
		else if (ch === '\n') return j;
	}
	return code.length;
}

/** Index just past the template literal at `i`; `${…}` interpolations are walked as code. */
function skipTemplate(code: string, i: number): number {
	for (let j = i + 1; j < code.length; j++) {
		const ch = code[j];
		if (ch === '\\') j++;
		else if (ch === '`') return j + 1;
		else if (ch === '$' && code[j + 1] === '{') {
			let depth = 1;
			j = walkCode(code, j + 2, (c) => {
				if (c === '{') depth++;
				else if (c === '}') return --depth === 0;
			});
		}
	}
	return code.length;
}

function endOfLine(code: string, i: number): number {
	const nl = code.indexOf('\n', i);
	return nl < 0 ? code.length : nl;
}

function skipBlockComment(code: string, i: number): number {
	const end = code.indexOf('*/', i + 2);
	return end < 0 ? code.length : end + 2;
}

/** Index just past the regex literal at `i`, or null when it does not close on its line. */
function skipRegex(code: string, i: number): number | null {
	let inClass = false;
	for (let j = i + 1; j < code.length; j++) {
		const ch = code[j];
		if (ch === '\\') j++;
		else if (ch === '\n') return null;
		else if (inClass) inClass = ch !== ']';
		else if (ch === '[') inClass = true;
		else if (ch === '/') return j + 1;
	}
	return null;
}

/** Operand position, which is where a `/` opens a regex; after a value it divides. */
const REGEX_OPERAND_CHARS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';']);

function opensRegex(code: string, at: number): boolean {
	let i = at - 1;
	while (i >= 0 && /\s/.test(code[i])) i--;
	if (i < 0) return true;
	if (code[i] === '>') return code[i - 1] === '=';
	if (REGEX_OPERAND_CHARS.has(code[i])) return true;
	let start = i + 1;
	while (start > 0 && /[\w$]/.test(code[start - 1])) start--;
	const word = code.slice(start, i + 1);
	return word === 'return' || word === 'typeof';
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
			const limit = Math.min(f.code.length, m.index + MAX_STATEMENT_SPAN);
			let depth = 0;
			let end = limit;
			walkCode(f.code, m.index, (c, i) => {
				if (i >= limit) return true;
				if (c === '(' || c === '[' || c === '{') depth++;
				else if (c === ')' || c === ']' || c === '}') depth--;
				else if (depth <= 0 && (c === ';' || (c === '\n' && f.code[i + 1] === '\n'))) {
					end = i;
					return true;
				}
			});
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
 * Just after a call's opening paren to its matching close, parens balanced. A bracket inside a
 * string, template, comment or regex literal cannot truncate the slot a census reads by position.
 */
export function balancedCall(code: string, openParenIndex: number): string | null {
	let depth = 1;
	const at = walkCode(code, openParenIndex, (ch) => {
		if (ch === '(') depth++;
		else if (ch === ')') return --depth === 0;
	});
	return at === code.length ? null : code.slice(openParenIndex, at);
}

/** A call's top-level arguments: split on the commas outside every bracket and literal. */
export function callArguments(args: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let start = 0;
	walkCode(args, 0, (ch, i) => {
		if (ch === '(' || ch === '[' || ch === '{') depth++;
		else if (ch === ')' || ch === ']' || ch === '}') depth--;
		else if (ch === ',' && depth === 0) {
			out.push(args.slice(start, i).trim());
			start = i + 1;
		}
	});
	out.push(args.slice(start).trim());
	return out;
}

/** The last top-level argument of a call's argument text — the slot the threading scans read. */
export function lastArgument(args: string): string {
	const parts = callArguments(args);
	return parts[parts.length - 1];
}
