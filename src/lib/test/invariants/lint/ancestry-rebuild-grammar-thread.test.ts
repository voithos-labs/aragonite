/**
 * Sibling-path parity for the ancestry rebuild's grammar, the twin of
 * `nested-actions-grammar-thread`. The rebuild re-derives each container's kind
 * from its own bytes, and that re-parse must resolve through the INSTANCE grammar
 * or a kind the instance disabled materializes anyway.
 *
 * The parameter is required-nullable, so the type system already stops a caller
 * from omitting it. What it cannot stop is a caller answering `undefined` because
 * threading was inconvenient — which is exactly how this rule shipped at 3 of 12
 * sites. So the scan's subject is the literal `undefined`: a production call must
 * name a real grammar expression, and a site that genuinely has none declares
 * itself here rather than passing quietly.
 *
 * Exempt: the published container-conformance kit, which carries no editor
 * registry view to source an instance grammar from and asserts raw propagation
 * rather than any kind re-derivation. Tests are outside the scan entirely
 * (`collectEditorSources`), so a bare harness may pass `undefined` freely.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, stripComments } from './scan-source';

const CONFORMANCE_KIT = 'src/lib/testing/container-conformance.ts';

const SEAMS = ['rebuildUnsharedChain', 'rebuildUnsharedAncestry'] as const;

interface GlobalGrammarCall {
	relPath: string;
	call: string;
}

/** The text from just after the opening paren to its matching close, parens balanced. */
function balancedCall(code: string, openParenIndex: number): string | null {
	let depth = 1;
	let i = openParenIndex;
	while (i < code.length) {
		const ch = code[i];
		if (ch === '(') depth++;
		else if (ch === ')') {
			depth--;
			if (depth === 0) return code.slice(openParenIndex, i);
		}
		i++;
	}
	return null;
}

/** The last top-level argument of a call's argument text — the grammar slot. */
function lastArgument(args: string): string {
	let depth = 0;
	for (let i = args.length - 1; i >= 0; i--) {
		const ch = args[i];
		if (ch === ')' || ch === ']' || ch === '}') depth++;
		else if (ch === '(' || ch === '[' || ch === '{') depth--;
		else if (ch === ',' && depth === 0) return args.slice(i + 1).trim();
	}
	return args.trim();
}

/** Flag seam call sites whose grammar argument is the literal `undefined`. */
function findGlobalGrammarCalls(relPath: string, rawText: string): GlobalGrammarCall[] {
	const code = stripComments(rawText);
	const hits: GlobalGrammarCall[] = [];
	for (const seam of SEAMS) {
		const callRe = new RegExp(`(?<![\\w.])${seam}\\s*\\(`, 'g');
		let m: RegExpExecArray | null;
		while ((m = callRe.exec(code)) !== null) {
			if (/function\s+$/.test(code.slice(Math.max(0, m.index - 12), m.index))) continue;
			const call = balancedCall(code, m.index + m[0].length);
			if (call === null) continue;
			if (lastArgument(call) === 'undefined') hits.push({ relPath, call });
		}
	}
	return hits;
}

describe('ancestry-rebuild grammar-thread source-scan', () => {
	const sources = collectEditorSources().filter((f) => f.relPath !== CONFORMANCE_KIT);

	it('found the seam call sites to validate', () => {
		const callSites = sources.filter((f) =>
			SEAMS.some((seam) => new RegExp(`(?<![\\w.])${seam}\\s*\\(`).test(f.code))
		);
		// Routine typing, the commit ceremony, the metadata seam, paste, cross-block
		// type-replace and the four range-delete modules, plus the declarations.
		expect(callSites.length).toBeGreaterThan(7);
	});

	it('every ancestry rebuild resolves through the instance grammar', () => {
		expect(sources.flatMap((f) => findGlobalGrammarCalls(f.relPath, f.text))).toEqual([]);
	});

	// ── Matcher self-test (non-vacuity) ─────────────────────────────────────

	it('matcher flags a call that falls back to the global grammar', () => {
		const bad = 'rebuildUnsharedChain(doc, chain, sharing, undefined);';
		expect(findGlobalGrammarCalls('synthetic.ts', bad)).toEqual([
			{ relPath: 'synthetic.ts', call: 'doc, chain, sharing, undefined' }
		]);
	});

	it('matcher accepts a threaded grammar, including a nested call expression', () => {
		const good =
			'rebuildUnsharedChain(doc, chain, sharing, ctx.grammar);\n' +
			'rebuildUnsharedAncestry(doc, path, sharing, viewOf(deps, undefined));';
		expect(findGlobalGrammarCalls('synthetic.ts', good)).toEqual([]);
	});

	it('matcher ignores the declarations and tokens in comments', () => {
		const decl =
			'export function rebuildUnsharedChain(root, chain, sharing, grammar) {}\n' +
			'// rebuildUnsharedAncestry(doc, path, sharing, undefined) would be wrong';
		expect(findGlobalGrammarCalls('synthetic.ts', decl)).toEqual([]);
	});
});
