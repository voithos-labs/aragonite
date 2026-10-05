import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../core/parser';
import { registerChromePluginsForTests } from './chrome-plugins';
import {
	blockPaintsWholeBox,
	cellPoint,
	classifyBlockForSelection,
	endpointMeasureSpan
} from '../../selection/primitives';
import { SELECTION_END } from '../../block-component';
import { coverRange, rangeCoverage, type RangeCoverage } from '../../selection/range-coverage';

const FIVE = 'p0\n\np1\n\np2\n\np3\n\np4\n';
/** [0] and [2] quotes of two paragraphs each, [1] a paragraph between them. */
const QUOTES = '> a\n>\n> b\n\nmid\n\n> c\n>\n> d\n';

/** The pair as the overlay reads it, off the one coverage the delete and the copy read too. */
function sel(
	anchor: { path: number[]; offset: number },
	focus: { path: number[]; offset: number },
	source = FIVE
): RangeCoverage {
	const doc = parse(source);
	return rangeCoverage(doc, coverRange(doc, anchor, focus));
}

describe('classifyBlockForSelection', () => {
	it('classifies blocks outside the range', () => {
		const s = sel({ path: [1], offset: 0 }, { path: [3], offset: 0 });
		expect(classifyBlockForSelection([0], s)).toBe('outside');
		expect(classifyBlockForSelection([4], s)).toBe('outside');
	});

	it('classifies the start block', () => {
		const s = sel({ path: [1], offset: 1 }, { path: [3], offset: 1 });
		expect(classifyBlockForSelection([1], s)).toBe('start');
	});

	it('classifies the end block', () => {
		const s = sel({ path: [1], offset: 1 }, { path: [3], offset: 1 });
		expect(classifyBlockForSelection([3], s)).toBe('end');
	});

	it('classifies middle blocks', () => {
		const s = sel({ path: [1], offset: 0 }, { path: [4], offset: 0 });
		expect(classifyBlockForSelection([2], s)).toBe('whole');
		expect(classifyBlockForSelection([3], s)).toBe('whole');
	});

	it('handles reverse selections via normalization', () => {
		const s = sel({ path: [4], offset: 1 }, { path: [1], offset: 1 });
		expect(classifyBlockForSelection([1], s)).toBe('start');
		expect(classifyBlockForSelection([4], s)).toBe('end');
		expect(classifyBlockForSelection([2], s)).toBe('whole');
		expect(classifyBlockForSelection([3], s)).toBe('whole');
	});

	it('returns single-block when start.path === end.path', () => {
		const s = sel({ path: [2], offset: 0 }, { path: [2], offset: 2 });
		expect(classifyBlockForSelection([2], s)).toBe('single-block');
	});

	it('handles cross-container nested paths', () => {
		const s = sel({ path: [0, 0], offset: 1 }, { path: [2, 1], offset: 0 }, QUOTES);
		expect(classifyBlockForSelection([0, 0], s)).toBe('start');
		expect(classifyBlockForSelection([2, 1], s)).toBe('end');
		expect(classifyBlockForSelection([0, 1], s)).toBe('whole');
		expect(classifyBlockForSelection([1], s)).toBe('whole');
		expect(classifyBlockForSelection([2, 0], s)).toBe('whole');
	});

	it('paints a rule held whole at the start as part of the quote it empties', () => {
		const s = sel({ path: [0, 0], offset: 0 }, { path: [1], offset: 2 }, '> ---\n\npara\n');
		expect(classifyBlockForSelection([0], s)).toBe('whole');
		expect(classifyBlockForSelection([0, 0], s)).toBe('outside');
		expect(classifyBlockForSelection([1], s)).toBe('end');
	});
});

// Miss-analysis: GH #321; overlay cases pinned the class, none asked which block paints the box.
describe('blockPaintsWholeBox', () => {
	it('paints a leaf the range holds whole, and no block it only partly covers', () => {
		const s = sel({ path: [1], offset: 1 }, { path: [4], offset: 0 });
		expect(blockPaintsWholeBox([2], s, null)).toBe(true);
		expect(blockPaintsWholeBox([0], s, null)).toBe(false);
		expect(blockPaintsWholeBox([9], s, null)).toBe(false);
		expect(blockPaintsWholeBox([1], s, null)).toBe(false);
		expect(blockPaintsWholeBox([4], s, null)).toBe(false);
	});

	it('paints the container whose subtree the range holds, never its children', () => {
		const s = sel({ path: [0], offset: 0 }, { path: [2], offset: 0 }, 'x\n\n- a\n  - b\n\ny\n');
		expect(blockPaintsWholeBox([1], s, null)).toBe(true);
		expect(blockPaintsWholeBox([1, 0], s, null)).toBe(false);
		expect(blockPaintsWholeBox([1, 0, 0], s, null)).toBe(false);
	});

	it('leaves an ancestor of the end endpoint to its children', () => {
		const s = sel({ path: [0], offset: 0 }, { path: [1, 1], offset: 1 }, 'x\n\n> a\n>\n> bb\n');
		expect(blockPaintsWholeBox([1], s, null)).toBe(false);
		expect(blockPaintsWholeBox([1, 0], s, null)).toBe(true);
		expect(blockPaintsWholeBox([1, 1], s, null)).toBe(false);
	});

	it('paints the whole unit of a single-block range and nothing beside it', () => {
		const s = sel({ path: [1], offset: 0 }, { path: [1], offset: 2 });
		expect(blockPaintsWholeBox([1], s, [1])).toBe(true);
		expect(blockPaintsWholeBox([1, 0], s, [1])).toBe(false);
		expect(blockPaintsWholeBox([2], s, [1])).toBe(false);
		expect(blockPaintsWholeBox([1], s, null)).toBe(false);
	});
});

