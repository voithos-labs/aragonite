// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { parse } from '../../core/parser';
import { createSelectionState } from '../../selection/selection-state.svelte';
import { collapseCrossBlock } from '../../selection/keyboard-extend';
import { restoreLandingOver } from '../harness/restore-landing';
import { registerDetailsKind } from '../../plugins/details/details-kind';

// [0] 2-column table (header + 2 body rows = 6 cells), [1] paragraph.
const doc = parse('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\ntail\n');

function harness() {
	const selection = createSelectionState({ getDoc: () => doc });
	// Mounted with text, so the caret's DOM range resolves and its offset is readable.
	const getBlockElByPath = vi.fn((): HTMLElement | null => {
		const el = document.createElement('div');
		el.append(document.createTextNode('abcdef'));
		document.body.append(el);
		return el;
	});
	const { landing, revealed } = restoreLandingOver(doc, selection, { getBlockElByPath });
	return { selection, revealed, getBlockElByPath, restore: landing.restore };
}

function caretOffset(): number {
	return window.getSelection()?.anchorOffset ?? -1;
}

// Either corner of a table rectangle is a cell index, so collapsing to it resolves that cell, not
// a character offset; the focus goes in bare, so the state must flag it on the way in.
describe('collapseCrossBlock over an intra-table rectangle', () => {
	it('resolves the deep cell path when the collapse target is the focus', async () => {
		const { selection, revealed, getBlockElByPath, restore } = harness();
		selection.enterCrossBlock(
			{ path: [0], offset: 0, cellCoordinate: true },
			{ path: [0], offset: 4 }
		);

		await collapseCrossBlock(selection, 'end', doc, restore);

		// Cell 4 of a 2-column table = row 2, col 0.
		expect(revealed.at(-1)).toEqual([0, 2, 0]);
		expect(getBlockElByPath).toHaveBeenCalledWith([0, 2, 0]);
		// The cell's own edge, set natively; the cell's `focus` would skip the collapse steps.
		expect(caretOffset()).toBeGreaterThan(0);
	});

	it('resolves the deep cell path for a backward rectangle collapsed to start', async () => {
		const { selection, revealed, getBlockElByPath, restore } = harness();
		selection.enterCrossBlock(
			{ path: [0], offset: 5, cellCoordinate: true },
			{ path: [0], offset: 2 }
		);

		await collapseCrossBlock(selection, 'start', doc, restore);

		expect(revealed.at(-1)).toEqual([0, 1, 0]);
		expect(getBlockElByPath).toHaveBeenCalledWith([0, 1, 0]);
		expect(caretOffset()).toBe(0);
	});

	it('leaves a prose endpoint on its own path', async () => {
		const { selection, revealed, restore } = harness();
		selection.enterCrossBlock(
			{ path: [0], offset: 0, cellCoordinate: true },
			{ path: [1], offset: 2 }
		);

		await collapseCrossBlock(selection, 'end', doc, restore);

		expect(revealed.at(-1)).toEqual([1]);
	});
});

// Miss-analysis: every collapse here landed in a mounted open block, so the reveal that opened a
// closed details to reach a hidden endpoint never ran.
describe('collapseCrossBlock past a closed details', () => {
	it('lands on the title row and mounts nothing inside the hidden body', async () => {
		registerDetailsKind();
		const closed = parse('Above\n\n<details>\n<summary>Sum</summary>\n\nHidden\n\n</details>\n');
		const selection = createSelectionState({ getDoc: () => closed });
		const { landing, revealed } = restoreLandingOver(closed, selection);
		selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1, 1], offset: 6 });

		await collapseCrossBlock(selection, 'end', closed, landing.restore);

		expect(revealed.at(-1)).toEqual([1, 0]);
		expect(revealed).not.toContainEqual([1, 1]);
	});
});
