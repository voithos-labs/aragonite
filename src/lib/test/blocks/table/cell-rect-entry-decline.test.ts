// @vitest-environment jsdom
//
// Starting a rectangle inside a table records a cross-block pair before it knows whether the
// extend that leaves the table can land. Miss-analysis (Sel-F1): the keyboard requirement file
// covers the refusing gesture with a paragraph as the last block, where nothing is recorded at
// all; a table records the pair first and then hears the extend refuse, and no test covered it.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { installLayoutStubs, mountEditor, placeCaret, type MountedEditor } from '../editor-mount';
import { cellAt, installTableLayoutStubs } from './mount-table';
import { pressKey } from '$lib/test/harness/settle';

// Without the Range stubs the visual-line check throws instead of falling back to the
// offset comparison the cell's edge test reads.
let restoreLayout: () => void;
beforeAll(() => {
	installLayoutStubs();
	restoreLayout = installTableLayoutStubs();
	return () => restoreLayout();
});

// The reported case exactly: the table is the last block, so a downward exit from its last
// row has nowhere to land.
const TABLE_LAST = 'intro\n\n| aa | bb |\n| -- | -- |\n| cc | wxyz |\n';

let mounted: MountedEditor | null = null;
afterEach(async () => {
	if (mounted) await mounted.destroy();
	mounted = null;
});

const cell = (rowIdx: number, colIdx: number) => cellAt(mounted!, rowIdx, colIdx, [1]);

describe('a rectangle entry that cannot leave the table leaves nothing behind', () => {
	it('a declined downward exit stores no selection', async () => {
		mounted = mountEditor({ source: TABLE_LAST });
		const last = cell(1, 1);
		placeCaret(last, 4);

		await pressKey(last, { key: 'ArrowDown', shiftKey: true });

		// The caret is still the cell's own. A stored pair would report the table block with a
		// cell index instead, and it would be invisible: the overlay declines a pair with the
		// same path and offset, and the root hides the browser caret while one stands.
		expect(mounted.instance.getSelection()?.anchor.path).toEqual([1, 1, 1]);
	});

	it('the Backspace after it deletes a character, never the whole cell', async () => {
		mounted = mountEditor({ source: TABLE_LAST });
		const last = cell(1, 1);
		placeCaret(last, 4);

		await pressKey(last, { key: 'ArrowDown', shiftKey: true });
		await pressKey(cell(1, 1), { key: 'Backspace' });

		// jsdom performs no deletion of its own, so the bytes standing still is the assertion:
		// a live cross-block state would have run the range delete and cleared the cell.
		expect(mounted.source()).toContain('| cc | wxyz |');
	});

	// What falling through produces where a next block does exist: the key reaches the shared
	// prose extend, whose next block in document order is the cell to the right. Recorded here
	// because consuming the key outright would leave the invisible pair instead.
	it('a declined exit from a cell with a sibling after it grows the rect sideways', async () => {
		mounted = mountEditor({ source: TABLE_LAST });
		const first = cell(1, 0);
		placeCaret(first, 2);

		await pressKey(first, { key: 'ArrowDown', shiftKey: true });

		const selection = mounted.instance.getSelection();
		// Both endpoints address the table by cell index: cells 2 and 3, a painted rectangle.
		expect(selection?.anchor).toEqual({ path: [1], offset: 2, cellCoordinate: true });
		expect(selection?.focus).toEqual({ path: [1], offset: 3, cellCoordinate: true });
	});

	// The control: an extend that can land still starts the rectangle, so the refusal above is
	// the extend's answer and not an entry path that never works.
	it('an upward extend inside the grid still enters the rectangle', async () => {
		mounted = mountEditor({ source: TABLE_LAST });
		const last = cell(1, 1);
		placeCaret(last, 0);

		await pressKey(last, { key: 'ArrowUp', shiftKey: true });

		const selection = mounted.instance.getSelection();
		expect(selection?.anchor.path).toEqual([1]);
		expect(selection?.focus.path).toEqual([1]);
	});
});
