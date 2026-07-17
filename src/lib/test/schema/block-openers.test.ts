import { beforeEach, describe, expect, it } from 'vitest';
import {
	registerBlockOpener,
	getOrderedOpeners,
	lineInterruptsParagraph,
	listRegisteredOpeners,
	__resetBlockOpenersForTests,
	type BlockOpener
} from '../../schema/block-openers';

function opener(priority: number, interrupts: BlockOpener['interruptsParagraph']): BlockOpener {
	return { priority, tryOpen: () => null, interruptsParagraph: interrupts };
}

describe('block-opener registry', () => {
	// The registry is module-global; tests in this file share it.
	beforeEach(() => __resetBlockOpenersForTests());
	it('orders openers by ascending priority regardless of registration order', () => {
		registerBlockOpener(
			'heading',
			opener(20, () => true)
		);
		registerBlockOpener(
			'fencedCode',
			opener(10, () => true)
		);
		registerBlockOpener(
			'blockquote',
			opener(40, () => true)
		);
		expect(listRegisteredOpeners().map((e) => e.kind)).toContain('heading');
		expect(getOrderedOpeners().map((o) => o.priority)).toEqual([10, 20, 40]);
	});

	it('re-sorts after a later registration (cache invalidation)', () => {
		registerBlockOpener(
			'heading',
			opener(20, () => true)
		);
		expect(getOrderedOpeners().map((o) => o.priority)).toEqual([20]);
		registerBlockOpener(
			'fencedCode',
			opener(10, () => true)
		);
		expect(getOrderedOpeners().map((o) => o.priority)).toEqual([10, 20]);
	});

	it('lineInterruptsParagraph ORs registered predicates and skips `false` entries', () => {
		registerBlockOpener(
			'heading',
			opener(20, (t) => t.startsWith('#'))
		);
		registerBlockOpener('indentedCode', opener(60, false));
		expect(lineInterruptsParagraph('# h')).toBe(true);
		expect(lineInterruptsParagraph('    code')).toBe(false);
	});

	it('re-evaluates interrupts after a later registration (cache invalidation)', () => {
		registerBlockOpener(
			'heading',
			opener(20, (t) => t.startsWith('#'))
		);
		expect(lineInterruptsParagraph('> quote')).toBe(false);
		registerBlockOpener(
			'blockquote',
			opener(40, (t) => t.startsWith('>'))
		);
		expect(lineInterruptsParagraph('> quote')).toBe(true);
	});

	// The per-instance enablement filter (concern #1). The unfiltered read is the
	// behavior-preserving default; a predicate drops a disabled kind's opener from
	// both grammar reads without disturbing the cached default read.
	describe('enablement filter', () => {
		beforeEach(() => {
			registerBlockOpener(
				'heading',
				opener(20, (t) => t.startsWith('#'))
			);
			registerBlockOpener(
				'blockquote',
				opener(40, (t) => t.startsWith('>'))
			);
		});

		it('drops a disabled kind opener from the ordered dispatch', () => {
			const enabled = (kind: string) => kind !== 'blockquote';
			expect(getOrderedOpeners(enabled).map((o) => o.priority)).toEqual([20]);
			// The unfiltered read is unchanged — filtering never mutates the cache.
			expect(getOrderedOpeners().map((o) => o.priority)).toEqual([20, 40]);
		});
	});
});
