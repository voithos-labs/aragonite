import { describe, it, expect, afterEach } from 'vitest';
import { rangeDelete } from '../../selection/range-delete';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { createSharingState } from '../../tree-operations/sharing';
import type { SelectionPoint } from '../../selection/primitives';
import { allowDevWarns } from '$lib/test/support/warn-gate';
import { TWO_COL_FOUR_ROW } from './table-fixtures';
import { fixtureLinkRef } from '../harness/fixture-grammar';
import { defaultGrammarView } from '$lib/schema/block-openers';

// rangeDelete is driven with hand-built endpoints, so the table branches see character offsets
// `SelectionState` would have snapped to cell coordinates first.
afterEach(() =>
	allowDevWarns([
		'deleteFromProseIntoTable:end',
		'deleteFromTableIntoProse:start',
		'deleteAcrossTwoTables:start',
		'deleteAcrossTwoTables:end'
	])
);

// Pins the shared cross-block deletion steps (`planCrossBlockDeletion`, `applyPlannedDeletion`,
// `rebuildSharedAncestries`). Each case routes through the same helpers but truncates its text
// endpoint on a different side of the delete, and finds its shifted survivor by node identity:
// a block strictly inside the range shifts that document index.

function run(source: string, start: SelectionPoint, end: SelectionPoint) {
	const result = rangeDelete(
		parse(source),
		start,
		end,
		createSharingState(),
		defaultGrammarView,
		undefined,
		fixtureLinkRef()
	);
	return { doc: result.newDoc, source: serialize(result.newDoc), caret: result.collapsedCaret };
}

describe('cross-block delete commit sequence: per-case ordering survives the shared path', () => {
	it('Case 1 (prose→table): the between block drops and the start truncates through the shared path', () => {
		// para[0], mid[1], table[2]. mid is strictly between → deleted, shifting the table [2]→[1]. The
		// start truncates after the delete; before would shift the between/end deletion paths mid-plan.
		const { doc, source, caret } = run(
			`head\n\nmid\n\n${TWO_COL_FOUR_ROW}`,
			{ path: [0], offset: 2 },
			{ path: [2], offset: 2 }
		);

		const survivors = doc.children;
		expect(survivors.map((c) => c.kind)).toEqual(['paragraph', 'table']);
		expect(survivors[0].raw.trimEnd()).toBe('he');
		const table = survivors[1];
		expect(table.children).toHaveLength(3);
		expect(table.children![0].children![0].raw).toBe('');
		expect(table.children![0].children![1].raw).toBe('2');
		expect(caret).toEqual({ path: [0], offset: 2 });
		expect(source).not.toContain('mid');
	});

	it('Case 2 (table→prose): end replaces before the delete; surviving tail resolves its shifted path by identity', () => {
		// table[0] survives, mid[1], tail[2]. mid deleted → tail [2]→[1]. The end tail is replaced at
		// its live path first, then found again by identity; replacing after would hit a stale position.
		const { doc, source, caret } = run(
			`${TWO_COL_FOUR_ROW}\nmid\n\ntail text\n`,
			{ path: [0], offset: 3 },
			{ path: [2], offset: 5 }
		);

		const survivors = doc.children;
		expect(survivors.map((c) => c.kind)).toEqual(['table', 'paragraph']);
		const table = survivors[0];
		expect(table.children).toHaveLength(2);
		expect(table.children![1].children![0].raw).toBe('1');
		expect(table.children![1].children![1].raw).toBe('');
		expect(survivors[1].raw.trimEnd()).toBe('text');
		expect(caret).toEqual({ path: [0, 1, 1], offset: 0 });
		expect(source).not.toContain('mid');
	});

	it('Case 3 (table→table): start empties and the caret lands in the identity-resolved end table', () => {
		// tableA[0] empties → removed, mid1[1], mid2[2], tableB[3]. Both betweens delete and A's block
		// goes, shifting B [3]→[0]; the caret addresses B by identity, since a stale [3] is off-tree.
		const { doc, source, caret } = run(
			`${TWO_COL_FOUR_ROW}\nmid1\n\nmid2\n\n${TWO_COL_FOUR_ROW}`,
			{ path: [0], offset: 0 },
			{ path: [3], offset: 2 }
		);

		const survivors = doc.children;
		expect(survivors.map((c) => c.kind)).toEqual(['table']);
		expect(survivors[0].children).toHaveLength(3);
		expect(survivors[0].children![0].children![1].raw).toBe('2');
		expect(caret).toEqual({ path: [0, 0, 0], offset: 0 });
		expect(source).not.toContain('mid1');
		expect(source).not.toContain('mid2');
	});
});
