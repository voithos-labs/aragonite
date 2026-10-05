// @vitest-environment jsdom
// G1.61: the check passes a list move that keeps the text in order and fails one that reorders it.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { leafTexts } from '$lib/invariants/leaf-text';
import { checkListMoveKeepsOrder, keepingListOrder } from '$lib/invariants/list-move-keeps-order';
import { takeDevWarns } from '$lib/test/support/warn-gate';

const textOf = (source: string) => leafTexts(parse(source).children);

describe('G1.61 a list move keeps the order its text reads in', () => {
	it('passes a nest, a lift that carries its siblings, and renumbered markers', () => {
		const before = textOf('1. a\n2. b\n3. c\n');
		expect(checkListMoveKeepsOrder(before, textOf('1. a\n   1. b\n2. c\n'))).toBeNull();
		expect(checkListMoveKeepsOrder(before, textOf('1. a\n2. b\n   1. c\n'))).toBeNull();
	});

	it('fails a lift that leaves a sibling above the item it followed', () => {
		const before = textOf('- a\n  - b\n  - c\n');
		expect(checkListMoveKeepsOrder(before, textOf('- a\n  - c\n- b\n'))?.message).toContain(
			'leaf 1 read "b" and now reads "c"'
		);
	});

	it('warns once when the move it wraps reorders the region', () => {
		const [list] = parse('- a\n- b\n').children;
		keepingListOrder(
			() => [list],
			() => list.children!.reverse()
		);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:list-move-keeps-order']);
	});
});
