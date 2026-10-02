// @vitest-environment jsdom
// Geometry is real only in a browser (e2e covers the pixels), but the order `scrollTo` does
// things in is plain wiring: place before the mount, mount before the scroll. What the placement
// then does is the scroll owner's, in `scroll-owner-placement.test.ts`.

import { describe, it, expect, vi } from 'vitest';
import { createEditorRects } from '../../editor-rects';
import type { PlaceOptions } from '../../cursor/scroll-owner';

function makeRects() {
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
		landCaretAt
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
