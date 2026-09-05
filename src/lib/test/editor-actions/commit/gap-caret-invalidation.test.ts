// What a structural commit does to a live gap caret. The gap addresses a BOUNDARY INDEX, so a
// commit that inserts or removes a sibling ahead of it silently re-points it at a different
// boundary. Miss (Sel-F4): every gap test drives the gap's OWN gestures, where the mint's landing
// ends the gap anyway; a mutation arriving from elsewhere (search replace-all, a host edit, a
// plugin) has no test at all, so nothing observed the gap surviving one.
import { describe, it, expect } from 'vitest';
import { isGapSelection } from '$lib/undo/types';
import { makeTopHarness } from '$lib/test/harness/editor-actions';

const TABLE = '| a | b |\n| - | - |\n| c | d |\n';
const FENCE = '```\ncode\n```\n';
/** paragraph, table, fencedCode, paragraph — the eligible boundary is 2. */
const TABLE_THEN_FENCE = `para\n\n${TABLE}\n${FENCE}\ntail\n`;
const GAP = { parentPath: [], index: 2 };

function makeTop(source: string) {
	const harness = makeTopHarness(source);
	return { ...harness, selection: harness.deps.selectionState };
}

describe('a structural commit invalidates the gap caret it edits under', () => {
	it('ends a gap when a block is inserted ahead of its boundary', async () => {
		const h = makeTop(TABLE_THEN_FENCE);
		h.selection.setGapCaret(GAP);

		await h.actions.insertParagraph(0, 'x');

		// Index 2 now names the boundary before the FENCE's predecessor — one slot off, with the
		// caret still painted at it and Enter minting at the wrong seam.
		expect(h.selection.gapCaret).toBeNull();
	});

	it('ends a gap when a block is removed ahead of it', async () => {
		const h = makeTop(TABLE_THEN_FENCE);
		h.selection.setGapCaret(GAP);

		await h.actions.deleteBlock(0);

		expect(h.selection.gapCaret).toBeNull();
	});

	// Ordering: the undo entry is pushed inside the same ceremony, and its three-tier selection
	// read takes the gap when no block reports a caret. Invalidating too early loses it there.
	it('leaves the gap in the undo entry the same commit pushed', async () => {
		const h = makeTop(TABLE_THEN_FENCE);
		h.selection.setGapCaret(GAP);

		await h.actions.insertParagraph(0, 'x');

		const entry = h.deps.undoManager.getStacks().undo.at(-1)!;
		expect(isGapSelection(entry.selection)).toBe(true);
		expect(entry.selection).toEqual({ gapCaret: GAP });
	});
});
