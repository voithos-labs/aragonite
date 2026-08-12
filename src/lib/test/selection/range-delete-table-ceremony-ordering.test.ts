import { describe, it, expect, afterEach } from 'vitest';
import { rangeDelete } from '../../selection/range-delete';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { createSharingState } from '../../tree-operations/sharing';
import { allowDevWarns } from '$lib/test/support/warn-gate';

// rangeDelete is driven with hand-built endpoints, so the table arms see char offsets
// SelectionState would have snapped to cell coordinates first.
afterEach(() =>
	allowDevWarns([
		'deleteFromProseIntoTable:end',
		'deleteFromTableIntoProse:start',
		'deleteAcrossTwoTables:start',
		'deleteAcrossTwoTables:end'
	])
);

// Contract guard for the shared cross-block deletion ceremony (planCrossBlockDeletion →
// applyPlannedDeletion → rebuildSharedAncestries). Each case routes through the SAME helpers but
// sequences its endpoint prose-replace on a different side of the delete, and locates its shifted
// survivor by identity — a between block strictly inside the range shifts that document index.

const TWO_COL_FOUR_ROW = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n';

describe('cross-block delete ceremony — per-case ordering survives the shared path', () => {
	it('Case 1 (prose→table): the between block drops and the start truncates through the shared path', () => {
		// para[0], mid[1], table[2]. mid is strictly between → deleted, shifting the table [2]→[1]. The
		// start truncates AFTER the delete; before would shift the between/end deletion paths mid-plan.
		const doc = parse(`head\n\nmid\n\n${TWO_COL_FOUR_ROW}`);

		const result = rangeDelete(
			doc,
			{ path: [0], offset: 2 },
			{ path: [2], offset: 2 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		const survivors = result.newDoc.children;
		expect(survivors.map((c) => c.kind)).toEqual(['paragraph', 'table']);
		expect(survivors[0].raw.trimEnd()).toBe('he');
		const table = survivors[1];
		expect(table.children).toHaveLength(3);
		expect(table.children![0].children![0].raw).toBe('');
		expect(table.children![0].children![1].raw).toBe('2');
		expect(result.collapsedCaret).toEqual({ path: [0], offset: 2 });
		expect(serialize(result.newDoc)).not.toContain('mid');
	});

	it('Case 2 (table→prose): end replaces BEFORE the delete; surviving tail resolves its shifted path by identity', () => {
		// table[0] survives, mid[1], tail[2]. mid deleted → tail [2]→[1]. The end tail is replaced at
		// its live path first, then re-located by identity — replacing after hits a stale slot.
		const doc = parse(`${TWO_COL_FOUR_ROW}\nmid\n\ntail text\n`);

		const result = rangeDelete(
			doc,
			{ path: [0], offset: 3 },
			{ path: [2], offset: 5 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		const survivors = result.newDoc.children;
		expect(survivors.map((c) => c.kind)).toEqual(['table', 'paragraph']);
		const table = survivors[0];
		expect(table.children).toHaveLength(2);
		expect(table.children![1].children![0].raw).toBe('1');
		expect(table.children![1].children![1].raw).toBe('');
		expect(survivors[1].raw.trimEnd()).toBe('text');
		expect(result.collapsedCaret).toEqual({ path: [0, 1, 1], offset: 0 });
		expect(serialize(result.newDoc)).not.toContain('mid');
	});

	it('Case 3 (table→table): start empties and the caret lands in the identity-resolved end table', () => {
		// tableA[0] empties → removed, mid1[1], mid2[2], tableB[3]. Both betweens delete and A's block
		// goes, shifting B [3]→[0]; the caret addresses B by identity, since a stale [3] is off-tree.
		const doc = parse(`${TWO_COL_FOUR_ROW}\nmid1\n\nmid2\n\n${TWO_COL_FOUR_ROW}`);

		const result = rangeDelete(
			doc,
			{ path: [0], offset: 0 },
			{ path: [3], offset: 2 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		const survivors = result.newDoc.children;
		expect(survivors.map((c) => c.kind)).toEqual(['table']);
		expect(survivors[0].children).toHaveLength(3);
		expect(survivors[0].children![0].children![1].raw).toBe('2');
		expect(result.collapsedCaret).toEqual({ path: [0, 0, 0], offset: 0 });
		const out = serialize(result.newDoc);
		expect(out).not.toContain('mid1');
		expect(out).not.toContain('mid2');
	});
});
