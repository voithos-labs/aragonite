/**
 * Shared primitives for the source-scan guards: editor source off disk, asserted against
 * structural patterns the type system can't express. Comment-stripping matters: an
 * invariant is documented in comments naming the very tokens its scan looks for, so a raw
 * substring match would flag its own documentation. The lexing itself is guarded by
 * `scan-source.differential.test.ts` (G4.57), which holds it against TypeScript's own lexer.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const EDITOR_SRC = path.resolve('src/lib');

/** The demo/dev harness tree. Reachable only with `includeTests`: most of it sits under `test`. */
export const ROUTES_SRC = path.resolve('src/routes');

/**
 * The roots a repo-wide scan covers: the library plus the reference plugins and the consumer
 * example, which stand in for an outside author and must not model a violation. A lint about
 * library internals alone passes `EDITOR_SRC` and says why.
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
	/** File text with line, block and markup comments blanked to whitespace. */
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
		out += strippedSpan(text, i, span);
		i = span.end;
	}
	return out;
}

/**
 * Every file under `root` ending in one of `extensions`, as sorted posix paths from the repo
 * root. A directory named in `skip` is not entered. The one directory walk the lints share.
 */
export function collectFiles(
	root: string,
	options: { extensions: readonly string[]; skip?: readonly string[] }
): string[] {
	const repoRoot = path.resolve('.');
	const found: string[] = [];
	function walk(current: string): void {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) {
				if (!options.skip?.includes(entry.name)) walk(full);
			} else if (options.extensions.some((extension) => entry.name.endsWith(extension))) {
				found.push(path.relative(repoRoot, full).split(path.sep).join('/'));
			}
		}
	}
	walk(path.resolve(root));
	return found.sort();
}

/** A source file by its path from the repo root, comments blanked in `code`. */
export function readSource(relPath: string): SourceFile {
	const text = readFileSync(path.resolve(relPath), 'utf8');
	return { relPath, text, code: stripComments(text) };
}

/**
 * Every `.ts`/`.svelte` file under `dir` (default: every root in `REPO_WIDE_ROOTS`), skipping
 * `test`, `e2e` and `.d.ts`. `includeTests` covers the whole packaged tree; `includeStyles` adds
 * `.css`, off by default because a `url(//…)` would blank as a comment.
 */
export function collectEditorSources(
	dir?: string,
	options: { includeTests?: boolean; includeStyles?: boolean } = {}
): SourceFile[] {
	const extensions = options.includeStyles ? ['.ts', '.svelte', '.css'] : ['.ts', '.svelte'];
	const skip = options.includeTests ? [] : ['test', 'e2e'];
	return (dir === undefined ? REPO_WIDE_ROOTS : [dir])
		.flatMap((root) => collectFiles(root, { extensions, skip }))
		.filter((relPath) => !relPath.endsWith('.d.ts'))
		.map(readSource);
}

export function readEditorFile(relFromEditor: string): SourceFile {
	return readSource(
		path.relative(path.resolve('.'), path.join(EDITOR_SRC, relFromEditor)).split(path.sep).join('/')
	);
}

