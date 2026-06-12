import { describe, it, expect } from 'vitest';
import type { InlineNode } from '../../../core/nodes';
import {
	forEachGap,
	interleave,
	isContainedInAny,
	occupiedEndAt,
	occupiedRangesFrom,
	overlapsOccupied,
	type Range
} from '../../../core/inline/ranges';

const textNode = (start: number, end: number, text: string): InlineNode => ({
	kind: 'text',
	start,
	end,
	text
});
const escapeNode = (start: number): InlineNode => ({ kind: 'escape', start, end: start + 2 });

describe('occupiedRangesFrom', () => {
	it('keeps non-text spans and drops text nodes', () => {
		const nodes = [textNode(0, 2, 'ab'), escapeNode(2), textNode(4, 6, 'cd'), escapeNode(6)];
		expect(occupiedRangesFrom(nodes)).toEqual([
			{ start: 2, end: 4 },
			{ start: 6, end: 8 }
		]);
	});
});

describe('forEachGap', () => {
	const gaps = (ranges: Range[], start: number, end: number): Array<[number, number]> => {
		const out: Array<[number, number]> = [];
		forEachGap(ranges, start, end, (s, e) => out.push([s, e]));
		return out;
	};

	it('covers the whole span when no ranges occupy it', () => {
		expect(gaps([], 3, 9)).toEqual([[3, 9]]);
	});

	it('splits around a single occupied range', () => {
		expect(gaps([{ start: 4, end: 6 }], 0, 10)).toEqual([
			[0, 4],
			[6, 10]
		]);
	});

	it('still fires empty-gap callbacks for adjacent and edge-touching ranges', () => {
		const adjacent: Range[] = [
			{ start: 0, end: 3 },
			{ start: 3, end: 7 }
		];
		expect(gaps(adjacent, 0, 7)).toEqual([
			[0, 0],
			[3, 3],
			[7, 7]
		]);
	});
});

describe('occupiedEndAt', () => {
	const occupied: Range[] = [
		{ start: 2, end: 4 },
		{ start: 6, end: 9 }
	];

	it('returns the covering range end, including at range start', () => {
		expect(occupiedEndAt(occupied, 2)).toBe(4);
		expect(occupiedEndAt(occupied, 7)).toBe(9);
	});

	it('returns null for free positions, including pos === range.end', () => {
		expect(occupiedEndAt(occupied, 1)).toBeNull();
		expect(occupiedEndAt(occupied, 4)).toBeNull();
		expect(occupiedEndAt(occupied, 9)).toBeNull();
	});
});

describe('overlapsOccupied', () => {
	const occupied: Range[] = [{ start: 3, end: 6 }];

	it('detects partial and containing overlap', () => {
		expect(overlapsOccupied(occupied, 5, 8)).toBe(true);
		expect(overlapsOccupied(occupied, 0, 10)).toBe(true);
	});

	it('treats touching boundaries as free', () => {
		expect(overlapsOccupied(occupied, 0, 3)).toBe(false);
		expect(overlapsOccupied(occupied, 6, 9)).toBe(false);
	});
});

describe('isContainedInAny', () => {
	const outers: Range[] = [
		{ start: 0, end: 4 },
		{ start: 6, end: 10 }
	];

	it('accepts exact fit and strict containment', () => {
		expect(isContainedInAny({ start: 6, end: 10 }, outers)).toBe(true);
		expect(isContainedInAny({ start: 1, end: 3 }, outers)).toBe(true);
	});

	it('rejects partial overlap and uncovered spans', () => {
		expect(isContainedInAny({ start: 3, end: 7 }, outers)).toBe(false);
		expect(isContainedInAny({ start: 4, end: 6 }, outers)).toBe(false);
	});
});

describe('interleave', () => {
	it('synthesizes text for gaps before, between, and after nodes', () => {
		const raw = 'ab\\*cd\\!ef';
		const result = interleave(raw, 0, raw.length, [escapeNode(2)], [escapeNode(6)]);
		expect(result).toEqual([
			textNode(0, 2, 'ab'),
			escapeNode(2),
			textNode(4, 6, 'cd'),
			escapeNode(6),
			textNode(8, 10, 'ef')
		]);
	});

	it('emits no text when nodes cover the full span', () => {
		const result = interleave('\\*\\!', 0, 4, [escapeNode(0)], [escapeNode(2)]);
		expect(result).toEqual([escapeNode(0), escapeNode(2)]);
	});

	it('re-synthesizes text from raw when found is empty', () => {
		const raw = 'xx\\*yy';
		const occupied = [textNode(0, 2, 'xx'), escapeNode(2), textNode(4, 6, 'yy')];
		expect(interleave(raw, 0, raw.length, occupied, [])).toEqual([
			textNode(0, 2, 'xx'),
			escapeNode(2),
			textNode(4, 6, 'yy')
		]);
	});
});
