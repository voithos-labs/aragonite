import { beforeEach, describe, expect, it } from 'vitest';
import {
	registerBlockOpener,
	getOrderedOpeners,
	createGrammarView,
	lineInterruptsParagraph,
	listRegisteredOpeners,
	type BlockOpener
} from '../../schema/block-openers';
import type { AnyBlockKind } from '../../core/nodes';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';

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
		__resetSchemaRegistriesForTests();
		mine.clear();
	});

	it('orders openers by ascending priority regardless of registration order', () => {
		registerBlockOpener(
			HEAD,
			opener(20, () => true)
		);
		registerBlockOpener(
			FENCE,
			opener(10, () => true)
		);
		registerBlockOpener(
			QUOTE,
			opener(40, () => true)
		);
		expect(listRegisteredOpeners().map((e) => e.kind)).toContain(HEAD);
		expect(priorities(getOrderedOpeners())).toEqual([10, 20, 40]);
	});

	it('re-sorts after a later registration (cache invalidation)', () => {
		registerBlockOpener(
			HEAD,
			opener(20, () => true)
		);
		expect(priorities(getOrderedOpeners())).toEqual([20]);
		registerBlockOpener(
			FENCE,
			opener(10, () => true)
		);
		expect(priorities(getOrderedOpeners())).toEqual([10, 20]);
	});

	it('lineInterruptsParagraph ORs registered predicates and skips `false` entries', () => {
		registerBlockOpener(
			HEAD,
			opener(20, (t) => t.startsWith('@#'))
		);
		registerBlockOpener(QUIET, opener(60, false));
		expect(lineInterruptsParagraph('@# h')).toBe(true);
		expect(lineInterruptsParagraph('@@ quiet')).toBe(false);
	});

	it('re-evaluates interrupts after a later registration (cache invalidation)', () => {
		registerBlockOpener(
			HEAD,
			opener(20, (t) => t.startsWith('@#'))
		);
		expect(lineInterruptsParagraph('@> quote')).toBe(false);
		registerBlockOpener(
			QUOTE,
			opener(40, (t) => t.startsWith('@>'))
		);
		expect(lineInterruptsParagraph('@> quote')).toBe(true);
	});

	// A predicate must drop a disabled kind's opener from an editor's grammar without
	// disturbing the cached global read.
	describe('enablement filter', () => {
		beforeEach(() => {
			registerBlockOpener(
				HEAD,
				opener(20, (t) => t.startsWith('@#'))
			);
			registerBlockOpener(
				QUOTE,
				opener(40, (t) => t.startsWith('@>'))
			);
		});

		it('drops a disabled kind opener from the ordered dispatch', () => {
			const grammar = createGrammarView((kind) => kind !== QUOTE);
			expect(priorities(grammar.orderedOpeners())).toEqual([20]);
			// The unfiltered read is unchanged: filtering never changes the cache.
			expect(priorities(getOrderedOpeners())).toEqual([20, 40]);
		});
	});
});
