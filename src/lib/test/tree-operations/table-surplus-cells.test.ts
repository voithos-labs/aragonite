// A body row wider than the header keeps its extra cells through every edit. GFM renders only
// the header's column count (spec example 204), but the cells past it are bytes the file holds.
// Miss-analysis: the table tests wrote rows as wide as their header, and the shape property's
// retype gesture skipped table rows because of this very loss, so nothing drove a write into one.
// The range delete's own header promotion was then left out: only `deleteRow` drove one.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { metadataOf, type CstNode, type Document } from '$lib/core/nodes';
import { updateNodeContent } from '$lib/tree-operations/content-write';
import { rebuildTableRaw } from '$lib/schema/container-rebuilders';
import { rebuildUnsharedChain } from '$lib/tree-operations/chain-rebuild';
import { createSharingState } from '$lib/tree-operations/sharing';
import { defaultGrammarView } from '$lib/schema/block-openers';
import {
	deleteColumn,
	deleteRow,
	insertEmptyColumn,
	insertEmptyRow,
	moveColumn
} from '$lib/tree-operations/table-mutations';
import { sliceTableAtRow } from '$lib/tree-operations/paste/table-slice';
import { rangeDelete } from '$lib/selection/range-delete';
import { allowDevWarns } from '$lib/test/support/warn-gate';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { fixtureLinkRef } from '../harness/fixture-grammar';

const WIDE = '| H0 |\n| --- |\n| x | y |\n';

/** A cell's text written the way typing commits it, then the table rebuilt around it. */
function typeInCell(doc: Document, row: number, col: number, text: string): void {
	const table = doc.children[0];
	const holder = table.children![row];
	updateNodeContent(
		{ children: holder.children!, ownerKind: 'tableRow', owner: holder },
		col,
		text
	);
	rebuildUnsharedChain(doc, [table, holder], createSharingState(), null, defaultGrammarView);
}

function tableOf(source: string): { doc: Document; table: CstNode } {
	const doc = parse(source);
	return { doc, table: doc.children[0] };
}

describe('the cells past the header’s count', () => {
	it('are read into the row, not its children', () => {
		const { table } = tableOf(WIDE);
		const row = table.children![1];

		expect(row.children!.map((c) => c.raw)).toEqual(['x']);
		expect(metadataOf(row, 'tableRow').surplusCells).toEqual(['y']);
		expect(metadataOf(table.children![0], 'tableRow').surplusCells).toBeUndefined();
	});

	it('survive a write to a cell in their row', () => {
		const { doc } = tableOf(WIDE);

		typeInCell(doc, 1, 0, 'xs');

		expect(serialize(doc)).toBe('| H0 |\n| --- |\n| xs | y |\n');
		expect(describeConvergence(doc)).toBeNull();
	});

	it('survive a write to another row, through the whole table’s rebuild', () => {
		const { doc } = tableOf('| H0 |\n| --- |\n|x|y|z \\| w|\n| 1 |\n');

		typeInCell(doc, 2, 0, '12');

		expect(serialize(doc)).toBe('| H0 |\n| --- |\n| x | y | z \\| w |\n| 12 |\n');
		expect(describeConvergence(doc)).toBeNull();
	});

	it('keep an empty cell and CRLF endings', () => {
		const { doc } = tableOf('| H0 |\r\n| --- |\r\n| x |  | y |\r\n');

		typeInCell(doc, 1, 0, 'xs');

		expect(serialize(doc)).toBe('| H0 |\r\n| --- |\r\n| xs |  | y |\r\n');
	});

	it('leave a pipe-less row padded to the header’s count', () => {
		const { doc } = tableOf('| a | b |\n| --- | --- |\nplain\n');

		typeInCell(doc, 1, 0, 'plains');

		expect(serialize(doc)).toBe('| a | b |\n| --- | --- |\n| plains |  |\n');
		expect(describeConvergence(doc)).toBeNull();
	});
});

describe('the table’s structural edits keep them', () => {
	const rebuilt = (table: CstNode, doc: Document) => {
		rebuildTableRaw(table);
		return serialize(doc);
	};

	it('a row inserted beside a wide one', () => {
		const { doc, table } = tableOf(WIDE);
		insertEmptyRow(table, 1, 'below');
		expect(rebuilt(table, doc)).toBe('| H0 |\n| --- |\n| x | y |\n|  |\n');
	});

	it('a column inserted, deleted or moved: the surplus stays past the rendered cells', () => {
		const source = '| a | b |\n| --- | --- |\n| 1 | 2 | 3 |\n';
		const inserted = tableOf(source);
		insertEmptyColumn(inserted.table, 0, 'left');
		expect(rebuilt(inserted.table, inserted.doc)).toBe(
			'|  | a | b |\n| --- | --- | --- |\n|  | 1 | 2 | 3 |\n'
		);
		expect(describeConvergence(inserted.doc)).toBeNull();

		const deleted = tableOf(source);
		deleteColumn(deleted.table, 0);
		expect(rebuilt(deleted.table, deleted.doc)).toBe('| b |\n| --- |\n| 2 | 3 |\n');
		expect(describeConvergence(deleted.doc)).toBeNull();

		const moved = tableOf(source);
		moveColumn(moved.table, 0, 1);
		expect(rebuilt(moved.table, moved.doc)).toBe('| b | a |\n| --- | --- |\n| 2 | 1 | 3 |\n');
		expect(describeConvergence(moved.doc)).toBeNull();
	});

	// A header wider than the delimiter row is no table at all, so a row that becomes the header
	// takes its extra cells as columns: the table widens rather than dropping them.
	it('a header row deleted: the promoted row’s extra cells become columns', () => {
		const { doc, table } = tableOf('| H0 |\n| --- |\n| x | y |\n| 1 |\n');

		deleteRow(table, 0);

		expect(rebuilt(table, doc)).toBe('| x | y |\n| --- | --- |\n| 1 |  |\n');
		expect(describeConvergence(doc)).toBeNull();
	});

	it('a range delete from the paragraph above through the header row', () => {
		const doc = parse('para\n\n| H0 |\n| --- |\n| x | y |\n| 1 |\n');
		const [start, end] = [
			{ path: [0], offset: 0 },
			{ path: [1], offset: 0 }
		];

		rangeDelete(
			doc,
			start,
			end,
			createSharingState(),
			defaultGrammarView,
			undefined,
			fixtureLinkRef()
		);
		// The end is given in cells, the unit the selection snaps a table endpoint to.
		allowDevWarns(['deleteFromProseIntoTable:end']);

		expect(serialize(doc)).toBe('\n| x | y |\n| --- | --- |\n| 1 |  |\n');
		expect(describeConvergence(doc)).toBeNull();
	});

	it('a table split where a wide row starts the second half', () => {
		const { table } = tableOf('| H0 |\n| --- |\n| 1 |\n| x | y |\n');

		const { secondHalf } = sliceTableAtRow(table, 2, 'second');

		expect(secondHalf!.raw).toBe('| x | y |\n| --- | --- |\n');
		expect(describeConvergence(parse(secondHalf!.raw))).toBeNull();
	});
});
