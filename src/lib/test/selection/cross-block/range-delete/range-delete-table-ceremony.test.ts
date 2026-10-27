import { describe, it, expect } from 'vitest';
import { parse } from '../../../../core/parser';
import { serialize } from '../../../../core/serializer';
import type { Document } from '../../../../core/nodes';
import { cellPoint, type SelectionPoint } from '../../../../selection/primitives';
import { deleteRange } from '../../../harness/range-delete';

// As in the title-line branch, a covered container between the endpoints goes as one splice with
// its children intact, so the undo entry holds a whole detached node.

const TWO_COL_TWO_ROW = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';

function run(doc: Document, start: SelectionPoint, end: SelectionPoint) {
	const result = deleteRange(doc, start, end);
	return {
		doc: result.newDoc,
		source: serialize(result.newDoc),
		caret: result.caret(result.newDoc)
	};
}

describe('rangeDelete table branch: covered containers die whole', () => {
	it('Case 1 (prose → table): a covered blockquote detaches with its child intact', () => {
		// [0] para, [1] blockquote(paragraph), [2] table. end.offset 1 = inclusive
		// last header cell → header removed, body promotes, table survives.
		const input = parse(`intro\n\n> quoted\n\n${TWO_COL_TWO_ROW}`);
		const blockquote = input.children[1];
		expect(blockquote.kind).toBe('blockquote');

		const { doc, source } = run(input, { path: [0], offset: 2 }, cellPoint([2], 1));

		expect(blockquote.children).toHaveLength(1);
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', 'table']);
		expect(source).not.toContain('quoted');
	});

	it('Case 2 (table → prose): a covered blockquote-wrapped table detaches intact', () => {
		// [0] table (emptied by start.offset 0), [1] blockquote(table), [2] para.
		const input = parse(`${TWO_COL_TWO_ROW}\n> | c | d |\n> | --- | --- |\n\nafter\n`);
		const blockquote = input.children[1];
		expect(blockquote.children?.map((c) => c.kind)).toEqual(['table']);

		const { doc } = run(input, cellPoint([0], 0), { path: [2], offset: 2 });

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

		const { doc, caret } = run(input, cellPoint([0], 0), cellPoint([2], 1));

		expect(blockquote.children).toHaveLength(1);
		expect(doc.children.map((c) => c.kind)).toEqual(['table']);
		expect(caret).toEqual({ path: [0, 0, 0], offset: 0 });
	});
});
