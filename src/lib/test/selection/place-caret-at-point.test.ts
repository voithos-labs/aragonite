// @vitest-environment jsdom
//
// The landing walk behind the public `placeCaretAtPoint`: no press was noted and no target was
// inspected, so what is decidable here is the clamp, the landing, and the range-ending preamble.
// The gesture guards in front of it are `dead-space-caret-routing.test.ts`.
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type { BlockComponent } from '$lib/block-component';
import { CURSOR_END } from '$lib/block-component';
import { registerBuiltInBlocks } from '$lib/components/built-in-blocks';
import { createDeadSpaceCaret, type DeadSpaceCaretDeps } from '$lib/selection/dead-space-caret';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { createStickyColumnState } from '$lib/cursor/sticky-column';
import { makeEmptyGapScope } from '../harness/editor-actions';
import { resetForPointerDown } from '$lib/selection/cross-block/pointer';
import { makeEdgeAffinity } from '../harness/editor-actions';
import { mountTableGrid } from './table-grid';

registerBuiltInBlocks();
import { augmentBuiltin, tryGetBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';

// Two 150-wide cells in one row; the block's box is the margin band's reference.
const TABLE_BOX = { left: 100, right: 400, top: 50, bottom: 90 };

describe('placeCaretAtPoint landing walk', () => {
	let root: HTMLElement;
	let component: BlockComponent;
	let focusByPath: Mock<(path: number[], offset: number) => void>;
	let leafSnap: Mock<(x: number, y: number) => void>;
	let resetSelectionForClick: Mock<() => void>;
	const origFromPoint = document.elementFromPoint;

	beforeEach(() => {
		root = document.createElement('div');
		const { host, grid } = mountTableGrid({ path: [0], rows: 1, cols: 2, box: TABLE_BOX });
		document.body.appendChild(root);
		root.appendChild(host);
		// The probe point is clamped into the box, where the topmost element is the grid.
		document.elementFromPoint = (() => grid) as typeof document.elementFromPoint;

		focusByPath = vi.fn(() => {});
		leafSnap = vi.fn(() => {});
		component = {
			editable: true,
			focusable: true,
			focus: vi.fn(),
			getCursorOffset: () => null,
			focusByPath,
			getBlockComponentByPath: () => ({ snapCaretToPoint: leafSnap }) as unknown as BlockComponent
		} as unknown as BlockComponent;
		resetSelectionForClick = vi.fn(() => {});
	});

	afterEach(() => {
		document.elementFromPoint = origFromPoint;
		root.remove();
	});

	// One block is mounted, at index 0, so the default deps put the document's end inside the
	// rendered slice — where every arm below but the windowed-tail one belongs.
	function makeCaret(
		overrides: Partial<DeadSpaceCaretDeps> = {},
		reset: () => void = resetSelectionForClick
	) {
		return createDeadSpaceCaret({
			getBlockComponent: () => component,
			resetSelectionForClick: reset,
			gapScope: makeEmptyGapScope(),
			lastBlockIndex: () => 0,
			revealBlock: async () => component,
			...overrides
		});
	}

	function placeAt(x: number, y: number, reset: () => void = resetSelectionForClick): boolean {
		return makeCaret({}, reset).placeAtPoint(root, x, y);
	}

	it('lands the caret in the cell the point names', () => {
		expect(placeAt(TABLE_BOX.left + 200, TABLE_BOX.top + 20)).toBe(true);
		expect(focusByPath).toHaveBeenCalledWith([0, 1], CURSOR_END);
		expect(resetSelectionForClick).toHaveBeenCalledOnce();
	});

	// A point OUTSIDE the block's box reaches a surface at all only because it is clamped into
	// the box first, and the surface is handed the CLAMPED point — the one a click inside the
	// box would have produced. Both axes, since the margin band runs beside and above the text.
	it('clamps a point in the margin band into the block’s own box', () => {
		expect(placeAt(20, TABLE_BOX.top + 20)).toBe(true);
		expect(leafSnap).toHaveBeenLastCalledWith(TABLE_BOX.left + 1, TABLE_BOX.top + 20);
		expect(focusByPath).toHaveBeenLastCalledWith([0, 0], CURSOR_END);

		expect(placeAt(TABLE_BOX.right + 500, TABLE_BOX.top + 20)).toBe(true);
		expect(leafSnap).toHaveBeenLastCalledWith(TABLE_BOX.right - 1, TABLE_BOX.top + 20);
		expect(focusByPath).toHaveBeenLastCalledWith([0, 1], CURSOR_END);

		expect(placeAt(TABLE_BOX.left + 100, TABLE_BOX.top - 30)).toBe(true);
		expect(leafSnap).toHaveBeenLastCalledWith(TABLE_BOX.left + 100, TABLE_BOX.top + 1);
	});

	it('aims a point below the document at the last block’s trailing corner', () => {
		expect(placeAt(20, TABLE_BOX.bottom + 2000)).toBe(true);
		expect(focusByPath).toHaveBeenCalledWith([0, 1], CURSOR_END);
	});

	// Miss-analysis: the below-document arm above only ever ran with the whole document
	// mounted, so "last mounted band" and "last block" were the same index and no test could
	// tell which one the walk read.
	it('resolves a point below a windowed-out tail against the document, not the slice', async () => {
		const tail = { editable: true, focusable: true, focus: vi.fn() } as unknown as BlockComponent;
		const revealBlock = vi.fn(async () => tail);
		const caret = makeCaret({ lastBlockIndex: () => 9, revealBlock });

		expect(caret.placeAtPoint(root, 20, TABLE_BOX.bottom + 2000)).toBe(true);

		await vi.waitFor(() => expect(tail.focus).toHaveBeenCalledWith(CURSOR_END));
		expect(revealBlock).toHaveBeenCalledWith(9);
		// The rendered slice's own last block is never touched — that landing is the defect.
		expect(focusByPath).not.toHaveBeenCalled();
	});

	it('leaves the selection alone while a reveal that resolves nothing focusable is in flight', async () => {
		const caret = makeCaret({ lastBlockIndex: () => 9, revealBlock: async () => null });
		expect(caret.placeAtPoint(root, 20, TABLE_BOX.bottom + 2000)).toBe(true);
		await Promise.resolve();
		expect(resetSelectionForClick).not.toHaveBeenCalled();
	});

	it('returns false when the point resolves nothing focusable', () => {
		component = { ...component, focusable: false } as BlockComponent;
		expect(placeAt(TABLE_BOX.left + 20, TABLE_BOX.top + 20)).toBe(false);
		expect(focusByPath).not.toHaveBeenCalled();
	});

	it('returns false when the root has no mounted block to resolve against', () => {
		root.replaceChildren();
		expect(placeAt(TABLE_BOX.left + 20, TABLE_BOX.top + 20)).toBe(false);
	});

	// ── The range-ending preamble (G2.12) ────────────────────────────────────

	describe('a live cross-block range', () => {
		let selection: ReturnType<typeof createSelectionState>;
		let endRange: () => void;

		beforeEach(() => {
			selection = createSelectionState();
			const stickyColumn = createStickyColumnState();
			// The real preamble, not a spy: what this arm asserts is the SELECTION's fate, and a
			// spy would pass on a call that ends nothing.
			endRange = () => resetForPointerDown(selection, stickyColumn, makeEdgeAffinity(), false);
			selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [2], offset: 4 });
		});

		it('ends when the point lands a caret', () => {
			expect(placeAt(TABLE_BOX.left + 20, TABLE_BOX.top + 20, endRange)).toBe(true);
			expect(selection.isCrossBlock).toBe(false);
			expect(selection.anchor).toBeNull();
		});

		// A public method is not an extend, so it must not leave a range painted over a caret it
		// placed elsewhere — nor collapse one when it placed no caret at all.
		it('survives a declined point untouched', () => {
			const declared = tryGetBlockKindDescriptor('table')!.caretTargetAtPoint;
			try {
				augmentBuiltin('table', { caretTargetAtPoint: undefined });
				expect(placeAt(TABLE_BOX.left + 20, TABLE_BOX.top + 20, endRange)).toBe(false);
				expect(selection.isCrossBlock).toBe(true);
			} finally {
				augmentBuiltin('table', { caretTargetAtPoint: declared });
			}
		});
	});
});
