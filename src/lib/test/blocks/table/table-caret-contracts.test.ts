// @vitest-environment jsdom
//
// The three rules the table's two layers must keep for the caret code, which nothing else
// checks: the grid and row markup contribute no characters, since a stray text node joins the
// raw-offset traversal and shifts a remembered caret by its length, and only rendered DOM can
// show that holds; placing a caret must not end the live range (G2.12 reads the callers, so what
// a container does inside is invisible to it); and a landing addressed by path carries its offset
// down to the cell, which is how undo restores the exact spot.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { CURSOR_END, CURSOR_START } from '$lib/block-component';
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
	it('holds no text node between the grid and its rows', () => {
		mounted = mountTable(GRID);

		expect(ownTextOf(mounted.el)).toEqual([]);
	});

	// A lone `{#each}` child gets an empty text anchor from the Svelte runtime, and the traversal
	// sums lengths: what a row must hold is no character, not no text node.
	it('holds no character inside a row either, between the row and its cells', () => {
		mounted = mountTable(GRID);

		const rows = mounted.el.querySelectorAll(':scope > [data-table-row-idx]');
		expect(rows).toHaveLength(3);
		for (const row of rows) expect(ownTextOf(row).join('')).toBe('');
	});
});

describe('the table lands a caret through the door and at the offset it was asked for', () => {
	it('parks in the corner cell without ending a live cross-block range', () => {
		// Non-vacuity is the pair of assertions: a placement that declined to move the caret
		// would also leave the range alone. Landing through the cell's focus call is the
		// failure: it ends the range, and the next Shift+Arrow extends from a collapsed caret.
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

	// Miss-analysis (GH #111): the row's entry points passed on a literal 0 whatever they were
	// given, and no test addressed a row directly; every case went through the table or a path.
	it('a row-level door forwards the received sentinel, not literal 0', () => {
		mounted = mountTable(GRID);
		const row = mounted.block.getBlockComponentByPath!([2])!;

		row.focus(CURSOR_END);
		expect(mounted.block.getCursorPosition!()).toEqual({ path: [2, 1], offset: 1 });

		row.parkCaret!(CURSOR_START);
		expect(mounted.block.getCursorPosition!()).toEqual({ path: [2, 0], offset: 0 });
	});
});
