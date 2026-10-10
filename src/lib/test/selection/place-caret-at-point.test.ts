// @vitest-environment jsdom
// The placement behind the public `placeCaretAtPoint`: no click was recorded and no target
// inspected, so this suite covers the clamp, where the caret goes, and the range-ending reset.
// The click checks in front of it are `dead-space-caret-routing.test.ts`.
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type { BlockComponent } from '#lib/block-component.js';
import { CURSOR_END } from '#lib/block-component.js';
import { registerBuiltInBlocks } from '#lib/components/built-in-blocks.js';
import { createDeadSpaceCaret, type DeadSpaceCaretDeps } from '#lib/selection/dead-space-caret.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { createCaretMemory } from '#lib/caret/caret-memory.js';
import { makeEmptyGapScope } from '../harness/editor-actions';
import { resetForPointerDown } from '#lib/selection/cross-block/pointer.js';
import { mountTableGrid } from './table-grid';

registerBuiltInBlocks();
import { augmentBuiltin, tryGetBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';

// Two 150-wide cells in one row; the block's box is the margin band's reference.
const TABLE_BOX = { left: 100, right: 400, top: 50, bottom: 90 };

describe('placeCaretAtPoint landing walk', () => {
	let root: HTMLElement;
	let component: BlockComponent;
	let focusByPath: Mock<(path: number[], offset: number) => void>;
	let leafSnap: Mock<(x: number, y: number) => void>;
	// The cell a path inside the table names.
	let leaf: BlockComponent;
	let resetSelectionForClick: Mock<() => void>;
	const origFromPoint = document.elementFromPoint;

	beforeEach(() => {
		root = document.createElement('div');
		const { host, grid } = mountTableGrid({ path: [0], rows: 1, cols: 2, box: TABLE_BOX });
		document.body.appendChild(root);
		root.appendChild(host);
		// The point is clamped into the box, where the topmost element is the grid.
		document.elementFromPoint = (() => grid) as typeof document.elementFromPoint;

		focusByPath = vi.fn(() => {});
		leafSnap = vi.fn(() => {});
		component = {
			editable: true,
			focusable: true,
			focus: vi.fn(),
			getCursorOffset: () => null,
			focusByPath
		} as unknown as BlockComponent;
		leaf = { snapCaretToPoint: leafSnap } as unknown as BlockComponent;
		resetSelectionForClick = vi.fn(() => {});
	});

	afterEach(() => {
		document.elementFromPoint = origFromPoint;
		root.remove();
	});

	// One block is mounted, at index 0, so the default deps put the document's end inside the
	// mounted range, where every case below but the windowed-out tail belongs.
	function makeCaret(
		overrides: Partial<DeadSpaceCaretDeps> = {},
		reset: () => void = resetSelectionForClick
	) {
		return createDeadSpaceCaret({
			getBlockComponent: (path) => (path.length > 1 ? leaf : component),
			resetSelectionForClick: reset,
			gapScope: makeEmptyGapScope(),
			lastBlockIndex: () => 0,
			land: async () => 'placed',
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

	// A margin point reaches an editable element only once clamped into the block's box, and the
	// element gets that clamped point. Both axes, since the margin band runs beside and above.
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

	// Miss-analysis: the below-document case only ran fully mounted, where last band = last block.
	it('resolves a point below a windowed-out tail against the document, not the slice', async () => {
		const land = vi.fn(async () => 'placed' as const);
		const caret = makeCaret({ lastBlockIndex: () => 9, land });

		expect(caret.placeAtPoint(root, 20, TABLE_BOX.bottom + 2000)).toBe(true);

		await vi.waitFor(() =>
			expect(land).toHaveBeenCalledWith({ path: [9], offset: CURSOR_END, fresh: true })
		);
		// The rendered slice's own last block is never touched; a caret there is the defect.
		expect(focusByPath).not.toHaveBeenCalled();
	});

	// Miss-analysis: the click's reset ran after the tail's caret was placed, and forgot the side
	// the end landing had just recorded; no test read the order.
	it('resets the selection before the tail landing, so the side the landing records survives', async () => {
		const order: string[] = [];
		const land = vi.fn(async () => (order.push('land'), 'placed' as const));
		const caret = makeCaret({ lastBlockIndex: () => 9, land }, () => order.push('reset'));

		caret.placeAtPoint(root, 20, TABLE_BOX.bottom + 2000);

		await vi.waitFor(() => expect(order).toEqual(['reset', 'land']));
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

	// ── The range-ending reset (G2.12) ───────────────────────────────────────

	describe('a live cross-block range', () => {
		let selection: ReturnType<typeof createSelectionState>;
		let endRange: () => void;

		beforeEach(() => {
			selection = createSelectionState();
			const caretMemory = createCaretMemory();
			// The real reset, not a spy: what this case asserts is the selection's fate, and a spy
			// would pass on a call that ends nothing.
			endRange = () => resetForPointerDown(selection, testCaretWriter, caretMemory, false);
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
