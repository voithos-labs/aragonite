// @vitest-environment jsdom
// Windowing under host scroll: the editor sits at some offset INSIDE the scrollport's content,
// so every coordinate hop must cancel the port's own box top and the scroll independently.
// Miss-analysis: nothing pinned this before, because every scope stub put the editor AT the
// scrollport origin — where the two terms are both zero and any arithmetic passes.
import { describe, it, expect } from 'vitest';
import { fixedOracle, makePara, mountListWindowing } from '../harness/list-windowing.svelte';

const BLOCK_PX = 50;
const COUNT = 100;
/** Page chrome between the scrollport's content origin and this editor's first block. */
const EDITOR_OFFSET = 400;

function mountScope(opts: { viewportTop?: number; editorOffset?: number }) {
	const children = Array.from({ length: COUNT }, (_, i) => makePara(`p${i}\n`));
	return mountListWindowing({
		children,
		ids: children.map((_, i) => `b${i}`),
		oracle: fixedOracle(BLOCK_PX),
		listHeight: COUNT * BLOCK_PX,
		viewportTop: opts.viewportTop,
		chromeAbove: opts.editorOffset
	});
}

describe('windowing against a scrollport the editor sits inside', () => {
	it('reveals to the port coordinate, not the scope-local one', async () => {
		const { windowing, cleanup, port } = mountScope({ editorOffset: EDITOR_OFFSET });
		await windowing.revealChild(50);
		// Dropping the editor's offset within the scroller would land on 2500 — a whole
		// 400px band above the target, which is exactly the wrong slice.
		expect(port.scrollTop()).toBe(EDITOR_OFFSET + 50 * BLOCK_PX);
		expect(windowing.isInWindow(50)).toBe(true);
		cleanup();
	});

	it('windows the same band whether the port is the page or an ancestor box', async () => {
		// The same editor, 400px into the content, under a port whose own box starts at 120:
		// the port offset must cancel out entirely, leaving one answer.
		const page = mountScope({ editorOffset: EDITOR_OFFSET });
		const nested = mountScope({ viewportTop: 120, editorOffset: EDITOR_OFFSET });
		await page.windowing.revealChild(50);
		await nested.windowing.revealChild(50);

		expect(nested.port.scrollTop()).toBe(page.port.scrollTop());
		expect(nested.windowing.window).toEqual(page.windowing.window);
		page.cleanup();
		nested.cleanup();
	});

	it('maps a scroll into the same slice an editor-owned scrollport would', async () => {
		const host = mountScope({ editorOffset: EDITOR_OFFSET });
		const self = mountScope({});
		await host.windowing.revealChild(50);
		await self.windowing.revealChild(50);
		// Same document, same viewport, ports differing only by where the editor starts.
		expect(host.windowing.window).toEqual(self.windowing.window);
		expect(host.port.scrollTop() - self.port.scrollTop()).toBe(EDITOR_OFFSET);
		host.cleanup();
		self.cleanup();
	});

	// VR-5: `revealChild` is followed by a membership check before anything awaits a mount,
	// and a reveal past the end must leave that check answerable rather than hanging.
	it('terminates a reveal clamped past the last child', async () => {
		const { windowing, cleanup, port } = mountScope({ editorOffset: EDITOR_OFFSET });
		await windowing.revealChild(COUNT + 10);
		expect(port.scrollTop()).toBe(EDITOR_OFFSET + COUNT * BLOCK_PX);
		expect(windowing.isInWindow(COUNT + 10)).toBe(false);
		cleanup();
	});
});
