// G1.61: the check passes a list move that keeps the text in order and fails one that reorders it.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { leafTextAround, leafTexts } from '#lib/invariants/leaf-text.js';
import {
	checkListMoveKeepsOrder,
	keepingListOrder
} from '#lib/invariants/list-move-keeps-order.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';

const textOf = (source: string) => leafTexts(parse(source).children);

describe('G1.61 a list move keeps the order its text reads in', () => {
	it('passes a nest, a lift that carries its siblings, and renumbered markers', () => {
		const before = textOf('1. a\n2. b\n3. c\n');
		expect(checkListMoveKeepsOrder(before, textOf('1. a\n   1. b\n2. c\n'))).toBeNull();
		expect(checkListMoveKeepsOrder(before, textOf('1. a\n2. b\n   1. c\n'))).toBeNull();
	});

	it('reads a code block by its body, so a longer fence adds no text', () => {
		const fenced = (fence: string) => `- x\n\n  ${fence}\n  a\n  ${fence}\n`;
		expect(textOf(fenced('````'))).toEqual(textOf(fenced('```')));
	});

	it('reads a merge by the text around the two lines it joins', () => {
		const [list] = parse('- a\n  - x\n- b\n  - y\n').children;
		const x = list.children![0].children![1].children![0].children![0];
		const b = list.children![1].children![0];
		expect(leafTextAround([list], x, b)).toEqual(['a', 'y']);
		expect(leafTextAround([list], null, b)).toEqual(['axby', '']);
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
			() => leafTexts([list]),
			() => list.children!.reverse()
		);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:list-move-keeps-order']);
	});
});
