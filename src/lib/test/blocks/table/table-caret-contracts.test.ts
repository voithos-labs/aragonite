// @vitest-environment jsdom
//
// The three contracts the table's own two layers owe the caret machinery, none of which a
// reader of either component would guess and none of which anything else observes.
//   · The grid and row markup contribute NO characters: a stray text node joins the raw-offset
//     walk (`cursor/widget-offset.ts`) and shifts a parked cross-block caret by its length. The
//     rule is a template-formatting habit that one reflow undoes, and only the rendered DOM can
//     say whether it still holds.
//   · The park door owes the opposite of the focus door — it must NOT end the live range,
//     because the extend that reached it is still growing one. The G2.12 source scan reads
//     focus FORWARDS and park CALLERS, so which of its child's doors a container lands through
//     is invisible to it.
//   · A path-addressed landing carries its offset down to the cell, which is how undo puts the
//     caret back where the edit was rather than at the cell's start.
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
