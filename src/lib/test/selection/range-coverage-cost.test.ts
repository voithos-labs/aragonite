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
import { rangePaint } from '../../selection/range-bytes';
import { documentLayout } from '../../range-edit/layout';
import {
	crossBlockClipboardArm,
	type CrossBlockClipboardDeps
} from '../../selection/cross-block/clipboard';
import { fixtureReading } from '../harness/fixture-grammar';
import { freshBytes } from '../harness/copied-text';
import {
	BOUNDED_GROWTH_CEILING,
	expectBoundedGrowth,
	measureScanGrowth
} from '../harness/scan-growth';
import { deleteRange } from '../harness/range-delete';

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

/** The same list selected from one character into the first item to one character into the last,
 *  so every item between is its own covered root and the list itself isn't covered. */
function midTextCoverageOf(items: number): { doc: Document; coverage: RangeCoverage } {
	const { doc, start, end } = wholeListSelection(items);
	const coverage = rangeCoverage(
		doc,
		coverRange(doc, { ...start, offset: 1 }, { ...end, offset: 1 })
	);
	return { doc, coverage };
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
				selection: { ownsRange: true, anchor: start, focus: end },
				getDoc: () => doc,
				crossBlock: { reading: fixtureReading(), bytes: freshBytes(() => doc) }
			} as unknown as CrossBlockClipboardDeps;
			return counted(() => crossBlockClipboardArm(deps).copy());
		};

		expect(cost(large)).toBeLessThanOrEqual(GROWTH_CEILING * cost(small));
	});

	it('deletes the range in near linear path comparisons', () => {
		const small = wholeListSelection(N);
		const large = wholeListSelection(4 * N);
		const cost = ({ doc, start, end }: typeof small) => counted(() => deleteRange(doc, start, end));

		expect(cost(large)).toBeLessThanOrEqual(GROWTH_CEILING * cost(small));
	});

	// Miss-analysis: the row's range covered the whole list, one covered root at any size, so a
	// lookup scanning every root (each mounted overlay asks once per paint) cost the same at N and 4N.
	it('places a block in the range without reading every covered root', () => {
		/** Path comparisons and blocks laid out for one block's paint, once the paint has its bytes. */
		const cost = (items: number) => {
			const { doc, coverage } = midTextCoverageOf(items);
			const layout = documentLayout(doc);
			let laid = 0;
			const counting = {
				...layout,
				block: (path: readonly number[]) => (laid++, layout.block(path))
			};
			const paint = rangePaint(doc, coverage, counting);
			expect(coverage.wholeRoots).toHaveLength(items - 2);
			expect(blockPaintsWholeBox([0, 1], paint, null)).toBe(true);
			laid = 0;
			const item = [0, items - 2];
			const compared = counted(() => {
				expect(classifyBlockForSelection(item, paint)).toBe('whole');
				expect(blockPaintsWholeBox(item, paint, null)).toBe(true);
			});
			return compared + laid;
		};

		expect(cost(4 * N)).toBeLessThanOrEqual(cost(N) + 2);
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
