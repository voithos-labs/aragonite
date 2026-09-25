// @vitest-environment jsdom
import { defaultGrammarView } from '$lib/schema/block-openers';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { parse, serialize } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { planEnterCompletion } from '$lib/editor-actions/enter-completion';
import { completeTypedLine } from '$lib/schema/block-completions';
import { registerMathBlock, MATH_BLOCK } from '$lib/plugins/latex/latex-kind';
import { tryCompleteMathBlock } from '$lib/plugins/latex/math-completion';

// The `$$` completer's line test, the bytes it answers with, and what the editor does with
// them. The registry's own behavior lives in test/schema, the checks around it in
// test/editor-actions.

beforeEach(resetPluginPlatformForTests);
afterEach(resetPluginPlatformForTests);

describe('block math Enter completer: which lines it claims', () => {
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

describe('block math Enter completer: the bytes it answers', () => {
	it('answers the fence pair around one empty body line, caret on the body', () => {
		const claim = tryCompleteMathBlock('$$')!;
		expect(claim.lines).toEqual(['$$', '', '$$']);
		expect(claim.caret).toEqual({ path: [], line: 1, column: 0 });
	});

	// The answer is only worth anything if the bytes parse back as the block it describes:
	// the round-trip invariant, on the completer's own output.
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

describe('block math Enter completer: registration', () => {
	// The plain-GFM guarantee reaches completion too: with nothing installed, `$$` plus Enter
	// is an ordinary split.
	it('claims nothing until the kind is registered', () => {
		expect(completeTypedLine('$$', defaultGrammarView)).toBeNull();
		registerMathBlock();
		expect(completeTypedLine('$$', defaultGrammarView)?.lines).toEqual(['$$', '', '$$']);
	});
});

describe('block math Enter completion: what the join plans', () => {
	// The caret sits on the second line of the new block, so the byte offset it resolves to
	// depends on the line ending chosen: what a byte offset fixed by the completer cannot say.
	it.each([
		['$$\n', '$$\n\n$$\n', 3],
		['$$\r\n', '$$\r\n\r\n$$\r\n', 4]
	])('mints %j as %j with the caret at %i', (typed, minted, offset) => {
		registerMathBlock();
		const plan = planEnterCompletion(parse(typed).children[0], 2, defaultGrammarView, '\n')!;
		expect(plan.replacement.map((c) => c.kind)).toEqual([MATH_BLOCK]);
		expect(plan.replacement[0].raw).toBe(minted);
		expect(plan.caret).toEqual({ path: [], offset });
	});

	// The check belongs to the editor, not the completer: a caret short of the line's end
	// is a split.
	it('declines a caret that is not at the end of the typed fence', () => {
		registerMathBlock();
		expect(planEnterCompletion(parse('$$\n').children[0], 1, defaultGrammarView, '\n')).toBeNull();
	});
});
