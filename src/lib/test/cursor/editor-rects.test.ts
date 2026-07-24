// @vitest-environment jsdom
// The rect surface's geometry is real only in a browser (pixel reads are e2e-tested),
// but scrollTo's ORCHESTRATION is pure wiring: mount (revealPath) before the viewport
// scroll, the block-option default, and presence as the resolved value. Those regress
// independently of geometry, so they are pinned here with fakes rather than a browser.

import { describe, it, expect, vi } from 'vitest';
import { createEditorRects } from '../../editor-rects';

function makeRects(el: HTMLElement | null) {
	const order: string[] = [];
	const scrollIntoView = vi.fn((_opts?: ScrollIntoViewOptions) => order.push('scroll'));
	if (el) el.scrollIntoView = scrollIntoView;
	const rects = createEditorRects({
		getBlockElByPath: () => el,
		getBlockComponentByPath: () => null,
		revealPath: async () => {
			order.push('reveal');
		},
		getEditorRoot: () => null,
		isCrossBlock: () => false
	});
	return { rects, order, scrollIntoView };
}

describe('EditorRects.scrollTo', () => {
	it('mounts (revealPath) before scrolling the viewport', async () => {
		const { rects, order } = makeRects(document.createElement('div'));
		await rects.scrollTo([4]);
		expect(order).toEqual(['reveal', 'scroll']);
	});

	it('resolves true and defaults the scroll block to nearest', async () => {
		const { rects, scrollIntoView } = makeRects(document.createElement('div'));
		expect(await rects.scrollTo([4])).toBe(true);
		expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
	});

	it('passes an explicit block option through to scrollIntoView', async () => {
		const { rects, scrollIntoView } = makeRects(document.createElement('div'));
		await rects.scrollTo([4], { block: 'center' });
		expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
	});

	it('resolves false and never scrolls when the block does not resolve', async () => {
		const { rects, scrollIntoView } = makeRects(null);
		expect(await rects.scrollTo([99])).toBe(false);
		expect(scrollIntoView).not.toHaveBeenCalled();
	});
});
