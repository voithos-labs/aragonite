// @vitest-environment jsdom
// A cell write anchors undo at `caretBefore` unmapped: it counts into the already-escaped bytes
// before the write, so mapping it against the new text would shift every anchor behind an escape
// the write inserts. A write then undo restores the caret with a `\|` escape before it.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { tick } from 'svelte';
import {
	installLayoutStubs,
	mountEditor,
	placeCaret,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { cellAt, installTableLayoutStubs } from './mount-table';
import { domTextOffsetAtNode } from '#lib/cursor/widget-offset.js';
import type { UndoEntry } from '#lib/undo/types.js';
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

function caretRawOffset(el: HTMLElement): number | null {
	const sel = window.getSelection();
	if (!sel || !sel.focusNode || !el.contains(sel.focusNode)) return null;
	return domTextOffsetAtNode(el, sel.focusNode, sel.focusOffset);
}

describe('a cell dispatch write anchors undo at the exact pre-edit caret', () => {
	it('undo after a construct-edge delete restores caret and bytes byte-exact', async () => {
		mounted = mountEditor({ source: GRID, presentationMode: 'live' });
		const el = cellAt(mounted, 0, 0);
		// `a\|b **bold**`: caret at the end of the displayed text (13), past the escape and the
		// hidden closer.
		placeCaret(el, 13);

		el.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
		);
		await mounted.settle();
		// Backspace at the hidden closer takes the content character and keeps the `**` pair.
		expect(mounted.source()).toBe('| a\\|b **bol** | B |\n| --- | --- |\n| 1 | 2 |\n');
		// The stored anchor is exactly the caret from before the edit. Asserted on the undo entry
		// itself, since the restored reading below is the clamped caret, not the anchor.
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
		// 11, not the anchor's 13: the restore is clamped to the last reachable offset, since 13
		// sits past the hidden closer, and both offsets write the same bytes anyway.
		expect(caretRawOffset(cellAt(mounted, 0, 0))).toBe(11);
	});
});
