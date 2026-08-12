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

// The table branch rides the chrome branch's deletion ceremony: a covered container strictly
// between the endpoints dies as ONE splice with children intact, never a child-by-child emptying,
// so a commit scope or undo entry holding the detached node stays invariant-clean.

const TWO_COL_THREE_ROW = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';

describe('rangeDelete table branch — covered containers die whole', () => {
	it('Case 1 (prose → table): a covered blockquote detaches with its child intact', () => {
		// [0] para, [1] blockquote(paragraph), [2] table. end.offset 1 = inclusive
		// last header cell → header removed, body promotes, table survives.
		const doc = parse(`intro\n\n> quoted\n\n${TWO_COL_THREE_ROW}`);
		const blockquote = doc.children[1];
		expect(blockquote.kind).toBe('blockquote');

		const result = rangeDelete(
			doc,
			{ path: [0], offset: 2 },
			{ path: [2], offset: 1 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		expect(blockquote.children).toHaveLength(1);
		expect(result.newDoc.children.map((c) => c.kind)).toEqual(['paragraph', 'table']);
		expect(serialize(result.newDoc)).not.toContain('quoted');
	});

	it('Case 2 (table → prose): a covered blockquote-wrapped table detaches intact', () => {
		// [0] table (emptied by start.offset 0), [1] blockquote(table), [2] para.
		const doc = parse(`${TWO_COL_THREE_ROW}\n> | c | d |\n> | --- | --- |\n\nafter\n`);
		const blockquote = doc.children[1];
		expect(blockquote.children?.map((c) => c.kind)).toEqual(['table']);

		const result = rangeDelete(
			doc,
			{ path: [0], offset: 0 },
			{ path: [2], offset: 2 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		expect(blockquote.children).toHaveLength(1);
		expect(blockquote.children![0].kind).toBe('table');
		expect(result.newDoc.children.map((c) => c.kind)).toEqual(['paragraph']);
		expect(result.newDoc.children[0].raw).toBe('ter\n');
	});

	it('two-table span: the between container rides the same ceremony', () => {
		// [0] table A (emptied), [1] blockquote(paragraph), [2] table B (header
		// row cleared by inclusive end.offset 1, body promotes).
		const doc = parse(`${TWO_COL_THREE_ROW}\n> quoted\n\n${TWO_COL_THREE_ROW}`);
		const blockquote = doc.children[1];

		const result = rangeDelete(
			doc,
			{ path: [0], offset: 0 },
			{ path: [2], offset: 1 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		expect(blockquote.children).toHaveLength(1);
		expect(result.newDoc.children.map((c) => c.kind)).toEqual(['table']);
		expect(result.collapsedCaret).toEqual({ path: [0, 0, 0], offset: 0 });
	});
});
