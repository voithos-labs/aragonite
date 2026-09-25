import { describe, it, expect, afterEach } from 'vitest';
import { rangeDelete } from '../../selection/range-delete';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { createSharingState } from '../../tree-operations/sharing';
import type { Document } from '../../core/nodes';
import type { SelectionPoint } from '../../selection/primitives';
import { allowDevWarns } from '$lib/test/support/warn-gate';
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

// The table branch shares the title-line branch's deletion steps: a covered container strictly
// between the endpoints goes as one splice with its children intact, never a child-by-child
// emptying, so the undo entry holds a whole detached node.

const TWO_COL_TWO_ROW = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';

function run(doc: Document, start: SelectionPoint, end: SelectionPoint) {
	const result = rangeDelete(
		doc,
		start,
		end,
		createSharingState(),
		defaultGrammarView,
		undefined,
		fixtureLinkRef()
	);
	return { doc: result.newDoc, source: serialize(result.newDoc), caret: result.collapsedCaret };
}

describe('rangeDelete table branch: covered containers die whole', () => {
	it('Case 1 (prose → table): a covered blockquote detaches with its child intact', () => {
		// [0] para, [1] blockquote(paragraph), [2] table. end.offset 1 = inclusive
		// last header cell → header removed, body promotes, table survives.
		const input = parse(`intro\n\n> quoted\n\n${TWO_COL_TWO_ROW}`);
		const blockquote = input.children[1];
		expect(blockquote.kind).toBe('blockquote');

		const { doc, source } = run(input, { path: [0], offset: 2 }, { path: [2], offset: 1 });

		expect(blockquote.children).toHaveLength(1);
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', 'table']);
		expect(source).not.toContain('quoted');
	});

	it('Case 2 (table → prose): a covered blockquote-wrapped table detaches intact', () => {
		// [0] table (emptied by start.offset 0), [1] blockquote(table), [2] para.
		const input = parse(`${TWO_COL_TWO_ROW}\n> | c | d |\n> | --- | --- |\n\nafter\n`);
		const blockquote = input.children[1];
		expect(blockquote.children?.map((c) => c.kind)).toEqual(['table']);

		const { doc } = run(input, { path: [0], offset: 0 }, { path: [2], offset: 2 });

		expect(blockquote.children).toHaveLength(1);
		expect(blockquote.children![0].kind).toBe('table');
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph']);
		expect(doc.children[0].raw).toBe('ter\n');
	});

	it('two-table span: the between container rides the same commit sequence', () => {
		// [0] table A (emptied), [1] blockquote(paragraph), [2] table B (header
		// row cleared by inclusive end.offset 1, body promotes).
		const input = parse(`${TWO_COL_TWO_ROW}\n> quoted\n\n${TWO_COL_TWO_ROW}`);
		const blockquote = input.children[1];

		const { doc, caret } = run(input, { path: [0], offset: 0 }, { path: [2], offset: 1 });

		expect(blockquote.children).toHaveLength(1);
		expect(doc.children.map((c) => c.kind)).toEqual(['table']);
		expect(caret).toEqual({ path: [0, 0, 0], offset: 0 });
	});
});
