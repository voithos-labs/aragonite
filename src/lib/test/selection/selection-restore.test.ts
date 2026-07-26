// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { resolveSelectionPoint, restoreSelection } from '../../selection/selection-restore';
import { createSelectionState } from '../../selection/selection-state.svelte';
import { parse } from '../../core/parser';

const PROSE = 'Alpha one\n\nBravo two\n';
const TABLE_2x2 = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';

/** `mounted: false` makes every element lookup miss, the unplaced-outcome shape. */
function restoreHarness(source: string, { mounted = true } = {}) {
	const doc = parse(source);
	const revealed: number[][] = [];
	const selectionState = createSelectionState({ getDoc: () => doc });
	return {
		doc,
		revealed,
		selectionState,
		deps: {
			getDoc: () => doc,
			selectionState,
			getBlockElByPath: () => (mounted ? document.createElement('div') : null),
			revealTarget: async (path: number[]): Promise<boolean> => {
				revealed.push(path);
				return mounted;
			}
		}
	};
}

// The e2e cannot discriminate this: an over-long DOM offset already degrades to
// the container end when the range is built, so the browser hides a missing model
// clamp. These are the tests that fail when the clamp goes.
describe('resolveSelectionPoint — clamping per coordinate space', () => {
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

	it('clamps an UNFLAGGED intra-table endpoint in cell space, not against the markdown', () => {
		// The case the kind-based discriminant exists for: no flag, yet the offset is
		// a cell index. 2 rows × 2 columns → indices 0..3, while the table's raw is
		// far longer, so a raw-length clamp would leave the index outside the grid.
		expect(resolveSelectionPoint(parse(TABLE_2x2), { path: [0], offset: 99 })).toEqual({
			path: [0],
			offset: 3
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

describe('restoreSelection', () => {
	it('declines a path that no longer resolves, revealing nothing', async () => {
		const h = restoreHarness(PROSE);

		const outcome = await restoreSelection(
			{ anchor: { path: [9], offset: 0 }, focus: { path: [9], offset: 0 } },
			h.deps
		);

		// The reveal scrolls; running it before the resolve check would move the
		// viewport on the way to reporting failure.
		expect(outcome).toBe('unresolvable');
		expect(h.revealed).toEqual([]);
		expect(h.selectionState.isCrossBlock).toBe(false);
	});

	it('declines when only the anchor is stale', async () => {
		const h = restoreHarness(PROSE);

		const outcome = await restoreSelection(
			{ anchor: { path: [9], offset: 0 }, focus: { path: [0], offset: 0 } },
			h.deps
		);

		expect(outcome).toBe('unresolvable');
		expect(h.revealed).toEqual([]);
	});

	// The undo swap clears on `unresolvable` and must NOT clear on `unplaced`,
	// where the custom route has already stored the correct endpoints.
	it('reports unplaced — not unresolvable — when a resolvable target is unmounted', async () => {
		const h = restoreHarness(PROSE, { mounted: false });

		const outcome = await restoreSelection(
			{ anchor: { path: [0], offset: 1 }, focus: { path: [1], offset: 2 } },
			h.deps
		);

		expect(outcome).toBe('unplaced');
		expect(h.revealed).toEqual([[1]]);
		expect(h.selectionState.isCrossBlock).toBe(true);
	});

	it('reveals the focus block for a prose caret', async () => {
		const h = restoreHarness(PROSE);

		expect(
			await restoreSelection(
				{ anchor: { path: [1], offset: 2 }, focus: { path: [1], offset: 2 } },
				h.deps
			)
		).toBe('applied');
		expect(h.revealed).toEqual([[1]]);
	});

	it('reveals the deep cell it parks in, not the table block', async () => {
		const h = restoreHarness(TABLE_2x2);

		// Cell index 3 in a 2-column table is row 1, col 1. Table rows window, so
		// revealing [0] alone would leave that row unmounted.
		await restoreSelection(
			{ anchor: { path: [0], offset: 0, cellCoordinate: true }, focus: { path: [0], offset: 3 } },
			h.deps
		);

		expect(h.revealed).toEqual([[0, 1, 1]]);
	});

	it('clamps before revealing, so an out-of-grid cell index still resolves a cell', async () => {
		const h = restoreHarness(TABLE_2x2);

		await restoreSelection(
			{ anchor: { path: [0], offset: 0, cellCoordinate: true }, focus: { path: [0], offset: 99 } },
			h.deps
		);

		expect(h.revealed).toEqual([[0, 1, 1]]);
	});
});
