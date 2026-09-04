/**
 * G4.27 — every call of the core `parse` entry declares its scope. The default is
 * `'document'`, so a fragment caller that stays silent hands one block's bytes to the
 * openers as if they were a whole document, and a position-scoped kind mints wherever the
 * edited block sat (issue #52). Scope is the caller's knowledge alone: nothing in `parse`
 * can recover it, so the declaration has to be at the call.
 */
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { balancedCall, collectEditorSources, EDITOR_SRC, type SourceFile } from './scan-source';

/**
 * `core/parser.ts` declares the entry and carries the flag positionally from there;
 * `testing/` is the published conformance kits, whose fixtures are whole documents.
 */
const UNSCANNED = ['src/lib/core/parser.ts', 'src/lib/testing/'];

/** Each call allowed to stay silent, keyed `relPath:line` → why. */
const KNOWN_IMPLICIT: Record<string, string> = {};

const RULE =
	'every parse() call outside core/parser.ts must pass an explicit scope: ' +
	"{ scope: 'fragment' } for one block's bytes (a commit reparse, a clipboard parse, a " +
	"container body), { scope: 'document' } for whole source. Silence reads as document";

// A CALL of the core entry, excluding its declaration and any `x.parse(` / `parseFoo(`.
// Kept non-global: a shared /g regex carries `lastIndex` from one scan into the next.
const CALL_RE = /(?<!function\s)(?<![\w.$])parse\s*\(/;

export function implicitScopeCalls(file: SourceFile): string[] {
	const hits: string[] = [];
	for (const match of file.code.matchAll(new RegExp(CALL_RE, 'g'))) {
		// An unbalanced call reads as silent rather than borrowing the next call's scope.
		if (balancedCall(file.code, match.index + match[0].length)?.includes('scope:')) continue;
		const line = file.code.slice(0, match.index).split('\n').length;
		hits.push(`${file.relPath}:${line}`);
	}
	return hits;
}

describe('G4.27 every parse() call declares its scope', () => {
	// The consumer example writes the documented default (whole-document parses); this rule is
	// about internal reparse seams, so it scans the library and the plugin-route author stand-in.
	const sources = [EDITOR_SRC, path.resolve('src/routes/test/plugins')]
		.flatMap((root) => collectEditorSources(root))
		.filter((f) => !UNSCANNED.some((prefix) => f.relPath.startsWith(prefix)));

	it('inspected the tree, including files that do call parse()', () => {
		expect(sources.some((f) => CALL_RE.test(f.code))).toBe(true);
	});

	it('no call falls back to the implicit document scope', () => {
		const implicit = sources.flatMap(implicitScopeCalls);
		expect(implicit.filter((hit) => !(hit in KNOWN_IMPLICIT))).toEqual([]);
	});

	it('every allowlist entry still names a silent call', () => {
		const live = new Set(sources.flatMap(implicitScopeCalls));
		expect(Object.keys(KNOWN_IMPLICIT).filter((hit) => !live.has(hit))).toEqual([]);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	const scan = (code: string) => implicitScopeCalls({ relPath: 's.ts', text: code, code });

	it('flags a silent call and spares a scoped one', () => {
		expect(scan('const d = parse(raw);'), RULE).toEqual(['s.ts:1']);
		expect(scan("const d = parse(raw, { scope: 'fragment' });")).toEqual([]);
		expect(scan("parse(text, { grammar, scope: 'document' })")).toEqual([]);
	});

	// Miss-analysis: the private walk tracked quotes but not regex literals, and its own cases only
	// ever fed it strings, so the argument slot it truncated at one was never read back.
	it('reads past a paren inside a regex literal', () => {
		expect(scan("parse(strip(a, /)/), { scope: 'fragment' })")).toEqual([]);
	});

	it('reads past nested calls and parens inside strings', () => {
		expect(scan("parse(strip(a, (b)), { scope: 'fragment' })")).toEqual([]);
		expect(scan('parse(unclosed(")"), { scope: \'fragment\' })')).toEqual([]);
		// The unbalanced paren lives in a string, so the scan must not run on and borrow
		// the NEXT call's scope.
		expect(scan("parse(')');\nparse(x, { scope: 'fragment' });")).toEqual(['s.ts:1']);
	});

	it('ignores lookalikes and the declaration itself', () => {
		expect(scan('parseInline(raw); JSON.parse(raw); doc.parse(raw); reparse(raw);')).toEqual([]);
		expect(scan('export function parse(source: string): Document {')).toEqual([]);
	});

	it('reports the call line, not the file start', () => {
		expect(scan('const a = 1;\n\nparse(raw);')).toEqual(['s.ts:3']);
	});
});
