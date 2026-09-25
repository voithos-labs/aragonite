// @vitest-environment jsdom
//
// What the editor root's caret-hiding attribute keys on. Two callers ask two questions of one
// state: the overlay draws when `isCustomRendered`, while the root hid the browser caret when
// `isCrossBlock`, so every state where those disagree hides the caret with nothing drawn in its
// place. Miss-analysis (Sel-F1): the e2e helper waits on the attribute, which made it the answer
// to "is a selection live" everywhere, and no test compared it against what the overlay draws.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	installLayoutStubs,
	mountEditor,
	placeCaret,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';
import { cellAt, installTableLayoutStubs } from './mount-table';
import { pressKey } from '$lib/test/harness/settle';

// Without the Range stubs the visual-line check throws instead of falling back to the
// offset comparison the cell's edge test reads.
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
});

// Three rows, so a rectangle can grow downward and shrink back onto the cell it started in.
const DOC = '| aa | bb |\n| -- | -- |\n| cc | dd |\n| ee | ff |\n';

function editorRoot(): HTMLElement {
	return mounted!.target.querySelector('.editor') as HTMLElement;
}

describe('the root hides the native caret only while something paints in its place', () => {
	it('a rectangle shrunk back onto its own cell gives the caret back', async () => {
		mounted = mountEditor({ source: DOC });
		const start = cellAt(mounted!, 1, 0);
		// At the cell's last visual line, which is what admits the rectangle entry.
		placeCaret(start, 2);

		await pressKey(start, { key: 'ArrowDown', shiftKey: true });
		expect(editorRoot().hasAttribute('data-cross-block')).toBe(true);

		// Back onto the anchor cell: a one-cell rectangle is a stored pair the overlay declines
		// to draw, same path and offset, so hiding the caret leaves nothing on screen.
		await pressKey(cellAt(mounted!, 1, 0), { key: 'ArrowUp', shiftKey: true });

		expect(editorRoot().hasAttribute('data-cross-block')).toBe(false);
	});

	it('a live rectangle still hides it: the overlay owns that highlight', async () => {
		mounted = mountEditor({ source: DOC });
		const start = cellAt(mounted!, 1, 0);
		placeCaret(start, 2);

		await pressKey(start, { key: 'ArrowDown', shiftKey: true });

		expect(editorRoot().hasAttribute('data-cross-block')).toBe(true);
	});
});
