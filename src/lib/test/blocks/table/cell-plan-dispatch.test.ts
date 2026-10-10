// @vitest-environment jsdom
// The cell turns a `cellKeydownPlan` navigation plan into a call on the table context, driven by
// a real keystroke in a full Editor mount and asserted on the result. The planner has its own
// suite, and the structural chords are keymap bindings tested in `cell-table-chords.test.ts`.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	installLayoutStubs,
	mountEditor,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { cellAt, pressInCell } from './mount-table';

beforeAll(installLayoutStubs);

let mounted: MountedEditor | null = null;
afterEach(async () => {
	if (mounted) await mounted.destroy();
	mounted = null;
});

// 3 rows × 2 columns; row 0 is the header, row 2 the last body row.
const GRID = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

function mountGrid(): void {
	mounted = mountEditor({ source: GRID });
}

describe('the cell translates a navigation plan into a focus move', () => {
	it('Tab steps to the next column', async () => {
		mountGrid();

		await pressInCell(mounted!, 1, 0, { key: 'Tab' });

		expect(document.activeElement).toBe(cellAt(mounted!, 1, 1));
	});

	it('Tab wraps to the first column of the next row', async () => {
		mountGrid();

		await pressInCell(mounted!, 1, 1, { key: 'Tab' });

		expect(document.activeElement).toBe(cellAt(mounted!, 2, 0));
	});

	it('Shift+Tab steps back across the row boundary', async () => {
		mountGrid();

		await pressInCell(mounted!, 2, 0, { key: 'Tab', shiftKey: true });

		expect(document.activeElement).toBe(cellAt(mounted!, 1, 1));
	});

	it('Enter drops into the cell below, not to the next column', async () => {
		mountGrid();

		await pressInCell(mounted!, 0, 1, { key: 'Enter' });

		expect(document.activeElement).toBe(cellAt(mounted!, 1, 1));
	});
});

describe('the cell translates the row-creating plans into real rows', () => {
	it('Tab at the last cell of the last row appends a row and lands in it', async () => {
		mountGrid();

		await pressInCell(mounted!, 2, 1, { key: 'Tab' });

		expect(mounted!.source()).toBe(`${GRID}|  |  |\n`);
		expect(document.activeElement).toBe(cellAt(mounted!, 3, 0));
	});

	it('Enter in the last row appends a row too', async () => {
		mountGrid();

		await pressInCell(mounted!, 2, 0, { key: 'Enter' });

		expect(mounted!.source()).toBe(`${GRID}|  |  |\n`);
		expect(document.activeElement).toBe(cellAt(mounted!, 3, 0));
	});
});
