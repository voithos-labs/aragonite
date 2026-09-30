// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { resolveSelectionPoint } from '../../selection/selection-restore';
import { createSelectionState } from '../../selection/selection-state.svelte';
import type { EditorSelection } from '../../selection/primitives';
import { parse } from '../../core/parser';
import { asEditorX } from '../../cursor/coordinate-spaces';
import { restoreLandingOver } from '../harness/restore-landing';

const PROSE = 'Alpha one\n\nBravo two\n';
const TABLE_2x2 = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';

/** `mounted: false` makes every element lookup miss, the unplaced-outcome shape. */
function restoreHarness(source: string, { mounted = true } = {}) {
	const doc = parse(source);
	const selectionState = createSelectionState({ getDoc: () => doc });
	const { landing, revealed, caretMemory } = restoreLandingOver(doc, selectionState, { mounted });
	return {
		doc,
		revealed,
		selectionState,
		caretMemory,
		restore: (selection: EditorSelection) => landing.restore(selection)
	};
}

// An e2e cannot catch a missing model clamp: the browser already degrades an over-long DOM offset
// to the container end when the range is built.
describe('resolveSelectionPoint, clamping per coordinate space', () => {
	it('clamps a prose offset to the block raw length', () => {
		const doc = parse(PROSE);
		const point = resolveSelectionPoint(doc, { path: [1], offset: 999 });
		expect(point).toEqual({ path: [1], offset: doc.children[1].raw.length });
	});

	it('clamps a negative offset to the block start', () => {
		expect(resolveSelectionPoint(parse(PROSE), { path: [0], offset: -4 })).toEqual({
			path: [0],
			offset: 0
		});
	});

	it('clamps an unflagged table endpoint in cell space, not against the markdown', () => {
		// 2 rows × 2 columns → indices 0..3, while a raw-length clamp leaves the index outside the grid.
		expect(resolveSelectionPoint(parse(TABLE_2x2), { path: [0], offset: 99 })).toEqual({
			path: [0],
			offset: 3,
			cellCoordinate: true
		});
	});

	it('preserves the cellCoordinate flag through the clamp', () => {
		expect(
			resolveSelectionPoint(parse(TABLE_2x2), { path: [0], offset: 99, cellCoordinate: true })
		).toEqual({ path: [0], offset: 3, cellCoordinate: true });
	});

	it('returns null for a path past the end of the document', () => {
		expect(resolveSelectionPoint(parse(PROSE), { path: [7], offset: 0 })).toBeNull();
	});

	it('returns null for the document root, which holds no caret', () => {
		expect(resolveSelectionPoint(parse(PROSE), { path: [], offset: 0 })).toBeNull();
	});

	it('copies the path so a restored endpoint never aliases the snapshot', () => {
		const snapshotPath = [1];
		const point = resolveSelectionPoint(parse(PROSE), { path: snapshotPath, offset: 0 });
		expect(point!.path).not.toBe(snapshotPath);
	});
});

// Every stored selection put back (undo, a host's setSelection, a mode switch) goes through the
// caret landing's restore, so that is where the caret memory is forgotten.
describe('a restore forgets how the caret arrived', () => {
	function arrived(h: ReturnType<typeof restoreHarness>) {
		h.caretMemory.noteKey({ key: 'ArrowDown' }, null, () => asEditorX(240));
		h.caretMemory.pendingMarks.toggle('strong');
	}

	it('a placed caret drops the column, the side and the marks', async () => {
		const h = restoreHarness(PROSE);
		arrived(h);
		const caret = { path: [1], offset: 0 };
		expect(await h.restore({ anchor: caret, focus: caret })).toBe('applied');
		expect(h.caretMemory.column()).toBeNull();
		expect(h.caretMemory.side()).toBeNull();
		expect(h.caretMemory.pendingMarks.get()).toBeNull();
	});

	it('a declined restore leaves the memory alone, as it leaves everything else', async () => {
		const h = restoreHarness(PROSE);
		arrived(h);
		const dead = { path: [9], offset: 0 };
		expect(await h.restore({ anchor: dead, focus: dead })).toBe('unresolvable');
		expect(h.caretMemory.column()).toBe(240);
	});
});

