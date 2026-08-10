// @vitest-environment jsdom
//
// The cell write door's undo-anchor contract (GH #104, falsified): `caretBefore` addresses the
// PRE-write bytes, which are already escaped — cell caret offsets are raw-space, so the door
// forwards it unmapped, and mapping it against the NEW text would shift every anchor behind an
// escape the write inserts. Pinned end to end: a dispatch write, then undo, restores the caret
// byte-exact with a `\|` escape standing before it.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { tick } from 'svelte';
import { blockHostAt, installLayoutStubs, mountEditor, type MountedEditor } from '../editor-mount';
import { installTableLayoutStubs } from './mount-table';
import { domTextOffsetAtNode } from '$lib/cursor/widget-offset';
import type { UndoEntry } from '$lib/undo/types';
import { rangeSelectionOf } from '../../support/undo-entry';

let restoreLayout: () => void;
beforeAll(() => {
	installLayoutStubs();
	restoreLayout = installTableLayoutStubs();
	return () => restoreLayout();
});

let mounted: MountedEditor | null = null;
afterEach(async () => {
	if (mounted) await mounted.destroy();
	mounted = null;
	document.body.innerHTML = '';
});

const GRID = '| a\\|b **bold** | B |\n| --- | --- |\n| 1 | 2 |\n';

function cell(rowIdx: number, colIdx: number): HTMLElement {
	const host = blockHostAt(mounted!, [0]);
	const row = host.querySelector(`[data-table-row-idx="${rowIdx}"]`);
	const found = row?.querySelectorAll(':scope > .table-cell')[colIdx] as HTMLElement | undefined;
	if (!found) throw new Error(`no mounted cell at ${rowIdx},${colIdx}`);
	return found;
}

function caretRawOffset(el: HTMLElement): number | null {
	const sel = window.getSelection();
	if (!sel || !sel.focusNode || !el.contains(sel.focusNode)) return null;
	return domTextOffsetAtNode(el, sel.focusNode, sel.focusOffset);
}

function placeCaretInCell(el: HTMLElement, rawOffset: number): void {
	el.focus();
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	let remaining = rawOffset;
	let node: Node | null;
	while ((node = walker.nextNode())) {
		const len = node.textContent?.length ?? 0;
		if (remaining <= len) {
			const range = document.createRange();
			range.setStart(node, remaining);
			range.collapse(true);
			const sel = window.getSelection()!;
			sel.removeAllRanges();
			sel.addRange(range);
			return;
		}
		remaining -= len;
	}
	throw new Error(`offset ${rawOffset} out of range`);
}

describe('a cell dispatch write anchors undo at the exact pre-edit caret', () => {
	it('undo after a construct-edge delete restores caret and bytes byte-exact', async () => {
		mounted = mountEditor({ source: GRID, presentationMode: 'live' });
		const el = cell(0, 0);
		// `a\|b **bold**` — caret at the display end (13), past the escape and the hidden closer.
		placeCaretInCell(el, 13);

		el.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
		);
		await mounted.settle();
		// The construct-edge arm fired: the content character went, the pair survived.
		expect(mounted.source()).toBe('| a\\|b **bol** | B |\n| --- | --- |\n| 1 | 2 |\n');
		// The stored anchor is the byte-exact pre-edit caret — the #104 contract. Asserted on
		// the ENTRY, since the restored readback below is the door's clamped seat, not the anchor.
		const { undo } = (
			mounted.instance as unknown as { __test: { getUndoStack(): { undo: UndoEntry[] } } }
		).__test.getUndoStack();
		expect(rangeSelectionOf(undo[undo.length - 1]).anchor).toEqual({ path: [0, 0, 0], offset: 13 });

		el.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
		);
		await mounted.settle();
		await tick();

		expect(mounted.source()).toBe(GRID);
		// 11, not the anchor's 13: the park door clamps the restore to the landable end — 13 sits
		// past the hidden closer, and the typing seat resolves both offsets to the same write.
		expect(caretRawOffset(cell(0, 0))).toBe(11);
	});
});
