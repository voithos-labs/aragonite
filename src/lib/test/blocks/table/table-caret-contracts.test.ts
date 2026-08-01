// @vitest-environment jsdom
//
// The three contracts the table's two layers owe the caret machinery, which nothing else
// observes: the grid and row markup contribute NO characters (a stray text node joins the
// raw-offset walk and shifts a parked caret by its length; only rendered DOM can say the
// habit holds); the park door must NOT end the live range (G2.12 reads focus forwards and
// park callers, so a container's inner door choice is invisible to it); and a path-addressed
// landing carries its offset down to the cell, which is how undo restores the exact spot.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { installTableLayoutStubs, mountTable, type MountedTable } from './mount-table';

let restoreLayout: () => void;
beforeAll(() => {
	restoreLayout = installTableLayoutStubs();
	return () => restoreLayout();
});

let mounted: MountedTable | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
	document.body.innerHTML = '';
});

const GRID = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

/** Direct children only: a cell's own text is content, the grid's and the row's is not. */
function ownTextOf(el: Element): string[] {
	return Array.from(el.childNodes)
		.filter((child) => child.nodeType === Node.TEXT_NODE)
		.map((child) => child.textContent ?? '');
}

describe('the table markup contributes no characters to the raw-offset walk', () => {
	it('holds no text node between the corner, the column grips, and the rows', () => {
		mounted = mountTable(GRID);

		expect(ownTextOf(mounted.el)).toEqual([]);
	});

	it('holds none inside a row either, between its grip and its cells', () => {
		mounted = mountTable(GRID);

		const rows = mounted.el.querySelectorAll(':scope > [data-table-row-idx]');
		expect(rows).toHaveLength(3);
		for (const row of rows) expect(ownTextOf(row)).toEqual([]);
	});
});

describe('the table lands a caret through the door and at the offset it was asked for', () => {
	it('parks in the corner cell without ending a live cross-block range', () => {
		// Non-vacuity is the pair of assertions: a park that declined to move the caret would
		// also leave the range alone. Landing THROUGH the cell's focus door is the regression
		// — it ends the range, and the next Shift+Arrow extends from a collapsed caret.
		const selection = createSelectionState();
		selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 0 });
		mounted = mountTable(GRID, { services: { selection } });

		mounted.block.parkCaret!(0);

		expect(document.activeElement).toBe(mounted.cell(0, 0));
		expect(selection.isCrossBlock).toBe(true);
	});

	it('carries the offset down the row to the cell, not just the cell address', () => {
		mounted = mountTable(GRID);

		mounted.block.focusByPath!([2, 1], 1);

		expect(mounted.block.getCursorPosition!()).toEqual({ path: [2, 1], offset: 1 });
	});
});
