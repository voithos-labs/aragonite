/**
 * Sibling-path parity: every clipboard route into `pasteDispatch` must thread the instance
 * grammar, or a paste landing there parses an unlisted plugin's syntax to that plugin's kind
 * (GH #267). The scan sits where a NEW paste route is born, since the omission is a missing
 * key no type can require while the caller is a component wiring its own context.
 */

import { describe, it, expect } from 'vitest';
import { balancedCall, collectEditorSources, stripComments } from './scan-source';

interface GrammarlessCall {
	relPath: string;
	call: string;
}

/** Flag `pasteDispatch(<args>)` call sites whose context object omits a `grammar:` key. */
function findGrammarlessCalls(relPath: string, rawText: string): GrammarlessCall[] {
	const code = stripComments(rawText);
	const hits: GrammarlessCall[] = [];
	const callRe = /pasteDispatch\s*\(/g;
	let m: RegExpExecArray | null;
	while ((m = callRe.exec(code)) !== null) {
		const before = code.slice(Math.max(0, m.index - 12), m.index);
		if (/function\s+$/.test(before)) continue;

		const call = balancedCall(code, m.index + m[0].length);
		if (call === null) continue;
		// Both spellings a context literal has: an explicit `grammar:` and the shorthand.
		if (!/\bgrammar\s*[:,}]/.test(call)) hits.push({ relPath, call });
	}
	return hits;
}

describe('pasteDispatch grammar-thread source-scan', () => {
	const sources = collectEditorSources();

	it('found the paste call sites to validate', () => {
		const callSites = sources.filter((f) => /pasteDispatch\s*\(/.test(f.code));
		// The four clipboard routes plus the declaration.
		expect(callSites.length).toBeGreaterThan(4);
	});

	it('every paste route threads the instance grammar', () => {
		const violations = sources.flatMap((f) => findGrammarlessCalls(f.relPath, f.text));
		expect(violations).toEqual([]);
	});

	// ── Matcher self-test (non-vacuity) ─────────────────────────────────────

	it('matcher flags a call that omits grammar', () => {
		const bad = 'await pasteDispatch({ pastedText, targetPath }, { doc, blockEdit, controller });';
		expect(findGrammarlessCalls('synthetic.ts', bad)).toEqual([
			{
				relPath: 'synthetic.ts',
				call: '{ pastedText, targetPath }, { doc, blockEdit, controller }'
			}
		]);
	});

	it('matcher accepts either spelling of the threaded grammar', () => {
		const shorthand = 'pasteDispatch(input, { doc, blockEdit, controller, grammar })';
		const explicit = 'pasteDispatch(input, { doc, controller, grammar: deps.grammar })';
		expect(findGrammarlessCalls('synthetic.ts', shorthand)).toEqual([]);
		expect(findGrammarlessCalls('synthetic.ts', explicit)).toEqual([]);
	});

	// The shape the next paste route is most likely born with, and the one a key-name scan
	// cannot see through.
	it('matcher flags a context spread that names no grammar', () => {
		const spread = 'pasteDispatch(input, { ...ctx, seam });';
		expect(findGrammarlessCalls('synthetic.ts', spread)).toEqual([
			{ relPath: 'synthetic.ts', call: 'input, { ...ctx, seam }' }
		]);
	});

	it('matcher ignores the declaration and tokens in comments', () => {
		const decl =
			'export async function pasteDispatch(input, ctx) {}\n' +
			'// pasteDispatch(input, { no grammar }) would be wrong';
		expect(findGrammarlessCalls('synthetic.ts', decl)).toEqual([]);
	});
});
