// @vitest-environment jsdom
//
// The 3-stage Ctrl+A inside a cell (cell text → whole table → whole document)
// counts presses on the shared SelectionState. The counter's only keydown reset
// lives in the shared prelude, which the cell reaches on its 'native' plan arm
// alone — so every key the cell claims used to leave the stage counter armed.
// A second Ctrl+A after a Tab then jumped straight to the whole-table stage, and
// the count leaked out of the table entirely on an arrow exit.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import TableCellBlock from '$lib/components/blocks/table/TableCellBlock.svelte';
import type { CstNode } from '$lib/core/nodes';
import type { EditorServices } from '$lib/editor-keys';
import { TABLE_CONTEXT_KEY } from '$lib/editor-keys';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { createWidgetSelectionState } from '$lib/components/image/widget-selection-state.svelte';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext } from '../../harness/mount-context';

const noIslands = { islandsForPath: () => [] } as unknown as EditorServices['decorations'];

function mountCell() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const node: CstNode = { kind: 'tableCell', leadingTrivia: '', raw: 'text' };
	const selection = createSelectionState();
	const context = editorMountContext({
		blockEdit: makeStubBlockEdit(),
		doc: { doc: () => ({ kind: 'document', prefix: '', children: [node], suffix: '' }) },
		services: {
			decorations: noIslands,
			selection,
			widgetSelection: createWidgetSelectionState({ onSelect: () => {} })
		}
	});
	context.set(TABLE_CONTEXT_KEY, {
		notifyCellFocused: vi.fn(),
		notifyCellBlurred: vi.fn(),
		focusCell: vi.fn(),
		setStickyColumn: vi.fn(),
		exitDownward: vi.fn(),
		exitUpward: vi.fn()
	});
	// Last row of a 2×2 table: ArrowDown exits the table rather than moving a cell.
	const instance = mount(TableCellBlock, {
		target,
		props: { node, index: 0, myPath: [0, 1, 0], rowIdx: 1, colIdx: 0, columnCount: 2, rowCount: 2 },
		context
	});
	flushSync();
	const el = target.querySelector('.table-cell') as HTMLElement;
	el.focus();
	return { instance, el, selection };
}

// onKeyDown awaits the widget-reveal intercepts before it reaches the plan.
async function press(el: HTMLElement, init: KeyboardEventInit): Promise<void> {
	el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
	for (let i = 0; i < 10; i++) await tick();
}

let mounted: ReturnType<typeof mountCell>;
// The arrow exit captures a sticky X, which measures the caret; jsdom leaves
// Range rect measurement unimplemented, so it throws rather than reporting zeros.
const originalRangeRects = Range.prototype.getClientRects;
const originalRangeBox = Range.prototype.getBoundingClientRect;
beforeEach(() => {
	Range.prototype.getClientRects = () =>
		({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
	Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
});
afterEach(async () => {
	Range.prototype.getClientRects = originalRangeRects;
	Range.prototype.getBoundingClientRect = originalRangeBox;
	if (mounted) await unmount(mounted.instance);
	document.body.innerHTML = '';
});

describe('the cell resets the select-all stage counter on every key it claims', () => {
	it('Ctrl+A alone advances the counter', async () => {
		mounted = mountCell();
		await press(mounted.el, { key: 'a', ctrlKey: true });
		expect(mounted.selection.selectAllCount).toBe(1);
	});

	it('Tab to the next cell resets it, so the next Ctrl+A starts at stage one', async () => {
		mounted = mountCell();
		await press(mounted.el, { key: 'a', ctrlKey: true });
		await press(mounted.el, { key: 'Tab' });
		expect(mounted.selection.selectAllCount).toBe(0);
	});

	it('an arrow exit out of the table resets it, so the count cannot leak into prose', async () => {
		mounted = mountCell();
		await press(mounted.el, { key: 'a', ctrlKey: true });
		await press(mounted.el, { key: 'ArrowDown' });
		expect(mounted.selection.selectAllCount).toBe(0);
	});

	it('holding Control before the chord does not reset the run', async () => {
		mounted = mountCell();
		await press(mounted.el, { key: 'a', ctrlKey: true });
		await press(mounted.el, { key: 'Control', ctrlKey: true });
		expect(mounted.selection.selectAllCount).toBe(1);
	});

	it('CapsLock does not change which chord starts the run', async () => {
		mounted = mountCell();
		await press(mounted.el, { key: 'A', ctrlKey: true });
		expect(mounted.selection.selectAllCount).toBe(1);
	});
});
