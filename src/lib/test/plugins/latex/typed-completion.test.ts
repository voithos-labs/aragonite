import { describe, it, expect } from 'vitest';
import { parse, serialize } from '#lib';
import { planEnterCompletion } from '#lib/editor-actions/enter-completion.js';
import { completeTypedLine } from '#lib/schema/block-completions.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';
import { listGrammar } from '#lib/schema/own-syntax.js';
import { makingOf } from '#lib/schema/block-type.js';
import type { GrammarView } from '#lib/schema/block-openers.js';
import { latex } from '#packages/latex/src/index.js';

// The `$$` completer's line test, the bytes it answers with, and what the editor does with them;
// the registry is tested in test/schema, the checks around it in test/editor-actions.

const MATH = 'latex/block';

/** An editor running latex: its reading, and the block type's completer. Made per row, since the
 *  suite's reset after each row drops what an install held. */
function installed() {
	const { units, grammar } = listGrammar([latex], ({ cause }) => {
		throw cause;
	});
	const completer = makingOf(units[0].contribution.blocks![0])!.completer!;
	return {
		grammar: grammar as GrammarView,
		complete: (line: string) => completer.tryComplete(line)
	};
}

describe('block math Enter completer: which lines it claims', () => {
	it.each([
		['$$', 'the bare fence'],
		['  $$  ', 'surrounding whitespace, which the typed line may carry'],
		['\t$$\t', 'tabs, which are Markdown whitespace too']
	])('claims %j (%s)', (line) => {
		expect(installed().complete(line)).not.toBeNull();
	});

	it.each([
		['$$x$$', 'already a whole one-line block'],
		['$$ x', 'an opener with body text on it — no multi-line form is implied'],
		['$$$', 'a longer run, which is not the fence'],
		['$', 'the inline marker'],
		['', 'an empty line'],
		// Miss-analysis: the whitespace case used ASCII spaces only, never a non-breaking space.
		['$$\u00a0', 'a non-breaking space, which is text rather than whitespace']
	])('declines %j (%s)', (line) => {
		expect(installed().complete(line)).toBeNull();
	});
});

describe('block math Enter completer: the bytes it answers', () => {
	it('answers the fence pair around one empty body line, caret on the body', () => {
		const claim = installed().complete('$$')!;
		expect(claim.lines).toEqual(['$$', '', '$$']);
		expect(claim.caret).toEqual({ path: [], line: 1, column: 0 });
	});

	// The answer is only worth anything if the bytes parse back as the block it describes:
	// the round-trip invariant, on the completer's own output.
	it('answers bytes that parse to one math block and serialize back unchanged', () => {
		const math = installed();
		const source = math
			.complete('$$')!
			.lines.map((l) => l + '\n')
			.join('');
		const doc = parse(source, { grammar: math.grammar });
		expect(doc.children.map((c) => c.kind)).toEqual([MATH]);
		expect(doc.children[0].raw).toBe('$$\n\n$$\n');
		expect(serialize(doc)).toBe(source);
	});
});

describe('block math Enter completer: registration', () => {
	// The plain-GFM guarantee reaches completion too: with nothing installed, `$$` plus Enter
	// is an ordinary split.
	it('claims nothing where latex is not listed', () => {
		expect(completeTypedLine('$$', defaultGrammarView)).toBeNull();
		expect(completeTypedLine('$$', installed().grammar)?.lines).toEqual(['$$', '', '$$']);
	});
});

describe('block math Enter completion: what the join plans', () => {
	// The caret sits on the second line of the new block, so the byte offset it resolves to
	// depends on the line ending chosen: what a byte offset fixed by the completer cannot say.
	it.each([
		['$$\n', '$$\n\n$$\n', 3],
		['$$\r\n', '$$\r\n\r\n$$\r\n', 4]
	])('mints %j as %j with the caret at %i', (typed, minted, offset) => {
		const { grammar } = installed();
		const plan = planEnterCompletion(parse(typed, { grammar }).children[0], 2, grammar, '\n')!;
		expect(plan.replacement.map((c) => c.kind)).toEqual([MATH]);
		expect(plan.replacement[0].raw).toBe(minted);
		expect(plan.caret).toEqual({ path: [], offset });
	});

	// The check belongs to the editor, not the completer: a caret short of the line's end
	// is a split.
	it('declines a caret that is not at the end of the typed fence', () => {
		const { grammar } = installed();
		expect(
			planEnterCompletion(parse('$$\n', { grammar }).children[0], 1, grammar, '\n')
		).toBeNull();
	});
});
