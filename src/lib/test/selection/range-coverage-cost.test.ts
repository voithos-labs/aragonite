// What a range covers costs in proportion to the blocks it covers: path comparisons are counted at
// N and 4N blocks, and the one shape whose cost is not a comparison is timed through the growth harness.
// Miss-analysis: only the e2e VR battery selected a large list, and only in a full run; no unit or
// perf row priced a coverage's work against the number of blocks it covers.
import { describe, it, expect, vi } from 'vitest';

const calls = { count: 0 };

vi.mock('../../selection/path-math', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	const counted: Record<string, unknown> = {};
	for (const [name, value] of Object.entries(actual)) {
		counted[name] =
			typeof value === 'function'
				? (...args: unknown[]) => {
						calls.count++;
						return (value as (...a: unknown[]) => unknown)(...args);
					}
				: value;
	}
	return counted;
});

import { parse } from '../../core/parser';
import { displayLength } from '../../core/lines';
import type { Document } from '../../core/nodes';
import {
	blockPaintsWholeBox,
	classifyBlockForSelection,
	type SelectionPoint
} from '../../selection/primitives';
import { coverRange, rangeCoverage, type RangeCoverage } from '../../selection/range-coverage';
import { rangeDelete } from '../../selection/range-delete';
import {
	writeCrossBlockCopy,
	type CrossBlockClipboardDeps
} from '../../selection/cross-block/clipboard';
import { createSharingState } from '../../tree-operations/sharing';
import { fixtureReading } from '../harness/fixture-grammar';
import {
	BOUNDED_GROWTH_CEILING,
	expectBoundedGrowth,
	measureScanGrowth
} from '../harness/scan-growth';

const N = 250;

/** A flat list of `items` items, selected from the first item's first byte to the last's end, as
 *  Ctrl+Shift+End from the top selects it. */
function wholeListSelection(items: number): {
	doc: Document;
	start: SelectionPoint;
	end: SelectionPoint;
} {
	const doc = parse(Array.from({ length: items }, (_, i) => `- item ${i}\n`).join(''));
	const last = items - 1;
	const leaf = doc.children[0].children![last].children![0];
	return {
		doc,
		start: { path: [0, 0, 0], offset: 0 },
		end: { path: [0, last, 0], offset: displayLength(leaf.raw) }
	};
}

function counted(run: () => void): number {
	calls.count = 0;
	run();
	return calls.count;
}

function coverageOf(items: number): { doc: Document; coverage: RangeCoverage } {
	const { doc, start, end } = wholeListSelection(items);
	return { doc, coverage: rangeCoverage(doc, coverRange(doc, start, end)) };
}

describe('a range over a long list costs in proportion to what it covers', () => {
	// A sort is allowed its log factor; four times the items at quadratic cost reads sixteen.
	const GROWTH_CEILING = BOUNDED_GROWTH_CEILING;

	it('builds the coverage once in near linear path comparisons', () => {
		const small = wholeListSelection(N);
		const large = wholeListSelection(4 * N);
		const cost = ({ doc, start, end }: typeof small) =>
			counted(() => rangeCoverage(doc, coverRange(doc, start, end)));

		expect(cost(small)).toBeGreaterThan(0);
		expect(cost(large)).toBeLessThanOrEqual(GROWTH_CEILING * cost(small));
	});

	it('copies the range in near linear path comparisons', () => {
		const small = wholeListSelection(N);
		const large = wholeListSelection(4 * N);
		const cost = ({ doc, start, end }: typeof small) => {
			const deps = {
				selection: { isCrossBlock: true, anchor: start, focus: end },
				getDoc: () => doc
			} as unknown as CrossBlockClipboardDeps;
			const event = {
				preventDefault: () => {},
				clipboardData: { setData: () => {} }
			} as unknown as ClipboardEvent;
			return counted(() => writeCrossBlockCopy(event, deps));
		};

		expect(cost(large)).toBeLessThanOrEqual(GROWTH_CEILING * cost(small));
	});

	it('deletes the range in near linear path comparisons', () => {
		const small = wholeListSelection(N);
		const large = wholeListSelection(4 * N);
		const cost = ({ doc, start, end }: typeof small) =>
			counted(() =>
				rangeDelete(
					doc,
					rangeCoverage(doc, coverRange(doc, start, end)),
					createSharingState(),
					fixtureReading(),
					'keyless'
				)
			);

		expect(cost(large)).toBeLessThanOrEqual(GROWTH_CEILING * cost(small));
	});

	// Each mounted block's overlay asks both once per paint.
	it('places a block in the range without reading every covered root', () => {
		const small = coverageOf(N).coverage;
		const large = coverageOf(4 * N).coverage;
		const cost = (coverage: RangeCoverage, items: number) => {
			const item = [0, items - 2];
			return counted(() => {
				classifyBlockForSelection(item, coverage);
				blockPaintsWholeBox(item, coverage, null);
			});
		};

		expect(classifyBlockForSelection([0, N - 2], small)).toBe('outside');
		expect(blockPaintsWholeBox([0], small, null)).toBe(true);
		expect(cost(large, 4 * N)).toBeLessThanOrEqual(cost(small, N) + 2);
	});
});

describe('a range inside one long container costs in proportion to its children', () => {
	// A quote opening on a block held whole, selected from it into its last paragraph: every
	// child but the last is covered, so the quote itself never is.
	const quoteSelection = (bytes: number, salt: string) => {
		const paragraphs = Math.ceil(bytes / 12);
		const body = Array.from({ length: paragraphs }, (_, i) => `>\n> para ${i}\n`).join('');
		return `> ***\n${body}>\n> ${salt}end\n`;
	};

	it('checks whether the container is whole once, not once per covered child', () => {
		const cover = (source: string) => {
			const doc = parse(source);
			const quote = doc.children[0].children!;
			const last = quote.length - 1;
			const range = coverRange(doc, { path: [0, 0], offset: 0 }, { path: [0, last], offset: 1 });
			expect(rangeCoverage(doc, range).wholeRoots).toHaveLength(last);
		};

		expectBoundedGrowth(measureScanGrowth(cover, quoteSelection, [8, 32]));
	}, 300_000);
});
