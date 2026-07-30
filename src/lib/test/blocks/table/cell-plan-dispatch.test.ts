// @vitest-environment jsdom
//
// `cellKeydownPlan` decides; the cell TRANSLATES — a plan becomes a table-context
// call, and that translation is the untested half. The planner has its own suite
// (cell-keydown-plan.test.ts) over inputs a test hands it; here the input is a
// real keystroke on a real cell, and the assertion is the document that came out.
//
// Scope: the NAVIGATION plans, which is all the planner still decides. The structural
// chords are keymap bindings and live in cell-table-chords.test.ts.
//
// Driven through a mounted Editor rather than a bare table: every arm below
// commits, and a commit replaces the table node by copy-path-on-write — only a
// real parent re-renders the component with the replacement (see
// `blocks/editor-mount.ts`).
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { blockHostAt, installLayoutStubs, mountEditor, type MountedEditor } from '../editor-mount';

beforeAll(installLayoutStubs);

let mounted: MountedEditor | null = null;
afterEach(async () => {
	if (mounted) await mounted.destroy();
	mounted = null;
});

// 3 rows × 2 columns; row 0 is the header, row 2 the last body row.
const GRID = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

/** The cell element at `rowIdx`,`colIdx` of the table block at `[0]`. */
function cell(rowIdx: number, colIdx: number): HTMLElement {
	const table = blockHostAt(mounted!, [0]);
	const row = table.querySelector(`[data-table-row-idx="${rowIdx}"]`);
	const found = row?.querySelectorAll(':scope > .table-cell')[colIdx] as HTMLElement | undefined;
	if (!found) throw new Error(`no mounted cell at ${rowIdx},${colIdx}`);
	return found;
}

/** Focus a cell and send it a key, settling the commit it may start. */
async function pressInCell(rowIdx: number, colIdx: number, init: KeyboardEventInit): Promise<void> {
	const el = cell(rowIdx, colIdx);
	el.focus();
	el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
	await mounted!.settle();
}

function mountGrid(): void {
	mounted = mountEditor({ source: GRID });
}

describe('the cell translates a navigation plan into a focus move', () => {
	it('Tab steps to the next column', async () => {
		mountGrid();

		await pressInCell(1, 0, { key: 'Tab' });

		expect(document.activeElement).toBe(cell(1, 1));
	});

	it('Tab wraps to the first column of the next row', async () => {
		mountGrid();

		await pressInCell(1, 1, { key: 'Tab' });

		expect(document.activeElement).toBe(cell(2, 0));
	});

	it('Shift+Tab steps back across the row boundary', async () => {
		mountGrid();

		await pressInCell(2, 0, { key: 'Tab', shiftKey: true });

		expect(document.activeElement).toBe(cell(1, 1));
	});

	it('Enter drops into the cell below, not to the next column', async () => {
		mountGrid();

		await pressInCell(0, 1, { key: 'Enter' });

		expect(document.activeElement).toBe(cell(1, 1));
	});
});

describe('the cell translates the row-creating plans into real rows', () => {
	it('Tab at the last cell of the last row appends a row and lands in it', async () => {
		mountGrid();

		await pressInCell(2, 1, { key: 'Tab' });

		expect(mounted!.source()).toBe(`${GRID}|  |  |\n`);
		expect(document.activeElement).toBe(cell(3, 0));
	});

	it('Enter in the last row appends a row too', async () => {
		mountGrid();

		await pressInCell(2, 0, { key: 'Enter' });

		expect(mounted!.source()).toBe(`${GRID}|  |  |\n`);
	});
});
