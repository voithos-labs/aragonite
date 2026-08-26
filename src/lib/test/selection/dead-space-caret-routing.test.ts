// @vitest-environment jsdom
//
// Which door the dead-space click lands through. The band arithmetic is nearest-block.test.ts
// and the geometry is blocks/table/table-caret-at-point.test.ts; untested between them is the
// routing decision, and whether the range-ending door opens only once a landing is known.
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type { BlockComponent } from '$lib/block-component';
import { CURSOR_END } from '$lib/block-component';
import { registerBuiltInBlocks } from '$lib/components/built-in-blocks';
import { createDeadSpaceCaret } from '$lib/selection/dead-space-caret';
import { makeEmptyGapScope } from '../harness/editor-actions';
import { mountTableGrid } from './table-grid';

registerBuiltInBlocks();
import { augmentBuiltin, tryGetBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';

const TABLE_BOX = { left: 100, right: 400, top: 50, bottom: 90 };

describe('createDeadSpaceCaret routing', () => {
	let root: HTMLElement;
	let component: BlockComponent & { focus: ReturnType<typeof vi.fn> };
	let focusByPath: Mock<(path: number[], offset: number) => void>;
	let resetSelectionForClick: Mock<() => void>;
	let leafSnap: Mock<(x: number, y: number) => void>;
	let ownSnap: Mock<(x: number, y: number) => void>;
	const origFromPoint = document.elementFromPoint;

	beforeEach(() => {
		root = document.createElement('div');
		// One row of two cells tiling the block's box.
		const mounted = mountTableGrid({ path: [0], rows: 1, cols: 2, box: TABLE_BOX });
		document.body.appendChild(root);
		root.appendChild(mounted.host);
		// The click is in the root's own padding; the clamp puts the probe in the box,
		// where the topmost element is the table grid.
		document.elementFromPoint = (() => mounted.grid) as typeof document.elementFromPoint;

		focusByPath = vi.fn(() => {});
		leafSnap = vi.fn(() => {});
		ownSnap = vi.fn(() => {});
		component = {
			editable: true,
			focusable: true,
			focus: vi.fn(),
			getCursorOffset: () => null,
			focusByPath,
			snapCaretToPoint: ownSnap,
			getBlockComponentByPath: () => ({ snapCaretToPoint: leafSnap }) as unknown as BlockComponent
		} as unknown as BlockComponent & { focus: ReturnType<typeof vi.fn> };
		resetSelectionForClick = vi.fn(() => {});
	});

	afterEach(() => {
		document.elementFromPoint = origFromPoint;
		root.remove();
	});

	function clickAt(clientX: number, clientY: number): boolean {
		const caret = createDeadSpaceCaret({
			getBlockComponent: () => component,
			resetSelectionForClick,
			gapScope: makeEmptyGapScope(),
			lastBlockIndex: () => 0,
			revealBlock: async () => component
		});
		const press = { target: root, button: 0 } as unknown as MouseEvent;
		caret.notePress(root, press);
		const click = { target: root, clientX, clientY } as unknown as MouseEvent;
		return caret.handleClick(root, click);
	}

	it('lands a click beside a table in the nearest cell, through the deep door', () => {
		// Left of the box, level with the row → column 0.
		expect(clickAt(20, TABLE_BOX.top + 20)).toBe(true);
		expect(focusByPath).toHaveBeenCalledWith([0, 0], CURSOR_END);
		expect(component.focus).not.toHaveBeenCalled();
		expect(resetSelectionForClick).toHaveBeenCalledOnce();
	});

	it('lands a click below the table in the last row’s trailing cell', () => {
		// Below every band: the clamp aims at the box's trailing corner, so x is the
		// right edge and the answer is the last column.
		expect(clickAt(20, TABLE_BOX.bottom + 200)).toBe(true);
		expect(focusByPath).toHaveBeenCalledWith([0, 1], CURSOR_END);
	});

	it('declines, touching no selection, when the kind names no caret landing', () => {
		// A kind with a drag hit test and nothing to place a caret with: the decline must come BEFORE
		// the range-ending preamble, or a rejected click collapses a selection it never replaced.
		const declared = tryGetBlockKindDescriptor('table')!.caretTargetAtPoint;
		try {
			augmentBuiltin('table', { caretTargetAtPoint: undefined });
			expect(clickAt(20, TABLE_BOX.top + 20)).toBe(false);
			expect(focusByPath).not.toHaveBeenCalled();
			expect(resetSelectionForClick).not.toHaveBeenCalled();
		} finally {
			augmentBuiltin('table', { caretTargetAtPoint: declared });
		}
	});

	it('declines a block that declares the hook but publishes no deep door', () => {
		component = { editable: true, focusable: true, focus: vi.fn() } as unknown as typeof component;
		expect(clickAt(20, TABLE_BOX.top + 20)).toBe(false);
		expect(resetSelectionForClick).not.toHaveBeenCalled();
	});

	it('declines an unfocusable block', () => {
		component = { ...component, focusable: false } as typeof component;
		expect(clickAt(20, TABLE_BOX.top + 20)).toBe(false);
		expect(resetSelectionForClick).not.toHaveBeenCalled();
	});

	// The probe point, not the click point: the surface answers it as it would a click there,
	// and a caret landing at an atomic widget's edge has nothing to show for itself until it
	// does. jsdom resolves no point→offset, so the shallow door's landing is e2e-driven and
	// only the deep one's routing is decidable here.
	describe('click-intent snap', () => {
		it('hands the probe point to the leaf the internal path names', () => {
			clickAt(20, TABLE_BOX.top + 20);
			expect(leafSnap).toHaveBeenCalledWith(TABLE_BOX.left + 1, TABLE_BOX.top + 20);
			// Never the container's own door: the landing addresses the cell, not the grid.
			expect(ownSnap).not.toHaveBeenCalled();
		});

		it('declines a block that publishes no snap door', () => {
			component = { ...component, getBlockComponentByPath: () => null } as typeof component;
			expect(clickAt(20, TABLE_BOX.top + 20)).toBe(true);
			expect(leafSnap).not.toHaveBeenCalled();
		});
	});
});
