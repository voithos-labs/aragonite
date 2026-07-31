// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { parse } from '../../core/parser';
import { createSelectionState } from '../../selection/selection-state.svelte';
import { collapseCrossBlock } from '../../selection/keyboard-extend';
import type { BlockComponent } from '../../block-component';
import { CURSOR_END } from '../../block-component';

// [0] 2-column table (header + 2 body rows = 6 cells), [1] paragraph.
const doc = parse('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\ntail\n');

function harness() {
	const selection = createSelectionState({ getDoc: () => doc });
	const cellRef = { focus: vi.fn() } as unknown as BlockComponent;
	const revealPath = vi.fn(async () => cellRef);
	const getBlockElByPath = vi.fn(() => document.createElement('div'));
	return { selection, cellRef, revealPath, getBlockElByPath };
}

// An intra-table rectangle carries a FLAGGED anchor and an UNFLAGGED focus (cross-block/keydown.ts
// extends by the same-path convention), so either collapse target's offset is a cell index and
// must resolve to that cell, not to a character offset into the table's rendered text.
describe('collapseCrossBlock over an intra-table rectangle', () => {
	it('resolves the deep cell path when the collapse target is the unflagged focus', async () => {
		const { selection, cellRef, revealPath, getBlockElByPath } = harness();
		selection.enterCrossBlock(
			{ path: [0], offset: 0, cellCoordinate: true },
			{ path: [0], offset: 4 }
		);

		await collapseCrossBlock(selection, 'end', doc, getBlockElByPath, revealPath);

		// Cell 4 of a 2-column table = row 2, col 0.
		expect(revealPath).toHaveBeenCalledWith([0, 2, 0]);
		expect(cellRef.focus).toHaveBeenCalledWith(CURSOR_END);
	});

	it('resolves the deep cell path for a backward rectangle collapsed to start', async () => {
		const { selection, cellRef, revealPath, getBlockElByPath } = harness();
		selection.enterCrossBlock(
			{ path: [0], offset: 5, cellCoordinate: true },
			{ path: [0], offset: 2 }
		);

		await collapseCrossBlock(selection, 'start', doc, getBlockElByPath, revealPath);

		expect(revealPath).toHaveBeenCalledWith([0, 1, 0]);
		expect(cellRef.focus).toHaveBeenCalledWith(0);
	});

	it('leaves a prose endpoint on its own path', async () => {
		const { selection, revealPath, getBlockElByPath } = harness();
		selection.enterCrossBlock(
			{ path: [0], offset: 0, cellCoordinate: true },
			{ path: [1], offset: 2 }
		);

		await collapseCrossBlock(selection, 'end', doc, getBlockElByPath, revealPath);

		expect(revealPath).toHaveBeenCalledWith([1]);
	});
});
