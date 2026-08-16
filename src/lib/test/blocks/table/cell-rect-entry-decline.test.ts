// @vitest-environment jsdom
//
// Entering an intra-table rectangle seeds a cross-block pair BEFORE it knows whether the extend
// that leaves the table can land. Miss (Sel-F1): the keyboard requirement file pins the declining
// gesture with a PARAGRAPH as the last block, where the seed is never minted at all; the table
// sibling mints one first and then hears the extend decline, and no test covered it.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { tick } from 'svelte';
import {
	blockHostAt,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	type MountedEditor
} from '../editor-mount';

beforeAll(installLayoutStubs);

// The report's repro byte for byte: the table is the LAST block, so a downward exit from its
// last row has nowhere to land.
const TABLE_LAST = 'intro\n\n| aa | bb |\n| -- | -- |\n| cc | wxyz |\n';

let mounted: MountedEditor | null = null;
// jsdom leaves Range rect measurement unimplemented; without these the visual-line probe throws
// instead of falling back to the offset comparison the cell's edge gate reads.
const originalRangeRects = Range.prototype.getClientRects;
const originalRangeBox = Range.prototype.getBoundingClientRect;
beforeEach(() => {
	Range.prototype.getClientRects = () =>
		({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
	Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
});
afterEach(async () => {
	Range.prototype.getClientRects = originalRangeRects;
	Range.prototype.getBoundingClientRect = originalRangeBox;
	if (mounted) await mounted.destroy();
	mounted = null;
});

function cell(rowIdx: number, colIdx: number): HTMLElement {
	const row = blockHostAt(mounted!, [1]).querySelector(`[data-table-row-idx="${rowIdx}"]`);
	const found = row?.querySelectorAll(':scope > .table-cell')[colIdx] as HTMLElement | undefined;
	if (!found) throw new Error(`no mounted cell at ${rowIdx},${colIdx}`);
	return found;
}

async function press(el: HTMLElement, init: KeyboardEventInit): Promise<void> {
	el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
	for (let i = 0; i < 12; i++) await tick();
}

describe('a rectangle entry that cannot leave the table leaves nothing behind', () => {
	it('a declined downward exit stores no selection', async () => {
		mounted = mountEditor({ source: TABLE_LAST });
		const last = cell(1, 1);
		placeCaret(last, 4);

		await press(last, { key: 'ArrowDown', shiftKey: true });

		// The caret is still the cell's own. A stored pair reports the TABLE block with a cell
		// index instead — and it is invisible: the overlay declines a same-path equal-offset
		// pair, and the root hides the native caret for as long as one stands.
		expect(mounted.instance.getSelection()?.anchor.path).toEqual([1, 1, 1]);
	});

	it('the Backspace after it deletes a character, never the whole cell', async () => {
		mounted = mountEditor({ source: TABLE_LAST });
		const last = cell(1, 1);
		placeCaret(last, 4);

		await press(last, { key: 'ArrowDown', shiftKey: true });
		await press(cell(1, 1), { key: 'Backspace' });

		// jsdom performs no native deletion, so the bytes standing still IS the assertion: a
		// live cross-block state would have run the range delete and cleared the cell instead.
		expect(mounted.source()).toContain('| cc | wxyz |');
	});

	// What the fallthrough produces where a next leaf DOES exist: the press reaches the shared
	// prose extend, whose next doc-order leaf is the cell to the right. On record because the
	// press used to be consumed outright, leaving the invisible pair instead.
	it('a declined exit from a cell with a sibling after it grows the rect sideways', async () => {
		mounted = mountEditor({ source: TABLE_LAST });
		const first = cell(1, 0);
		placeCaret(first, 2);

		await press(first, { key: 'ArrowDown', shiftKey: true });

		const selection = mounted.instance.getSelection();
		// Both endpoints address the table by cell index: cells 2 and 3, a painted rectangle.
		expect(selection?.anchor).toEqual({ path: [1], offset: 2, cellCoordinate: true });
		expect(selection?.focus).toEqual({ path: [1], offset: 3, cellCoordinate: true });
	});

	// The control: an extend that CAN land still enters the rectangle, so the decline above is
	// the extend's answer and not a dead entry path.
	it('an upward extend inside the grid still enters the rectangle', async () => {
		mounted = mountEditor({ source: TABLE_LAST });
		const last = cell(1, 1);
		placeCaret(last, 0);

		await press(last, { key: 'ArrowUp', shiftKey: true });

		const selection = mounted.instance.getSelection();
		expect(selection?.anchor.path).toEqual([1]);
		expect(selection?.focus.path).toEqual([1]);
	});
});
