// Where the caret goes when every block the range covered is gone, driven
// through `tableAwareRangeDelete` directly.
//
// Two claims the existing table-caret suite reaches the shapes of but never
// checks. First, the placeholder minted when the document empties IS a line
// ending (G4.20): the table-caret suite asserts a paragraph appears, not what
// its bytes are, so a defaulted LF there would strand a lone LF in a CRLF file.
// Second, the descent into a surviving container is collapse-aware — a
// collapsed container clamps its body out of view, so the caret belongs on its
// chrome child, not on the last body leaf the walk would otherwise reach.
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { tableAwareRangeDelete } from '../../selection/range-delete-table';
import { createSharingState } from '../../tree-operations/sharing';
import { blockNodeAt } from '../../tree-operations/node-ops';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { __resetPasteSurfacesForTests } from '../../tree-operations/paste-surfaces';
import { registerDetailsKind } from '../../plugins/details/details-kind';
import type { CellSelectionPoint } from '../../selection/primitives';

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
	return tableAwareRangeDelete(
		doc,
		cell([firstTableIndex], 0),
		cell([firstTableIndex + 1], 3),
		createSharingState()
	);
}

describe('the placeholder minted when nothing survives takes the document’s line ending', () => {
	it('a CRLF document keeps CRLF', () => {
		const result = deleteBothTables(twoTables('\r\n'), 0);

		expect(serialize(result.newDoc)).toBe('\r\n');
		expect(result.collapsedCaret).toEqual({ path: [0], offset: 0 });
	});

	it('an LF document stays on LF', () => {
		expect(serialize(deleteBothTables(twoTables('\n'), 0).newDoc)).toBe('\n');
	});
});

describe('the survivor descent stops at a collapsed container’s chrome child', () => {
	beforeEach(() => {
		// registerDetailsKind registers a chrome leaf, which owns a paste surface;
		// the schema reset alone leaves it orphaned and the re-register collides.
		__resetSchemaRegistriesForTests();
		__resetPasteSurfacesForTests();
		registerDetailsKind();
	});

	// `<details>` (no `open`) collapses; its children are [summary, body…], so the
	// two branches of the walk land on visibly different leaves.
	const detailsThenTables = (openAttr: string) =>
		`<details${openAttr}>\n<summary>Title</summary>\n\nbody one\n\nbody two\n\n</details>\n\n` +
		twoTables('\n');

	it('a collapsed survivor takes the caret to its summary, not its clamped body', () => {
		const result = deleteBothTables(detailsThenTables(''), 1);

		expect(result.collapsedCaret).toEqual({ path: [0, 0], offset: 5 });
		expect(blockNodeAt(result.newDoc, result.collapsedCaret.path)?.raw).toBe('Title\n');
	});

	it('an expanded survivor takes the caret to its last body leaf', () => {
		// Non-vacuity: the same document with `open` walks past the summary, so the
		// case above is the collapse branch and not a walk that always stops at 0.
		const result = deleteBothTables(detailsThenTables(' open'), 1);

		expect(result.collapsedCaret).toEqual({ path: [0, 2], offset: 8 });
		expect(blockNodeAt(result.newDoc, result.collapsedCaret.path)?.raw).toBe('body two\n');
	});
});
