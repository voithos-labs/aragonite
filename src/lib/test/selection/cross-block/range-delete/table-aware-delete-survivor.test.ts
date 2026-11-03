// Where the caret goes when every block the range covered is gone: nowhere, from the delete alone,
// since the commit gives an emptied document its block; and the descent into a surviving container
// respects collapse, so the caret belongs on a collapsed container's title line.
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../../../core/parser';
import { blockNodeAt } from '../../../../tree-operations/node-primitives';
import { registerDetailsKind } from '#packages/details/src/details-kind.js';
import type { CellSelectionPoint } from '../../../../selection/primitives';
import { deleteRange } from '../../../harness/range-delete';
import { testView } from '#lib/test/harness/test-view.js';

/** Row-major cell index on the table block's own path. */
const cell = (path: number[], index: number): CellSelectionPoint => ({
	path,
	offset: index,
	cellCoordinate: true
});

/** Two 2×2 tables back to back; consuming both empties everything between them. */
function twoTables(lineEnding: string): string {
	const table = [`| A | B |`, `| --- | --- |`, `| 1 | 2 |`].join(lineEnding) + lineEnding;
	return table + lineEnding + table;
}

function deleteBothTables(source: string, firstTableIndex: number) {
	const doc = parse(source);
	return deleteRange(doc, cell([firstTableIndex], 0), cell([firstTableIndex + 1], 3));
}

describe('when nothing survives', () => {
	it('the delete leaves no block and no caret, for the commit to fill', () => {
		const result = deleteBothTables(twoTables('\r\n'), 0);

		expect(result.newDoc.children).toEqual([]);
		expect(result.caret(result.newDoc)).toBeNull();
	});
});

describe('the survivor descent stops at a collapsed container’s chrome child', () => {
	beforeEach(() => {
		registerDetailsKind(testView());
	});

	// `<details>` (no `open`) collapses; its children are [summary, body…], so the
	// two branches of the walk land on visibly different leaves.
	const detailsThenTables = (openAttr: string) =>
		`<details${openAttr}>\n<summary>Title</summary>\n\nbody one\n\nbody two\n\n</details>\n\n` +
		twoTables('\n');

	it('a collapsed survivor takes the caret to its summary, not its clamped body', () => {
		const result = deleteBothTables(detailsThenTables(''), 1);

		expect(result.caret(result.newDoc)).toEqual({ path: [0, 0], offset: 5 });
		expect(blockNodeAt(result.newDoc, result.caret(result.newDoc)!.path)?.raw).toBe('Title\n');
	});

	it('an expanded survivor takes the caret to its last body leaf', () => {
		// Non-vacuity: the same document with `open` walks past the summary, so the
		// case above is the collapse branch and not a walk that always stops at 0.
		const result = deleteBothTables(detailsThenTables(' open'), 1);

		expect(result.caret(result.newDoc)).toEqual({ path: [0, 2], offset: 8 });
		expect(blockNodeAt(result.newDoc, result.caret(result.newDoc)!.path)?.raw).toBe('body two\n');
	});
});
