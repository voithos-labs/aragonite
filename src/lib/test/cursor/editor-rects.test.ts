// @vitest-environment jsdom
// Geometry is real only in a browser (e2e covers the pixels), but the order `scrollTo` does
// things in is plain wiring: place before the mount, mount before the scroll. What the placement
// then does is the scroll owner's, in `scroll-owner-placement.test.ts`. The answers that are not
// geometry (a path nothing mounts, a caret that is not one) are plain wiring too.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createEditorRects } from '../../editor-rects';
import type { PlaceOptions } from '../../cursor/scroll-owner';
import { installEditorDomStubsForTests } from '$lib/testing';

installEditorDomStubsForTests();

function makeRects(over: Partial<Parameters<typeof createEditorRects>[0]> = {}) {
	const order: string[] = [];
	const place = vi.fn((_path: readonly number[], _opts: PlaceOptions) => {
		order.push('place');
		return {
			scroll: async () => {
				order.push('scroll');
				return true;
			}
		};
	});
	const landCaretAt = vi.fn(async (_path: number[], _offset: number) => true);
	const rects = createEditorRects({
		getBlockElByPath: () => null,
		getBlockComponent: () => null,
		revealPath: async () => {
			order.push('reveal');
		},
		getEditorRoot: () => null,
		scroll: { place },
		isCrossBlock: () => false,
		isHostChrome: () => false,
		landCaretAt,
		...over
	});
	return { rects, order, place, landCaretAt };
}

describe('EditorRects.scrollTo', () => {
	it('places before revealing, then scrolls', async () => {
		const { rects, order } = makeRects();
		await rects.scrollTo([4]);
		// The placement must happen synchronously before the first await: the gesture that starts
		// the scroll (a Previous-match click) releases the held block on pointerdown.
		expect(order).toEqual(['place', 'reveal', 'scroll']);
	});

	it('defaults to a held nearest placement at the full path', async () => {
		const { rects, place } = makeRects();
		expect(await rects.scrollTo([4, 2])).toBe(true);
		expect(place).toHaveBeenCalledWith([4, 2], { block: 'nearest', hold: true });
	});

	it('passes a centred, unheld request through as asked', async () => {
		const { rects, place } = makeRects();
		await rects.scrollTo([4], { block: 'center', hold: false });
		expect(place).toHaveBeenCalledWith([4], { block: 'center', hold: false });
	});
});

describe('EditorRects.navigateTo', () => {
	it('lands the caret at the target through the restore path', async () => {
		const { rects, landCaretAt } = makeRects();
		expect(await rects.navigateTo([4, 1])).toBe(true);
		expect(landCaretAt).toHaveBeenCalledWith([4, 1], 0);
	});

	it('carries an offset to the landing, for a caller aiming past the block start', async () => {
		const { rects, landCaretAt } = makeRects();
		expect(await rects.navigateTo([4, 1], 13)).toBe(true);
		expect(landCaretAt).toHaveBeenCalledWith([4, 1], 13);
	});

	it('copies the path so a caller mutating its array cannot re-aim the landing', async () => {
		const { rects, landCaretAt } = makeRects();
		const path = [4, 1];
		const done = rects.navigateTo(path);
		path[1] = 7;
		await done;
		expect(landCaretAt).toHaveBeenCalledWith([4, 1], 0);
	});
});

describe('EditorRects.reveal and scrollTo on a path nothing mounts', () => {
	it('reveal resolves false when no element stands at the path after the mount', async () => {
		const { rects } = makeRects({ getBlockElByPath: () => null });
		expect(await rects.reveal([99])).toBe(false);
	});

	it('reveal resolves true once the mount leaves an element at the path', async () => {
		const el = document.createElement('div');
		const { rects } = makeRects({ getBlockElByPath: () => el });
		expect(await rects.reveal([2])).toBe(true);
	});

	it('scrollTo resolves with what the placement reports, false when it never came into view', async () => {
		const place = vi.fn(() => ({ scroll: async () => false }));
		const { rects } = makeRects({ scroll: { place } });
		expect(await rects.scrollTo([99])).toBe(false);
	});
});

// The caret lives in the browser's own selection; these put a real range in a jsdom root.
describe('EditorRects.caretRect', () => {
	const mounted: HTMLElement[] = [];

	function rootWithCaret(): { root: HTMLElement; text: Text } {
		const root = document.createElement('div');
		const text = document.createTextNode('caret here');
		root.append(text);
		document.body.append(root);
		mounted.push(root);
		const range = document.createRange();
		range.setStart(text, 2);
		range.collapse(true);
		const selection = window.getSelection()!;
		selection.removeAllRanges();
		selection.addRange(range);
		return { root, text };
	}

	afterEach(() => {
		window.getSelection()?.removeAllRanges();
		mounted.splice(0).forEach((el) => el.remove());
	});

	it('reports the caret that sits in the editor', () => {
		const { root } = rootWithCaret();
		const { rects } = makeRects({ getEditorRoot: () => root });
		expect(rects.caretRect()).not.toBeNull();
	});

	// Miss-analysis: the browser held a real caret in every caret-rect check but one, so the
	// held-aside range of a cross-block selection was never asked for as a caret below e2e.
	it('is null while a cross-block selection is active, however the browser selection reads', () => {
		const { root } = rootWithCaret();
		const { rects } = makeRects({ getEditorRoot: () => root, isCrossBlock: () => true });
		expect(rects.caretRect()).toBeNull();
	});

	it('is null when nothing is selected', () => {
		const root = document.createElement('div');
		document.body.append(root);
		mounted.push(root);
		window.getSelection()?.removeAllRanges();
		const { rects } = makeRects({ getEditorRoot: () => root });
		expect(rects.caretRect()).toBeNull();
	});

	it('is null when the caret sits outside the editor root', () => {
		const { text } = rootWithCaret();
		const other = document.createElement('div');
		document.body.append(other);
		mounted.push(other);
		const { rects } = makeRects({ getEditorRoot: () => other });
		expect(text.isConnected).toBe(true);
		expect(rects.caretRect()).toBeNull();
	});

	it('is null for a caret in the host’s own header', () => {
		const { root } = rootWithCaret();
		const { rects } = makeRects({ getEditorRoot: () => root, isHostChrome: () => true });
		expect(rects.caretRect()).toBeNull();
	});

	it('is null before the editor root is bound', () => {
		rootWithCaret();
		const { rects } = makeRects({ getEditorRoot: () => null });
		expect(rects.caretRect()).toBeNull();
	});
});
