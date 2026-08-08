/**
 * Sibling-path parity: every container composing a nested-actions bundle must thread the
 * instance grammar, so a disabled kind's opener stays skipped when the container reparses
 * child content. The rule sits at the choke point every container passes through, so a
 * NEW container that forgets `grammar` fails the day it is born. Exempt: the declaration,
 * and the published container-conformance kit, which never reparses content.
 */

import { describe, it, expect } from 'vitest';
import { balancedCall, collectEditorSources, stripComments } from './scan-source';

const CONFORMANCE_KIT = 'src/lib/testing/container-conformance.ts';

interface GrammarlessCall {
	relPath: string;
	call: string;
}

/**
 * Flag `createStandardNestedActions(<args>)` call sites whose argument list omits a
 * `grammar:` key. Skips the declaration (`function createStandardNestedActions`).
 */
function findGrammarlessCalls(relPath: string, rawText: string): GrammarlessCall[] {
	const code = stripComments(rawText);
	const hits: GrammarlessCall[] = [];
	const callRe = /createStandardNestedActions\s*\(/g;
	let m: RegExpExecArray | null;
	while ((m = callRe.exec(code)) !== null) {
		const before = code.slice(Math.max(0, m.index - 12), m.index);
		if (/function\s+$/.test(before)) continue;

		const call = balancedCall(code, m.index + m[0].length);
		if (call === null) continue;
		if (!/\bgrammar\s*:/.test(call)) hits.push({ relPath, call });
	}
	return hits;
}

describe('createStandardNestedActions grammar-thread source-scan', () => {
	const sources = collectEditorSources().filter((f) => f.relPath !== CONFORMANCE_KIT);

	it('found the container call sites to validate', () => {
		const callSites = sources.filter((f) => /createStandardNestedActions\s*\(/.test(f.code));
		// Four built-in containers wire it directly (blockquote now routes through the
		// plugin container factory), plus that factory and the declaration.
		expect(callSites.length).toBeGreaterThan(5);
	});

	it('every container threads the instance grammar', () => {
		const violations = sources.flatMap((f) => findGrammarlessCalls(f.relPath, f.text));
		expect(violations).toEqual([]);
	});

	// ── Matcher self-test (non-vacuity) ─────────────────────────────────────

	it('matcher flags a call that omits grammar', () => {
		const bad = 'const b = createStandardNestedActions(state, { scope, stickyColumn, parent });';
		expect(findGrammarlessCalls('synthetic.ts', bad)).toEqual([
			{ relPath: 'synthetic.ts', call: 'state, { scope, stickyColumn, parent }' }
		]);
	});

	it('matcher accepts a call that threads grammar', () => {
		const good =
			'createStandardNestedActions(state, { scope, grammar: registryView.grammar, parent }, ovr(x))';
		expect(findGrammarlessCalls('synthetic.ts', good)).toEqual([]);
	});

	it('matcher ignores the declaration and tokens in comments', () => {
		const decl =
			'export function createStandardNestedActions(state, deps) {}\n' +
			'// createStandardNestedActions(state, { no grammar }) would be wrong';
		expect(findGrammarlessCalls('synthetic.ts', decl)).toEqual([]);
	});
});