/** The bundled plugins, by directory name under `src/lib/plugins`. */
export function bundledPluginDirs(): string[] {
	return readdirSync(path.resolve('src/lib/plugins'), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

// ── Literal-aware walk ───────────────────────────────────────────────────────

/**
 * Visit each character of `code` from `from` that is real code: strings, templates, comments
 * and regex literals are stepped over whole, so a bracket, comma or semicolon inside one never
 * reaches a census. Returns the index `visit` stopped at, or `code.length` if it ran out.
 */
export function walkCode(
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

export interface LiteralSpan {
	start: number;
	/** Index just past the literal's closing quote, backtick or regex flags. */
	end: number;
	kind: 'string' | 'template' | 'regex';
}

/** Every string, template and regex literal in `code`, outermost first; comments are skipped. */
export function literalSpans(code: string): LiteralSpan[] {
	const out: LiteralSpan[] = [];
	for (let i = 0; i < code.length; i++) {
		const span = spanAt(code, i);
		if (span === null) continue;
		if (span.kind === 'template') out.push({ start: i, end: span.end, kind: 'template' });
		else if (span.kind === 'literal') {
			out.push({ start: i, end: span.end, kind: code[i] === '/' ? 'regex' : 'string' });
		}
		i = span.end - 1;
	}
	return out;
}

/** The value of the string or template literal starting at `at`, or null where none starts
 *  there or a `${…}` interpolation makes it unknowable. */
export function stringLiteralAt(code: string, at: number): { value: string; end: number } | null {
	const span = spanAt(code, at);
	if (span === null || span.kind === 'comment' || code[at] === '/') return null;
	if (code[span.end - 1] !== code[at] || span.end - at < 2) return null;
	const body = code.slice(at + 1, span.end - 1);
	if (span.kind === 'template' && body.includes('${')) return null;
	const escapes: Record<string, string> = { n: '\n', t: '\t', r: '\r' };
	return { value: body.replace(/\\(.)/gs, (_, ch: string) => escapes[ch] ?? ch), end: span.end };
}

/** The regex literal starting at `at`, compiled, or null where none starts there. */
export function regexLiteralAt(code: string, at: number): { value: RegExp; end: number } | null {
	const span = spanAt(code, at);
	if (span === null || span.kind !== 'literal' || code[at] !== '/') return null;
	const literal = code.slice(at, span.end);
	const close = literal.lastIndexOf('/');
	try {
		return { value: new RegExp(literal.slice(1, close), literal.slice(close + 1)), end: span.end };
	} catch {
		return null;
	}
}

/**
 * The non-code span starting at `i` (a string, template, comment or regex literal), or null where
 * code continues. The one place the lexing rules live.
 */
function spanAt(code: string, i: number): Span | null {
	const ch = code[i];
	if (ch === "'" || ch === '"') return { end: skipString(code, i), kind: 'literal' };
	if (ch === '`') return { end: skipTemplate(code, i), kind: 'template' };
	// Markup's comment form, unconditional rather than `.svelte`-only: the walk reaches this
	// only in code position, and G4.57's TypeScript check fails if a `.ts` file ever writes one.
	if (ch === '<') {
		return code.startsWith('<!--', i) ? { end: skipMarkupComment(code, i), kind: 'comment' } : null;
	}
	if (ch !== '/') return null;
	if (code[i + 1] === '/') return { end: endOfLine(code, i), kind: 'comment' };
	if (code[i + 1] === '*') return { end: skipBlockComment(code, i), kind: 'comment' };
	const past = opensRegex(code, i) ? skipRegex(code, i) : null;
	return past === null ? null : { end: past, kind: 'literal' };
}

interface Span {
	end: number;
	kind: 'comment' | 'template' | 'literal';
}

/** A span as `stripComments` writes it: a comment blanks, a template keeps its own bytes and
 *  its `${…}` interpolations stay code. */
function strippedSpan(text: string, start: number, span: Span): string {
	const source = text.slice(start, span.end);
	if (span.kind === 'comment') return source.replace(/[^\n]/g, ' ');
	if (span.kind !== 'template') return source;
	let out = '';
	let at = start;
	skipTemplate(text, start, (from, to) => {
		out += text.slice(at, from) + stripComments(text.slice(from, to));
		at = to;
	});
	return out + text.slice(at, span.end);
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
function skipTemplate(
	code: string,
	i: number,
	onInterpolation?: (start: number, end: number) => void
): number {
	for (let j = i + 1; j < code.length; j++) {
		const ch = code[j];
		if (ch === '\\') j++;
		else if (ch === '`') return j + 1;
		else if (ch === '$' && code[j + 1] === '{') {
			let depth = 1;
			const close = walkCode(code, j + 2, (c) => {
				if (c === '{') depth++;
				else if (c === '}') return --depth === 0;
			});
			onInterpolation?.(j + 2, close);
			j = close;
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

function skipMarkupComment(code: string, i: number): number {
	const end = code.indexOf('-->', i + 4);
	return end < 0 ? code.length : end + 3;
}

/** Index just past the regex literal at `i` and its flags, or null if it never closes. */
function skipRegex(code: string, i: number): number | null {
	let inClass = false;
	for (let j = i + 1; j < code.length; j++) {
		const ch = code[j];
		if (ch === '\\') j++;
		else if (ch === '\n') return null;
		else if (inClass) inClass = ch !== ']';
		else if (ch === '[') inClass = true;
		else if (ch === '/') {
			let end = j + 1;
			while (end < code.length && code[end] >= 'a' && code[end] <= 'z') end++;
			return end;
		}
	}
	return null;
}

/**
 * Operand position, which is where a `/` opens a regex; after a value it divides. `}` is not
 * one: TypeScript's own parser finds no regex preceded by `}` anywhere in the tree, while
 * Svelte markup (`{a}/{b}`) is full of the shape.
 */
const REGEX_OPERAND_CHARS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', ';']);

/** Reserved words an expression directly follows, so a `/` after one opens a regex (`if` for
 *  Svelte's `{#if …}`). A plain identifier never joins: it can be a value. */
const REGEX_OPERAND_WORDS = new Set([
	'await',
	'case',
	'delete',
	'do',
	'else',
	'if',
	'in',
	'instanceof',
	'new',
	'return',
	'throw',
	'typeof',
	'void',
	'yield'
]);

function opensRegex(code: string, at: number): boolean {
	let i = at - 1;
	while (i >= 0 && /\s/.test(code[i])) i--;
	if (i < 0) return true;
	if (code[i] === '>') return code[i - 1] === '=';
	if (REGEX_OPERAND_CHARS.has(code[i])) return true;
	let start = i + 1;
	while (start > 0 && /[\w$]/.test(code[start - 1])) start--;
	if (start > 0 && code[start - 1] === '.') return false;
	return REGEX_OPERAND_WORDS.has(code.slice(start, i + 1));
}

// ── Prose surfaces ──────────────────────────────────────────────────────

/** A component mounting an editable surface of its own. */
const SURFACE_FACTORY = /\bcreateEditable(?:Surface|Leaf)\s*\(/;

/** Its own beforeinput listener, which is where a native edit is claimed or lost. */
const INSTALLS_BEFOREINPUT = /\bonbeforeinput\s*=/;

/** Hosting inline constructs is what makes a surface prose: the delimiter runs a keystroke can
 *  reach are exactly what the policy table answers for. */
const READS_INLINE_POLICY =
	/(?<![\w.])(getInlineConstructPolicy|getInlineMarkPolicy|inlineMarkForCommand|isCardEditableInlineKind|isRevealableInlineKind)\s*\(/;

/** The editable blocks every prose `beforeinput` handler has to reach (G4.44, G4.65). */
export function isProseSurface(file: SourceFile): boolean {
	return (
		file.relPath.endsWith('.svelte') &&
		SURFACE_FACTORY.test(file.code) &&
		INSTALLS_BEFOREINPUT.test(file.code) &&
		READS_INLINE_POLICY.test(file.code)
	);
}

// ── Lexical classification ───────────────────────────────────────────────────

/** Class names in the order {@link lexicalClasses} numbers them. */
export const LEXICAL_CLASSES = ['code', 'comment', 'string', 'template', 'regex'] as const;

const [CODE, COMMENT, STRING, TEMPLATE, REGEX] = LEXICAL_CLASSES.map((_, index) => index);

/** Each character's class, exported so the differential can hold this lexer against TypeScript's. */
export function lexicalClasses(code: string): Uint8Array {
	const out = new Uint8Array(code.length);
	classifyRange(code, 0, code.length, out);
	return out;
}

/** A template's `${…}` interiors are code, which is how `stripComments` already reads them. */
function classifyRange(code: string, from: number, to: number, out: Uint8Array): void {
	out.fill(CODE, from, to);
	for (let i = from; i < to; i++) {
		const span = spanAt(code, i);
		if (span === null) continue;
		const end = Math.min(span.end, to);
		if (span.kind === 'comment') out.fill(COMMENT, i, end);
		else if (span.kind === 'literal') out.fill(code[i] === '/' ? REGEX : STRING, i, end);
		else {
			out.fill(TEMPLATE, i, end);
			skipTemplate(code, i, (start, close) => classifyRange(code, start, Math.min(close, to), out));
		}
		i = span.end - 1;
	}
}

// ── Enclosing function ───────────────────────────────────────────────────────

const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'do', 'else', 'with']);

/**
 * The nearest named function around `at`, walking out through blocks and anonymous scopes, or
 * `<module>` at the top level. Allowlists key on `relPath :: name`, which survives edits above
 * the site. Pass `classes` when naming several sites in one file.
 */
export function enclosingFunction(
	code: string,
	at: number,
	classes: Uint8Array = lexicalClasses(code)
): string {
	let from = at;
	for (let hop = 0; hop < 24; hop++) {
		const open = innermostOpener(code, classes, from);
		if (open === null) return '<module>';
		from = open;
		const paren =
			code[open] === '{'
				? parameterListOf(code, classes, open)
				: code[open] === '(' && parameterListAt(code, classes, open)
					? open
					: null;
		if (paren === null) continue;
		const name = functionNameBefore(code, classes, paren);
		if (name !== null) return name;
	}
	return '<module>';
}

/** The innermost bracket still open at `at`, or null at the top level. */
export function openerBefore(
	code: string,
	at: number,
	classes: Uint8Array = lexicalClasses(code)
): number | null {
	return innermostOpener(code, classes, at);
}

/** Whether the `(` at `open` starts a parameter list rather than an argument list: the
 *  `function` keyword before it, or a body or arrow after it. */
export function isParameterList(
	code: string,
	open: number,
	classes: Uint8Array = lexicalClasses(code)
): boolean {
	return parameterListAt(code, classes, open);
}

function innermostOpener(text: string, cls: Uint8Array, at: number): number | null {
	let depth = 0;
	for (let i = at - 1; i >= 0; i--) {
		if (cls[i] !== CODE) continue;
		const ch = text[i];
		if (ch === ')' || ch === ']' || ch === '}') depth++;
		else if (ch === '(' || ch === '[' || ch === '{') {
			if (depth === 0) return i;
			depth--;
		}
	}
	return null;
}

function matchingOpen(text: string, cls: Uint8Array, close: number): number | null {
	let depth = 0;
	for (let i = close; i >= 0; i--) {
		if (cls[i] !== CODE) continue;
		if (text[i] === ')') depth++;
		else if (text[i] === '(' && --depth === 0) return i;
	}
	return null;
}

function matchingClose(text: string, cls: Uint8Array, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		if (cls[i] !== CODE) continue;
		const ch = text[i];
		if (ch === '(') depth++;
		else if (ch === ')' && --depth === 0) return i;
	}
	return text.length;
}

function skipBack(text: string, cls: Uint8Array, from: number): number {
	let i = from;
	while (i >= 0 && (cls[i] !== CODE || /\s/.test(text[i]))) i--;
	return i;
}

function skipForward(text: string, cls: Uint8Array, from: number): number {
	let i = from;
	while (i < text.length && (cls[i] !== CODE || /\s/.test(text[i]))) i++;
	return i;
}

function identifierBefore(text: string, at: number): string {
	let start = at + 1;
	while (start > 0 && /[\w$]/.test(text[start - 1])) start--;
	return text.slice(start, at + 1);
}

function parameterListAt(text: string, cls: Uint8Array, open: number): boolean {
	const before = skipBack(text, cls, open - 1);
	const name = identifierBefore(text, before);
	if (name === 'function') return true;
	if (identifierBefore(text, skipBack(text, cls, before - name.length)) === 'function') return true;

	let after = skipForward(text, cls, matchingClose(text, cls, open) + 1);
	if (text[after] === ':') {
		let depth = 0;
		for (after++; after < text.length; after++) {
			if (cls[after] !== CODE) continue;
			const ch = text[after];
			if (ch === '(' || ch === '[' || ch === '<') depth++;
			else if (ch === ')' || ch === ']' || ch === '>') depth--;
			else if (depth <= 0 && (ch === '{' || ch === ';' || ch === ',' || ch === '=')) break;
		}
	}
	return text.startsWith('=>', after) || text[after] === '{';
}

/** The `(` of the parameter list a `{` closes over, or null where the brace opens a plain block
 *  or an object literal. Only a return type and an arrow may sit between the two. */
function parameterListOf(text: string, cls: Uint8Array, brace: number): number | null {
	let depth = 0;
	let between = '';
	for (let i = brace - 1; i >= 0; i--) {
		if (cls[i] !== CODE) continue;
		const ch = text[i];
		if (depth === 0) {
			if (ch === ')') {
				const gap = between.replace(/\s|=>/g, '');
				return gap === '' || gap.startsWith(':') ? matchingOpen(text, cls, i) : null;
			}
			if (ch === ';' || ch === '{' || ch === '}' || ch === '(' || ch === '[') return null;
		}
		if (ch === ')' || ch === ']' || ch === '}') depth++;
		else if (ch === '(' || ch === '[' || ch === '{') depth--;
		between = ch + between;
	}
	return null;
}

/** The name a parameter list at `paren` declares: `function name(`, `name(` for a method, or
 *  `const name = (` and `name: (` for an assigned arrow. Null for a control statement. */
function functionNameBefore(text: string, cls: Uint8Array, paren: number): string | null {
	const before = skipTypeParameters(text, cls, skipBack(text, cls, paren - 1));
	const direct = identifierBefore(text, before);
	if (CONTROL_KEYWORDS.has(direct)) return null;
	if (direct !== '' && direct !== 'function' && direct !== 'async') return direct;
	const anchor = direct === '' ? before : skipBack(text, cls, before - direct.length);
	if (text[anchor] !== '=' && text[anchor] !== ':') return null;
	const declared = text[anchor] === ':' ? anchor : annotationColonBefore(text, cls, anchor);
	const named = identifierBefore(text, skipBack(text, cls, declared - 1));
	return named === '' ? null : named;
}

/** The `:` of a declaration's type annotation, so `const f: Cleaner = (x) => …` reads as `f`. */
function annotationColonBefore(text: string, cls: Uint8Array, assign: number): number {
	let depth = 0;
	for (let i = assign - 1; i >= 0; i--) {
		if (cls[i] !== CODE) continue;
		const ch = text[i];
		if (ch === '>' || ch === ')' || ch === ']' || ch === '}') depth++;
		else if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth--;
		else if (depth === 0 && ch === ':') return i;
		if (depth === 0 && (ch === ';' || ch === ',' || ch === '{' || ch === '}')) break;
	}
	return assign;
}

/** Back over a type-parameter list, so `function pick<T>(…)` names `pick` and not the module. */
function skipTypeParameters(text: string, cls: Uint8Array, at: number): number {
	if (text[at] !== '>') return at;
	let depth = 0;
	for (let i = at; i >= 0; i--) {
		if (cls[i] !== CODE) continue;
		if (text[i] === '>') depth++;
		else if (text[i] === '<' && --depth === 0) return skipBack(text, cls, i - 1);
	}
	return at;
}

// ── Raw-write statements ─────────────────────────────────────────────────────

/** Bound on a statement's span, so a missing semicolon can't swallow the rest of the file. */
const MAX_STATEMENT_SPAN = 600;

/**
 * Every `<expr>.raw = …;` / `.raw += …;` statement, terminated at the semicolon and not at a
 * newline: Prettier wraps exactly the long concatenations G4.20's literal check reads, and
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
 * A call to `name`. A spread (`...name(`) counts as one, because these scans read call sites and
 * a result spread into an array is where one of them hid; a property access (`x.name(`) does not.
 */
function callSiteRegex(name: string): RegExp {
	return new RegExp(`(?:(?<![\\w$.])|(?<=\\.\\.\\.))${name}\\s*\\(`, 'g');
}

export interface CallSite {
	/** Offset of the callee name in the code. */
	index: number;
	/** The argument text, or null where the parens never close. */
	args: string | null;
}

/** Every call to `name` in comment-stripped code, declarations skipped. */
export function callSites(code: string, name: string): CallSite[] {
	const out: CallSite[] = [];
	const re = callSiteRegex(name);
	let m: RegExpExecArray | null;
	while ((m = re.exec(code)) !== null) {
		if (/function\s+$/.test(code.slice(Math.max(0, m.index - 12), m.index))) continue;
		const args = balancedCall(code, m.index + m[0].length);
		if (args !== null && hasTypedParameter(args)) continue;
		out.push({ index: m.index, args });
	}
	return out;
}

/** A top-level `name:` or `name?:` is a typed parameter, which only a declaration has: a method
 *  signature in an interface or class. */
function hasTypedParameter(args: string): boolean {
	return callArguments(args).some((arg) => /^[\w$]+\??:/.test(arg));
}

/** The argument text of every balanced call to `name`; pass comment-stripped code. */
export function callsTo(code: string, name: string): string[] {
	return callSites(code, name).flatMap((site) => (site.args === null ? [] : [site.args]));
}

/** Whether `code` calls `name` at all: the membership form of {@link callsTo}. */
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

/** A block's body from just after its opening brace to its matching close, braces balanced: the
 *  {@link balancedCall} shape over `{}`, for a census that reads whole function bodies. */
export function balancedBlock(code: string, openBraceIndex: number): string | null {
	let depth = 1;
	const at = walkCode(code, openBraceIndex, (ch) => {
		if (ch === '{') depth++;
		else if (ch === '}') return --depth === 0;
	});
	return at === code.length ? null : code.slice(openBraceIndex, at);
}

/** The region from the bracket at `openIndex` to its match, both ends included: the
 *  {@link balancedCall} walk for a census that reads a whole `(…)` or `{…}` rather than an interior. */
export function balancedRegion(code: string, openIndex: number): string | null {
	const open = code[openIndex];
	const close = open === '(' ? ')' : open === '[' ? ']' : '}';
	let depth = 0;
	const at = walkCode(code, openIndex, (ch) => {
		if (ch === open) depth++;
		else if (ch === close) return --depth === 0;
	});
	return at === code.length ? null : code.slice(openIndex, at + 1);
}

/** A call's top-level arguments: split on the commas outside every bracket and literal. */
export function callArguments(args: string): string[] {
	return splitTopLevel(args, ',');
}

/**
 * `code` split on `separator` outside every bracket and literal, each part trimmed. A separator
 * inside a longer operator (`++`, `+=`) does not split.
 */
export function splitTopLevel(code: string, separator: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let start = 0;
	walkCode(code, 0, (ch, i) => {
		if (ch === '(' || ch === '[' || ch === '{') depth++;
		else if (ch === ')' || ch === ']' || ch === '}') depth--;
		else if (ch === separator && depth === 0 && !partOfOperator(code, i)) {
			out.push(code.slice(start, i).trim());
			start = i + 1;
		}
	});
	out.push(code.slice(start).trim());
	return out;
}

function partOfOperator(code: string, i: number): boolean {
	const ch = code[i];
	return code[i - 1] === ch || code[i + 1] === ch || code[i + 1] === '=';
}

/** The last top-level argument of a call's argument text: the slot the threading scans read. */
export function lastArgument(args: string): string {
	const parts = callArguments(args);
	return parts[parts.length - 1];
}

// ── Import specifiers ────────────────────────────────────────────────────────

export interface ImportSpecifier {
	specifier: string;
	kind: 'static' | 'side-effect' | 'dynamic' | 'reexport';
}

/**
 * Every module a file imports or re-exports from, read in code position only: an import-shaped
 * line inside a string, template or comment is text. A static, side-effect or re-export form must
 * start its line, so a CSS `@import` in a `<style>` block is never one.
 */
export function importSpecifiers(code: string): ImportSpecifier[] {
	const out: ImportSpecifier[] = [];
	walkCode(code, 0, (ch, at) => {
		if (ch !== 'i' && ch !== 'e') return;
		const keyword = code.startsWith('import', at) ? 'import' : 'export';
		if (!code.startsWith(keyword, at) || !isWordAt(code, at, keyword.length)) return;
		const found = readImport(code, at, keyword);
		if (found !== null) out.push(found);
	});
	return out;
}

function isWordAt(code: string, at: number, length: number): boolean {
	return !/[\w$.@]/.test(code[at - 1] ?? '') && !/[\w$]/.test(code[at + length] ?? '');
}

function readImport(
	code: string,
	at: number,
	keyword: 'import' | 'export'
): ImportSpecifier | null {
	const next = skipSpaces(code, at + keyword.length);
	if (keyword === 'import' && code[next] === '(') {
		return stringSpecifier(code, skipSpaces(code, next + 1), 'dynamic');
	}
	if (!startsLine(code, at)) return null;
	if (keyword === 'import') {
		if (code[next] === "'" || code[next] === '"') return stringSpecifier(code, next, 'side-effect');
	} else {
		const clause = code.startsWith('type', next) ? skipSpaces(code, next + 4) : next;
		if (code[clause] !== '{' && code[clause] !== '*') return null;
	}
	const from = fromClauseEnd(code, next);
	return from === null
		? null
		: stringSpecifier(code, from, keyword === 'import' ? 'static' : 'reexport');
}

/** Just past the `from` that ends an import clause, or null where the statement has none. */
function fromClauseEnd(code: string, from: number): number | null {
	let depth = 0;
	let found: number | null = null;
	walkCode(code, from, (ch, i) => {
		if (ch === '{') depth++;
		else if (ch === '}') depth--;
		else if (depth === 0 && (ch === ';' || ch === '=' || ch === '(')) return true;
		else if (depth === 0 && code.startsWith('from', i) && isWordAt(code, i, 4)) {
			found = skipSpaces(code, i + 4);
			return true;
		}
	});
	return found;
}

function stringSpecifier(
	code: string,
	at: number,
	kind: ImportSpecifier['kind']
): ImportSpecifier | null {
	if (code[at] !== "'" && code[at] !== '"') return null;
	return { specifier: code.slice(at + 1, skipString(code, at) - 1), kind };
}

function skipSpaces(code: string, at: number): number {
	while (at < code.length && /\s/.test(code[at])) at++;
	return at;
}

function startsLine(code: string, at: number): boolean {
	let i = at - 1;
	while (i >= 0 && (code[i] === ' ' || code[i] === '\t')) i--;
	return i < 0 || code[i] === '\n';
}

// ── Hand-rolled lexing ───────────────────────────────────────────────────────

/** A comparison of one character against a bracket or a quote. */
const CHARACTER_TEST = /[!=]==\s*(['"`])[()[\]{}'"`]\1|(['"`])[()[\]{}'"`]\2\s*[!=]==/g;

/** A literal naming a comment marker, the first step of stripping comments by hand. */
const COMMENT_MARKERS = new Set(['//', '/*', '*/', '<!--', '-->']);

/**
 * What in a lint's own code reads source by hand instead of through this module: a directory
 * walk, a comment marker, or a loop testing characters for brackets or quotes outside a
 * {@link walkCode} callback. Empty for a file that reads code only through the shared lexer.
 */
export function handRolledLexing(code: string): string[] {
	const classes = lexicalClasses(code);
	const found: string[] = [];
	if (/\breaddirSync\b/.test(code)) found.push('a directory walk: use collectFiles');
	for (const span of literalSpans(code)) {
		const text = code.slice(span.start, span.end);
		const marker =
			span.kind === 'regex'
				? /\\\/\\\/|\\\/\\\*|<!--/.test(text)
				: COMMENT_MARKERS.has(text.slice(1, -1));
		if (marker) found.push(`a comment marker ${text}: use stripComments or lexicalClasses`);
	}
	for (const loop of code.matchAll(/\b(?:for|while)\s*\(/g)) {
		if (classes[loop.index] !== CODE) continue;
		const end = loopEnd(code, loop.index + loop[0].length - 1);
		for (const test of code.slice(loop.index, end).matchAll(CHARACTER_TEST)) {
			const at = loop.index + test.index + test[0].search(/[!=]==/);
			if (classes[at] !== CODE || insideWalkCallback(code, at, classes)) continue;
			found.push(`a character walk testing ${test[0]}: use walkCode`);
		}
	}
	return found;
}

/** Just past the statement a loop header opening at `open` governs. */
function loopEnd(code: string, open: number): number {
	const header = balancedRegion(code, open);
	if (header === null) return code.length;
	const bodyStart = skipSpaces(code, open + header.length);
	if (code[bodyStart] === '{') return bodyStart + (balancedRegion(code, bodyStart)?.length ?? 0);
	let depth = 0;
	return walkCode(code, bodyStart, (ch) => {
		if (ch === '(' || ch === '[' || ch === '{') depth++;
		else if (ch === ')' || ch === ']' || ch === '}') depth--;
		else if (ch === ';' && depth === 0) return true;
	});
}

function insideWalkCallback(code: string, at: number, classes: Uint8Array): boolean {
	for (let open = innermostOpener(code, classes, at); open !== null;) {
		if (
			code[open] === '(' &&
			identifierBefore(code, skipBack(code, classes, open - 1)) === 'walkCode'
		)
			return true;
		open = innermostOpener(code, classes, open);
	}
	return false;
}
