import { beforeEach, describe, expect, it } from 'vitest';
import type { BlockOpener } from '../../schema/block-openers';
import { createEditorGrammar, defaultGrammarView } from '../../schema/editor-grammar';
import { testLeaf } from '#lib/test/harness/test-kinds.js';
import type { AnyBlockKind } from '../../core/nodes';

// Plugin kinds on top of the built-in openers, which the reset keeps; each case reads back only
// the openers it registered.
const HEAD = 'spec-head' as AnyBlockKind;
const FENCE = 'spec-fence' as AnyBlockKind;
const QUOTE = 'spec-quote' as AnyBlockKind;
const QUIET = 'spec-quiet' as AnyBlockKind;

const mine = new Set<BlockOpener>();
function opener(priority: number, interrupts: BlockOpener['interruptsParagraph']): BlockOpener {
	const made = { priority, tryOpen: () => null, interruptsParagraph: interrupts };
	mine.add(made);
	return made;
}
const priorities = (openers: readonly BlockOpener[]) =>
	openers.filter((o) => mine.has(o)).map((o) => o.priority);

describe('block-opener registry', () => {
	beforeEach(() => {
		mine.clear();
	});

	it('orders openers by ascending priority regardless of registration order', () => {
		testLeaf(HEAD, { opener: opener(20, () => true) });
		testLeaf(FENCE, { opener: opener(10, () => true) });
		testLeaf(QUOTE, { opener: opener(40, () => true) });
		expect(priorities(defaultGrammarView.orderedOpeners())).toEqual([10, 20, 40]);
	});

	it('re-sorts after a later registration (cache invalidation)', () => {
		testLeaf(HEAD, { opener: opener(20, () => true) });
		expect(priorities(defaultGrammarView.orderedOpeners())).toEqual([20]);
		testLeaf(FENCE, { opener: opener(10, () => true) });
		expect(priorities(defaultGrammarView.orderedOpeners())).toEqual([10, 20]);
	});

	it('the interrupt scan ORs registered predicates and skips `false` entries', () => {
		testLeaf(HEAD, { opener: opener(20, (t) => t.startsWith('@#')) });
		testLeaf(QUIET, { opener: opener(60, false) });
		expect(defaultGrammarView.interruptsParagraph('@# h')).toBe(true);
		expect(defaultGrammarView.interruptsParagraph('@@ quiet')).toBe(false);
	});

	// Miss: only the global read was checked after a late registration, never an editor's own view.
	it("an editor's grammar sees an opener registered after its first read", () => {
		const grammar = createEditorGrammar();
		testLeaf(HEAD, { opener: opener(20, () => true) });
		expect(priorities(grammar.orderedOpeners())).toEqual([20]);
		testLeaf(FENCE, { opener: opener(10, () => true) });
		expect(priorities(grammar.orderedOpeners())).toEqual([10, 20]);
	});

	it('re-evaluates interrupts after a later registration (cache invalidation)', () => {
		testLeaf(HEAD, { opener: opener(20, (t) => t.startsWith('@#')) });
		expect(defaultGrammarView.interruptsParagraph('@> quote')).toBe(false);
		testLeaf(QUOTE, { opener: opener(40, (t) => t.startsWith('@>')) });
		expect(defaultGrammarView.interruptsParagraph('@> quote')).toBe(true);
	});
});
