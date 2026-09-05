// @vitest-environment jsdom
//
// A cell drag that leaves the table and lands off every block — the margin, a side gutter — which
// is what one coalesced frame hands over when the pointer is moving fast. Miss-analysis: no test
// drove a MOVE through `installCellDragListener` at all (its suite covers shift+click and the grid
// selectors), so the foreign-block extend carried the cross-block drag's off-block miss unpinned.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	installCellDragListener,
	type CellAnchor
} from '$lib/components/blocks/table/cell-pointer';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { mountTableGrid } from '../../selection/table-grid';

const PARA_BOX = { left: 100, right: 300, top: 0, bottom: 40 };
const TABLE_BOX = { left: 100, right: 300, top: 50, bottom: 100 };

describe('a cell drag that leaves the table for dead space', () => {
	let editorRoot: HTMLElement;
	let para: HTMLElement;
	let anchor: CellAnchor;
	let selection: ReturnType<typeof createSelectionState>;
	let frame: { run(): void };
	const origFromPoint = document.elementFromPoint;
	const origRaf = globalThis.requestAnimationFrame;
	const origCancel = globalThis.cancelAnimationFrame;

	beforeEach(() => {
		editorRoot = document.createElement('div');
		document.body.appendChild(editorRoot);
		para = document.createElement('div');
		para.setAttribute('data-block-path', '[0]');
		para.getBoundingClientRect = () => PARA_BOX as DOMRect;
		editorRoot.appendChild(para);

		const { host, grid } = mountTableGrid({ path: [1], rows: 1, cols: 2, box: TABLE_BOX });
		// Far larger than every point below, so no edge band arms the autoscroll loop.
		grid.getBoundingClientRect = () =>
			({ left: -1000, top: -1000, right: 2000, bottom: 2000 }) as DOMRect;
		editorRoot.appendChild(host);

		document.elementFromPoint = ((x: number, y: number) =>
			x >= PARA_BOX.left && x <= PARA_BOX.right && y >= PARA_BOX.top && y <= PARA_BOX.bottom
				? para
				: null) as typeof document.elementFromPoint;

		anchor = { tableEl: grid, tablePath: [1], rowIdx: 0, colIdx: 0, columnCount: 2 };
		selection = createSelectionState();
		frame = stubFrame();
		installCellDragListener({ editorRoot, selection }, anchor, pointerDown());
	});

	afterEach(() => {
		document.elementFromPoint = origFromPoint;
		globalThis.requestAnimationFrame = origRaf;
		globalThis.cancelAnimationFrame = origCancel;
		editorRoot.remove();
	});

	it('extends to the block beside a point in the gutter', () => {
		document.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 20 }));
		frame.run();

		expect(selection.isCrossBlock).toBe(true);
		expect(selection.focus).toEqual({ path: [0], offset: 0 });
	});
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function pointerDown(): PointerEvent {
	return new MouseEvent('pointerdown', {
		clientX: TABLE_BOX.left + 10,
		clientY: TABLE_BOX.top + 10
	}) as unknown as PointerEvent;
}

/** One armed callback at a time, mirroring the coalescer's single pending frame. */
function stubFrame(): { run(): void } {
	let armed: FrameRequestCallback | null = null;
	globalThis.requestAnimationFrame = ((fn: FrameRequestCallback) => {
		armed = fn;
		return 1;
	}) as typeof requestAnimationFrame;
	globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
	return {
		run() {
			const fn = armed;
			armed = null;
			fn?.(0);
		}
	};
}
