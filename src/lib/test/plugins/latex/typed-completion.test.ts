// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { planEnterCompletion } from '$lib/editor-actions/enter-completion';
import { completeTypedLine } from '$lib/schema/block-completions';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { __resetInlineSyntaxForTests } from '$lib/core/inline/scan/plugin-syntax';
import { __resetInlineWidgetsForTests } from '$lib/core/inline/inline-widgets';
import {
	__clearDeclaredPluginInlineKindsForTests,
	declaredPluginKind
} from '$lib/schema/plugin-kind';
import { registerMathBlock, MATH_BLOCK } from '$lib/plugins/latex/latex-kind';
import {
	registerMathBlockCompleter,
	tryCompleteMathBlock
} from '$lib/plugins/latex/math-completion';

// The `$$` completer's line predicate, the bytes it answers, and what the seam makes of them. The
// registry's own semantics live in test/schema; the seam's gates in test/editor-actions.

function resetLatexState(): void {
	__resetSchemaRegistriesForTests();
	__resetInlineSyntaxForTests();
	__resetInlineWidgetsForTests();
	__clearDeclaredPluginInlineKindsForTests();
}

beforeEach(resetLatexState);
afterEach(resetLatexState);

describe('block math Enter completer — which lines it claims', () => {
	it.each([
		['$$', 'the bare fence'],
		['  $$  ', 'surrounding whitespace, which the typed line may carry']
	])('claims %j (%s)', (line) => {
		expect(tryCompleteMathBlock(line)).not.toBeNull();
	});

	it.each([
		['$$x$$', 'already a whole one-line block'],
		['$$ x', 'an opener with body text on it — no multi-line form is implied'],
		['$$$', 'a longer run, which is not the fence'],
		['$', 'the inline marker'],
		['', 'an empty line']
	])('declines %j (%s)', (line) => {
		expect(tryCompleteMathBlock(line)).toBeNull();
	});
});

describe('block math Enter completer — the bytes it answers', () => {
	it('answers the fence pair around one empty body line, caret on the body', () => {
		const claim = tryCompleteMathBlock('$$')!;
		expect(claim.lines).toEqual(['$$', '', '$$']);
		expect(claim.caret).toEqual({ path: [], line: 1, column: 0 });
	});

	// The claim is only worth anything if the bytes parse back as the block it describes — the
	// round-trip invariant, on the completer's own output.
	it('answers bytes that parse to one math block and serialize back unchanged', () => {
		registerMathBlock();
		const source = tryCompleteMathBlock('$$')!
			.lines.map((l) => l + '\n')
			.join('');
		const doc = parse(source);
		expect(doc.children.map((c) => c.kind)).toEqual([MATH_BLOCK]);
		expect(doc.children[0].raw).toBe('$$\n\n$$\n');
		expect(serialize(doc)).toBe(source);
	});
});

describe('block math Enter completer — registration', () => {
	// The bare-GFM guarantee reaches the completion seam too: with nothing installed, `$$` plus
	// Enter is an ordinary split, exactly as it was before the plugin existed.
	it('claims nothing until the kind is registered', () => {
		expect(completeTypedLine('$$')).toBeNull();
		registerMathBlock();
		expect(completeTypedLine('$$')?.lines).toEqual(['$$', '', '$$']);
	});

	// The registry throws on a duplicate kind, so the registrar guards on the probe rather than on
	// a module flag a platform reset would leave standing.
	it('is inert on a second registration rather than throwing', () => {
		registerMathBlock();
		expect(() => registerMathBlockCompleter(declaredPluginKind(MATH_BLOCK))).not.toThrow();
		expect(completeTypedLine('$$')?.lines).toEqual(['$$', '', '$$']);
	});
});

describe('block math Enter completion — what the seam plans', () => {
	// The caret sits on the SECOND line of the mint, so the byte offset it resolves to depends on
	// the ending the seam chose — the case a completer-minted byte offset could not express.
	it.each([
		['$$\n', '$$\n\n$$\n', 3],
		['$$\r\n', '$$\r\n\r\n$$\r\n', 4]
	])('mints %j as %j with the caret at %i', (typed, minted, offset) => {
		registerMathBlock();
		const plan = planEnterCompletion(parse(typed).children[0], 2)!;
		expect(plan.replacement.map((c) => c.kind)).toEqual([MATH_BLOCK]);
		expect(plan.replacement[0].raw).toBe(minted);
		expect(plan.caret).toEqual({ path: [], offset });
	});

	// The gate is the seam's, not the completer's: a caret short of the line's end is a split.
	it('declines a caret that is not at the end of the typed fence', () => {
		registerMathBlock();
		expect(planEnterCompletion(parse('$$\n').children[0], 1)).toBeNull();
	});
});
