/**
 * Sibling-path parity: every route into the paste entry (`pasteDispatch`) and into its splice
 * (`replaceBlockAtParent`) must thread the instance grammar, or the pasted bytes — or the
 * bodyWrite escape's reparse of them — read an unlisted plugin's opener (GH #267). The scan sits
 * where a NEW paste route is born, since the omission is a missing key no type can require while
 * the caller wires its own argument object.
 */

import { describe, it, expect } from 'vitest';
import { balancedCall, collectEditorSources, stripComments } from './scan-source';

/** The paste entry, and the splice every structural route lands through. */
const GRAMMAR_TAKERS = 'pasteDispatch|replaceBlockAtParent';
const takerRe = (flags = '') => new RegExp(`\\b(?:${GRAMMAR_TAKERS})\\s*\\(`, flags);

interface GrammarlessCall {
	relPath: string;
	call: string;
}

/** Flag call sites of either taker whose argument object omits a `grammar` key. */
function findGrammarlessCalls(relPath: string, rawText: string): GrammarlessCall[] {
	const code = stripComments(rawText);
	const hits: GrammarlessCall[] = [];
	const callRe = takerRe('g');
	let m: RegExpExecArray | null;
	while ((m = callRe.exec(code)) !== null) {
		const before = code.slice(Math.max(0, m.index - 12), m.index);
		if (/function\s+$/.test(before)) continue;

		const call = balancedCall(code, m.index + m[0].length);
		if (call === null) continue;
		// Both spellings an argument object has: an explicit `grammar:` and the shorthand.
		if (!/\bgrammar\s*[:,}]/.test(call)) hits.push({ relPath, call });
	}
	return hits;
}

describe('paste grammar-thread source-scan', () => {
	const sources = collectEditorSources();

	it('found the paste call sites to validate', () => {
		const callSites = sources.filter((f) => takerRe().test(f.code));
		// Four clipboard routes and three splice sites, plus both declarations.
		expect(callSites.length).toBeGreaterThan(6);
	});

	it('every paste route threads the instance grammar', () => {
		const violations = sources.flatMap((f) => findGrammarlessCalls(f.relPath, f.text));
		expect(violations).toEqual([]);
	});

	// ── Matcher self-tests (non-vacuity) ────────────────────────────────────

	it('matcher flags a dispatch that omits grammar', () => {
		const bad = 'await pasteDispatch({ pastedText, targetPath }, { doc, blockEdit, controller });';
		expect(findGrammarlessCalls('synthetic.ts', bad)).toEqual([
			{
				relPath: 'synthetic.ts',
				call: '{ pastedText, targetPath }, { doc, blockEdit, controller }'
			}
		]);
	});

	it('matcher flags a splice that omits grammar', () => {
		const bad = 'await replaceBlockAtParent({ doc, blockPath, replacement, controller });';
		expect(findGrammarlessCalls('synthetic.ts', bad)).toEqual([
			{ relPath: 'synthetic.ts', call: '{ doc, blockPath, replacement, controller }' }
		]);
	});

	it('matcher accepts either spelling of the threaded grammar', () => {
		const shorthand = 'pasteDispatch(input, { doc, blockEdit, controller, grammar })';
		const explicit = 'replaceBlockAtParent({ doc, controller, grammar: input.grammar })';
		expect(findGrammarlessCalls('synthetic.ts', shorthand)).toEqual([]);
		expect(findGrammarlessCalls('synthetic.ts', explicit)).toEqual([]);
	});

	// The shape the next paste route is most likely born with, and the one a key-name scan
	// cannot see through.
	it('matcher flags an argument spread that names no grammar', () => {
		const spread = 'pasteDispatch(input, { ...ctx, seam });';
		expect(findGrammarlessCalls('synthetic.ts', spread)).toEqual([
			{ relPath: 'synthetic.ts', call: 'input, { ...ctx, seam }' }
		]);
	});

	it('matcher ignores the declarations and tokens in comments', () => {
		const decl =
			'export async function pasteDispatch(input, ctx) {}\n' +
			'export async function replaceBlockAtParent(args) {}\n' +
			'// pasteDispatch(input, { no grammar }) would be wrong';
		expect(findGrammarlessCalls('synthetic.ts', decl)).toEqual([]);
	});
});
