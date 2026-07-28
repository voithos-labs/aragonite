// @vitest-environment jsdom
//
// Where a paste dropped on a cell ends up. `table-cell-paste.test.ts` drives the
// surface's hook with arguments a test supplies; the routing that decides the
// hook runs at all — the cell's paste handler, the dispatcher, and the surface
// registered for `tableCell` — was only ever asserted in the browser.
//
// Two things can go wrong and both destroy the table silently: the generic inline
// surface handling the paste instead (no pipe escape), and a pasted newline
// reaching `cell.raw` (a row cannot carry one). Both are byte-visible here.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { metadataOf } from '$lib/core/nodes';
import { blockHostAt, installLayoutStubs, mountEditor, type MountedEditor } from '../editor-mount';

beforeAll(installLayoutStubs);

let mounted: MountedEditor | null = null;
afterEach(async () => {
	if (mounted) await mounted.destroy();
	mounted = null;
});

const GRID = '| A | B |\n| --- | --- |\n| one | 2 |\n';

function cell(rowIdx: number, colIdx: number): HTMLElement {
	const table = blockHostAt(mounted!, [0]);
	const row = table.querySelector(`[data-table-row-idx="${rowIdx}"]`);
	const found = row?.querySelectorAll(':scope > .table-cell')[colIdx] as HTMLElement | undefined;
	if (!found) throw new Error(`no mounted cell at ${rowIdx},${colIdx}`);
	return found;
}

/** jsdom builds no ClipboardEvent, so the payload rides a real dispatched event. */
async function pasteInto(el: HTMLElement, text: string): Promise<void> {
	const event = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clipboardData', {
		value: { getData: (type: string) => (type === 'text/plain' ? text : ''), setData: () => {} }
	});
	el.dispatchEvent(event);
	await mounted!.settle();
}

/** Select `[start, end)` of the cell's rendered text, the way a drag would. */
function selectInCell(el: HTMLElement, start: number, end: number): void {
	el.focus();
	const textNode = el.firstChild;
	if (!textNode) throw new Error('cell has no rendered text to select');
	const range = document.createRange();
	range.setStart(textNode, start);
	range.setEnd(textNode, end);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
}

/** Collapsed caret past the cell's last character. */
function caretAtCellEnd(el: HTMLElement): void {
	const length = el.firstChild?.textContent?.length ?? 0;
	selectInCell(el, length, length);
}

function reparsedColumns(): number {
	return metadataOf(parse(mounted!.source()).children[0], 'table').columnCount;
}

describe('a paste into a cell lands on the cell’s own paste surface', () => {
	it('escapes a pasted pipe, so the row keeps its column count', async () => {
		mounted = mountEditor({ source: GRID });
		const el = cell(1, 0);
		caretAtCellEnd(el);

		await pasteInto(el, 'x|y');

		expect(mounted.source()).toContain('\\|');
		expect(reparsedColumns()).toBe(2);
	});

	it('collapses a multi-line paste to one line', async () => {
		// A raw newline in `cell.raw` splits the row's bytes in two; the surface
		// folds the lines to spaces rather than letting them through.
		mounted = mountEditor({ source: GRID });
		const el = cell(1, 0);
		selectInCell(el, 0, 3);

		await pasteInto(el, 'first\nsecond\nthird');

		expect(mounted.source()).toBe('| A | B |\n| --- | --- |\n| first second third | 2 |\n');
	});

	it('trims the pasted run rather than padding the cell', async () => {
		mounted = mountEditor({ source: GRID });
		const el = cell(1, 1);
		selectInCell(el, 0, 1);

		await pasteInto(el, '  spaced  \n');

		expect(mounted.source()).toBe('| A | B |\n| --- | --- |\n| one | spaced |\n');
	});

	it('replaces the cell’s selected range instead of inserting beside it', async () => {
		mounted = mountEditor({ source: GRID });
		const el = cell(1, 0);
		selectInCell(el, 0, 3);

		await pasteInto(el, 'two');

		expect(mounted.source()).toBe('| A | B |\n| --- | --- |\n| two | 2 |\n');
	});

	it('ignores an empty clipboard rather than committing a no-op edit', async () => {
		mounted = mountEditor({ source: GRID });
		const el = cell(1, 0);
		el.focus();

		await pasteInto(el, '');

		expect(mounted.source()).toBe(GRID);
	});
});
