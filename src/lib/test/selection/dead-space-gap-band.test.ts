// @vitest-environment jsdom
//
// A dead-space `y` that falls BETWEEN two root bands. Real root blocks tile flush, so this
// branch only opens under a host that pads `.block-host`: consumer-conditional geometry no
// browser suite reaches, and the band rects are synthetic for exactly that reason.
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type { BlockComponent } from '$lib/block-component';
import { registerBuiltInBlocks } from '$lib/components/built-in-blocks';
import { createDeadSpaceCaret } from '$lib/selection/dead-space-caret';
import type { GapStopScope } from '$lib/selection/gap-caret';
import { makeGapScope } from '../harness/editor-actions';

registerBuiltInBlocks();

const TABLE_ROW = '| a | b |\n| - | - |\n';
/** table, table: both declare the facing edges, so boundary 1 is eligible. */
const ELIGIBLE_DOC = `${TABLE_ROW}\n${TABLE_ROW}`;
/** paragraph, paragraph: neither declares an edge. */
const INELIGIBLE_DOC = 'alpha\n\nbeta\n';

const BAND_0 = { left: 100, right: 400, top: 50, bottom: 90 };
const BAND_1 = { left: 100, right: 400, top: 120, bottom: 160 };
/** Strictly between the two bands, and nearer band 0, so a fall-through has a landing. */
const BETWEEN_Y = 100;

describe('a dead-space y between two root bands', () => {
	let root: HTMLElement;
	let component: BlockComponent;
	let focusByPath: Mock<(path: number[], offset: number) => void>;
	/** The live gap at the moment the preamble ran, which must still be none. */
	let gapWhenReset: unknown;
	const origFromPoint = document.elementFromPoint;

	function addBand(index: number, box: typeof BAND_0): HTMLElement {
		const wrapper = document.createElement('div');
		wrapper.setAttribute('data-block-path', `[${index}]`);
		wrapper.setAttribute('data-block-kind', 'table');
		wrapper.getBoundingClientRect = () => box as DOMRect;
		const grid = document.createElement('div');
		grid.setAttribute('role', 'table');
		const row = document.createElement('div');
		row.setAttribute('data-table-row-idx', '0');
		const cell = document.createElement('div');
		cell.setAttribute('role', 'cell');
		cell.getBoundingClientRect = () => box as DOMRect;
		row.appendChild(cell);
		grid.appendChild(row);
		wrapper.appendChild(grid);
		root.appendChild(wrapper);
		return grid;
	}

	beforeEach(() => {
		root = document.createElement('div');
		document.body.appendChild(root);
		const firstGrid = addBand(0, BAND_0);
		addBand(1, BAND_1);
		// The clamp aims the probe into the nearest band's box, where the grid is topmost.
		document.elementFromPoint = (() => firstGrid) as typeof document.elementFromPoint;

		focusByPath = vi.fn(() => {});
		component = {
			editable: true,
			focusable: true,
			focus: vi.fn(),
			getCursorOffset: () => null,
			focusByPath
		} as unknown as BlockComponent;
	});

	afterEach(() => {
		document.elementFromPoint = origFromPoint;
		root.remove();
	});

	function clickBetweenBands(gapScope: GapStopScope): boolean {
		gapWhenReset = 'never ran';
		const caret = createDeadSpaceCaret({
			getBlockComponent: () => component,
			resetSelectionForClick: () => {
				gapWhenReset = gapScope.selection.gapCaret;
			},
			gapScope,
			lastBlockIndex: () => 1,
			revealBlock: async () => component
		});
		const press = { target: root, button: 0 } as unknown as MouseEvent;
		caret.notePress(root, press);
		const click = { target: root, clientX: 20, clientY: BETWEEN_Y } as unknown as MouseEvent;
		return caret.handleClick(root, click);
	}

	it('parks the caret at the boundary the two bands name', () => {
		const gapScope = makeGapScope(ELIGIBLE_DOC);

		expect(clickBetweenBands(gapScope)).toBe(true);
		expect(gapScope.selection.gapCaret).toEqual({ parentPath: [], index: 1 });
		// The preamble clears the gap, so a door that opened first would be wiped by it.
		expect(gapWhenReset).toBeNull();
		expect(focusByPath).not.toHaveBeenCalled();
	});

	it('falls through to the nearest band when neither neighbour declares the edge', () => {
		const gapScope = makeGapScope(INELIGIBLE_DOC);

		// No dead-space click is left unanswered: the ineligible boundary keeps the clamp.
		expect(clickBetweenBands(gapScope)).toBe(true);
		expect(gapScope.selection.gapCaret).toBeNull();
		expect(focusByPath).toHaveBeenCalled();
	});
});
