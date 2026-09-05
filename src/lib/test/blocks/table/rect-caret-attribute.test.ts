// @vitest-environment jsdom
//
// Which predicate the editor root's caret-hiding attribute keys on. Two consumers read two
// predicates of one state — the overlay paints on `isCustomRendered`, the root hid the native
// caret on `isCrossBlock` — so every state where those disagree hides the caret with nothing
// painted in its place. Miss (Sel-F1, class half): the e2e helper waits on the ATTRIBUTE, which
// made it the oracle for "is a selection live" everywhere, and no test ever compared it against
// what the overlay would paint.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { installLayoutStubs, mountEditor, placeCaret, type MountedEditor } from '../editor-mount';
import { cellAt, installTableLayoutStubs } from './mount-table';

// Without the Range stubs the visual-line probe throws instead of falling back to the
// offset comparison the cell's edge gate reads.
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

async function press(el: HTMLElement, init: KeyboardEventInit): Promise<void> {
	el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
	await mounted!.settle();
}

function editorRoot(): HTMLElement {
	return mounted!.target.querySelector('.editor') as HTMLElement;
}

describe('the root hides the native caret only while something paints in its place', () => {
	it('a rectangle shrunk back onto its own cell gives the caret back', async () => {
		mounted = mountEditor({ source: DOC });
		const start = cellAt(mounted!, 1, 0);
		// At the cell's last visual line, which is what admits the rectangle entry.
		placeCaret(start, 2);

		await press(start, { key: 'ArrowDown', shiftKey: true });
		expect(editorRoot().hasAttribute('data-cross-block')).toBe(true);

		// Back onto the anchor cell: a one-cell rectangle is a stored pair the overlay declines
		// to paint (same path, same offset), so hiding the caret leaves nothing on screen.
		await press(cellAt(mounted!, 1, 0), { key: 'ArrowUp', shiftKey: true });

		expect(editorRoot().hasAttribute('data-cross-block')).toBe(false);
	});

	it('a live rectangle still hides it — the overlay owns that highlight', async () => {
		mounted = mountEditor({ source: DOC });
		const start = cellAt(mounted!, 1, 0);
		placeCaret(start, 2);

		await press(start, { key: 'ArrowDown', shiftKey: true });

		expect(editorRoot().hasAttribute('data-cross-block')).toBe(true);
	});
});