describe('restoring a stored selection', () => {
	it('declines a path that no longer resolves, revealing nothing', async () => {
		const h = restoreHarness(PROSE);

		const outcome = await h.restore({
			anchor: { path: [9], offset: 0 },
			focus: { path: [9], offset: 0 }
		});

		// The mount scrolls; running it before the resolve check would move the
		// viewport on the way to reporting failure.
		expect(outcome).toBe('unresolvable');
		expect(h.revealed).toEqual([]);
		expect(h.selectionState.isCrossBlock).toBe(false);
	});

	it('declines when only the anchor is stale', async () => {
		const h = restoreHarness(PROSE);

		const outcome = await h.restore({
			anchor: { path: [9], offset: 0 },
			focus: { path: [0], offset: 0 }
		});

		expect(outcome).toBe('unresolvable');
		expect(h.revealed).toEqual([]);
	});

	// The undo swap clears on `unresolvable` and must not clear on `unplaced`, where the overlay
	// route has already stored the correct endpoints.
	it('reports unplaced (not unresolvable) when a resolvable target is unmounted', async () => {
		const h = restoreHarness(PROSE, { mounted: false });

		const outcome = await h.restore({
			anchor: { path: [0], offset: 1 },
			focus: { path: [1], offset: 2 }
		});

		expect(outcome).toBe('unplaced');
		expect(h.revealed).toEqual([[1]]);
		expect(h.selectionState.isCrossBlock).toBe(true);
	});

	it('reveals the focus block for a prose caret', async () => {
		const h = restoreHarness(PROSE);

		const caret = { path: [1], offset: 2 };
		expect(await h.restore({ anchor: caret, focus: caret })).toBe('applied');
		expect(h.revealed).toEqual([[1]]);
	});

	it('reveals the deep cell it puts the caret in, not the table block', async () => {
		const h = restoreHarness(TABLE_2x2);

		// Cell index 3 in a 2-column table is row 1, col 1. Table rows are windowed, so mounting
		// [0] alone would leave that row unmounted.
		await h.restore({
			anchor: { path: [0], offset: 0, cellCoordinate: true },
			focus: { path: [0], offset: 3 }
		});

		expect(h.revealed.at(-1)).toEqual([0, 1, 1]);
	});

	it('clamps before revealing, so an out-of-grid cell index still resolves a cell', async () => {
		const h = restoreHarness(TABLE_2x2);

		await h.restore({
			anchor: { path: [0], offset: 0, cellCoordinate: true },
			focus: { path: [0], offset: 99 }
		});

		expect(h.revealed.at(-1)).toEqual([0, 1, 1]);
	});

	// Miss-analysis: every collapsed restore named a leaf, so a list's own path mounted the list
	// and focused its wrapper, where typing goes nowhere.
	it('descends a caret on a container path into its first leaf', async () => {
		const h = restoreHarness('- a\n- b\n');

		const onList = { path: [0], offset: 0 };
		expect(await h.restore({ anchor: onList, focus: onList })).toBe('applied');
		expect(h.revealed.at(-1)).toEqual([0, 0, 0]);
	});

	// Miss-analysis: no restore test held a block with no text, so a same-path pair over a rule
	// went down the text-range route and put nothing back.
	it('puts a rule held whole back as held whole', async () => {
		const h = restoreHarness('above\n\n---\n\nbelow\n');

		await h.restore({ anchor: { path: [1], offset: 0 }, focus: { path: [1], offset: 3 } });

		expect(h.selectionState.wholeUnitPath).toEqual([1]);
		expect(h.selectionState.isCrossBlock).toBe(true);
	});
});