// Miss-analysis: every box row put the range's ends strictly outside the boxed block, so none
// asked how an end block the range covers to its last byte paints.
describe('an end block the range covers whole', () => {
	// [1] a paragraph, [2] a list of four items, each item's text at [2, i, 0].
	const PROBE = 'intro\n\nAgreed work\n- alpha\n- beta\n- gamma\n- delta\n\nLoose ends\n';
	const UNDER_LIST = [
		[2, 0],
		[2, 1],
		[2, 2],
		[2, 3],
		[2, 3, 0]
	];

	it('paints one box per block the range covers, and nothing under the list’s box', () => {
		const s = sel({ path: [1], offset: 0 }, { path: [2, 3, 0], offset: 5 }, PROBE);
		expect(blockPaintsWholeBox([1], s, null)).toBe(true);
		expect(blockPaintsWholeBox([2], s, null)).toBe(true);
		for (const inside of UNDER_LIST) {
			expect(blockPaintsWholeBox(inside, s, null)).toBe(false);
			expect(classifyBlockForSelection(inside, s)).toBe('outside');
		}
	});

	it('keeps a mid-text end on its text, with the items between boxed', () => {
		const s = sel({ path: [1], offset: 3 }, { path: [2, 3, 0], offset: 2 }, PROBE);
		expect(classifyBlockForSelection([1], s)).toBe('start');
		expect(classifyBlockForSelection([2], s)).toBe('outside');
		expect(classifyBlockForSelection([2, 3, 0], s)).toBe('end');
		for (const item of [
			[2, 0],
			[2, 1],
			[2, 2]
		]) {
			expect(blockPaintsWholeBox(item, s, null)).toBe(true);
		}
		expect(blockPaintsWholeBox([1], s, null)).toBe(false);
	});

	// The snap takes the end to its row's last cell, which still leaves a row of the table out.
	it('keeps a table end on its cells, the paragraph before it boxed', () => {
		const table = 'para\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';
		const s = sel({ path: [0], offset: 0 }, cellPoint([1], 2), table);
		expect(blockPaintsWholeBox([0], s, null)).toBe(true);
		expect(blockPaintsWholeBox([1], s, null)).toBe(false);
		expect(classifyBlockForSelection([1], s)).toBe('end');
	});
});

// Miss-analysis: the overlay rows all used ranges over open blocks, so none asked how a closed
// details the range takes whole is painted.
describe('a closed details the range takes whole', () => {
	beforeEach(registerChromePluginsForTests);

	// [0] above, [1] the details ([1,0] its title row, [1,1] its hidden body), [2] below.
	const doc = () =>
		parse('above\n\n<details>\n<summary>Sum</summary>\n\nHidden\n\n</details>\n\nbelow\n');

	it.each([
		['ending on its title row', { path: [0], offset: 2 }, { path: [1, 0], offset: 2 }],
		['starting on its title row', { path: [1, 0], offset: 1 }, { path: [2], offset: 2 }]
	])('%s paints one box, and its title row paints no endpoint', (_, anchor, focus) => {
		const d = doc();
		const range = rangeCoverage(d, coverRange(d, anchor, focus));
		expect(blockPaintsWholeBox([1], range, null)).toBe(true);
		expect(classifyBlockForSelection([1], range)).toBe('whole');
		for (const inside of [
			[1, 0],
			[1, 1]
		]) {
			expect(blockPaintsWholeBox(inside, range, null)).toBe(false);
			expect(classifyBlockForSelection(inside, range)).toBe('outside');
		}
	});
});

describe('endpointMeasureSpan', () => {
	const TABLE = 'para\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\ntail\n';

	it('measures a text edge from the start, or up to the end', () => {
		const s = sel({ path: [0], offset: 2 }, { path: [2], offset: 3 }, TABLE);
		expect(endpointMeasureSpan('start', s)).toEqual({ from: 2, to: SELECTION_END });
		expect(endpointMeasureSpan('end', s)).toEqual({ from: 0, to: 3 });
	});

	// Cell 2 sits mid-row, so the snap takes the end to its row's last cell, and the run past it.
	it('measures a kept table end through the cells the coverage hands over', () => {
		const s = sel({ path: [0], offset: 2 }, cellPoint([1], 2), TABLE);
		expect(endpointMeasureSpan('end', s)).toEqual({ from: 0, to: 4 });
	});

	it('measures a kept table start from the first cell of its row', () => {
		const s = sel(cellPoint([1], 3), { path: [2], offset: 3 }, TABLE);
		expect(endpointMeasureSpan('start', s)).toEqual({ from: 2, to: SELECTION_END });
	});
});
