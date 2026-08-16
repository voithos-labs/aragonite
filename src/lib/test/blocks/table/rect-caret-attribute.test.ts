// @vitest-environment jsdom
//
// Which predicate the editor root's caret-hiding attribute keys on. Two consumers read two
// predicates of one state — the overlay paints on `isCustomRendered`, the root hid the native
// caret on `isCrossBlock` — so every state where those disagree hides the caret with nothing
// painted in its place. Miss (Sel-F1, class half): the e2e helper waits on the ATTRIBUTE, which
// made it the oracle for "is a selection live" everywhere, and no test ever compared it against
// what the overlay would paint.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { tick } from 'svelte';
import {
	blockHostAt,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	type MountedEditor
} from '../editor-mount';

beforeAll(installLayoutStubs);

let mounted: MountedEditor | null = null;
// jsdom leaves Range rect measurement unimplemented; without these the visual-line probe throws
// instead of falling back to the offset comparison the cell's edge gate reads.
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
	if (mounted) await mounted.destroy();
	mounted = null;
});

// Three rows, so a rectangle can grow downward and shrink back onto the cell it started in.
const DOC = '| aa | bb |\n| -- | -- |\n| cc | dd |\n| ee | ff |\n';

function cell(rowIdx: number, colIdx: number): HTMLElement {
	const row = blockHostAt(mounted!, [0]).querySelector(`[data-table-row-idx="${rowIdx}"]`);
	const found = row?.querySelectorAll(':scope > .table-cell')[colIdx] as HTMLElement | undefined;
	if (!found) throw new Error(`no mounted cell at ${rowIdx},${colIdx}`);
	return found;
}

async function press(el: HTMLElement, init: KeyboardEventInit): Promise<void> {
	el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
	for (let i = 0; i < 12; i++) await tick();
}

function editorRoot(): HTMLElement {
	return mounted!.target.querySelector('.editor') as HTMLElement;
}

describe('the root hides the native caret only while something paints in its place', () => {
	it('a rectangle shrunk back onto its own cell gives the caret back', async () => {
		mounted = mountEditor({ source: DOC });
		const start = cell(1, 0);
		// At the cell's last visual line, which is what admits the rectangle entry.
		placeCaret(start, 2);

		await press(start, { key: 'ArrowDown', shiftKey: true });
		expect(editorRoot().hasAttribute('data-cross-block')).toBe(true);

		// Back onto the anchor cell: a one-cell rectangle is a stored pair the overlay declines
		// to paint (same path, same offset), so hiding the caret leaves nothing on screen.
		await press(cell(1, 0), { key: 'ArrowUp', shiftKey: true });

		expect(editorRoot().hasAttribute('data-cross-block')).toBe(false);
	});

	it('a live rectangle still hides it — the overlay owns that highlight', async () => {
		mounted = mountEditor({ source: DOC });
		const start = cell(1, 0);
		placeCaret(start, 2);

		await press(start, { key: 'ArrowDown', shiftKey: true });

		expect(editorRoot().hasAttribute('data-cross-block')).toBe(true);
	});
});
