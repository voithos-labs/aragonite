import { describe, it, expect } from 'vitest';
import { parse } from '../../../../core/parser';
import { serialize } from '../../../../core/serializer';
import { cellPoint, type SelectionPoint } from '../../../../selection/primitives';
import { TWO_COL_FOUR_ROW } from '../../table-fixtures';
import { deleteRange } from '../../../harness/range-delete';

// Each case truncates its text endpoint on a different side of the shared cross-block deletion
// steps, and finds its survivor by node identity, since a delete inside the range shifts it.

function run(source: string, start: SelectionPoint, end: SelectionPoint) {
	const doc = parse(source);
	const result = deleteRange(doc, start, end);
	return {
		doc: result.newDoc,
		source: serialize(result.newDoc),
		caret: result.caret(result.newDoc)
	};
}

describe('cross-block delete commit sequence: per-case ordering survives the shared path', () => {
	it('Case 1 (prose→table): the between block drops and the start truncates through the shared path', () => {
		// mid goes, shifting the table [2]→[1], before the start truncates; the end in body row 1
		// takes the header and that row, so row 2 is promoted.
		const { doc, source, caret } = run(
			`head\n\nmid\n\n${TWO_COL_FOUR_ROW}`,
			{ path: [0], offset: 2 },
			cellPoint([2], 2)
		);

		const survivors = doc.children;
		expect(survivors.map((c) => c.kind)).toEqual(['paragraph', 'table']);
		expect(survivors[0].raw.trimEnd()).toBe('he');
		const table = survivors[1];
		expect(table.children).toHaveLength(2);
		expect(table.children![0].children![0].raw).toBe('3');
		expect(table.children![0].children![1].raw).toBe('4');
		expect(caret).toEqual({ path: [0], offset: 2 });
		expect(source).not.toContain('mid');
	});

	it('Case 2 (table→prose): end replaces before the delete; surviving tail resolves its shifted path by identity', () => {
		// The tail is replaced at its live path, then found by identity once mid goes ([2]→[1]); the
		// start in body row 1 takes that row and every row below, leaving the header.
		const { doc, source, caret } = run(
			`${TWO_COL_FOUR_ROW}\nmid\n\ntail text\n`,
			cellPoint([0], 3),
			{ path: [2], offset: 5 }
		);

		const survivors = doc.children;
		expect(survivors.map((c) => c.kind)).toEqual(['table', 'paragraph']);
		const table = survivors[0];
		expect(table.children).toHaveLength(1);
		expect(table.children![0].children!.map((cell) => cell.raw)).toEqual(['A', 'B']);
		expect(survivors[1].raw.trimEnd()).toBe('text');
		expect(caret).toEqual({ path: [0, 0, 1], offset: 1 });
		expect(source).not.toContain('mid');
	});

	it('Case 3 (table→table): start empties and the caret lands in the identity-resolved end table', () => {
		// tableA[0] empties → removed, mid1[1], mid2[2], tableB[3]. Both betweens delete and A's block
		// goes, shifting B [3]→[0]; the caret addresses B by identity, since a stale [3] is off-tree.
		const { doc, source, caret } = run(
			`${TWO_COL_FOUR_ROW}\nmid1\n\nmid2\n\n${TWO_COL_FOUR_ROW}`,
			cellPoint([0], 0),
			cellPoint([3], 2)
		);

		const survivors = doc.children;
		expect(survivors.map((c) => c.kind)).toEqual(['table']);
		expect(survivors[0].children).toHaveLength(2);
		expect(survivors[0].children![0].children![1].raw).toBe('4');
		expect(caret).toEqual({ path: [0, 0, 0], offset: 0 });
		expect(source).not.toContain('mid1');
		expect(source).not.toContain('mid2');
	});
});
