// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createTextRender } from '$lib/components/blocks/text/text-render';
import { blockNode, makeRenderHarness } from '$lib/test/harness/text-render';

describe('text-render image-load-policy memo key', () => {
	it('repaints an image block when imageLoadPolicy flips at runtime', () => {
		const { el, deps, setPolicy } = makeRenderHarness(blockNode('![cat](/x.png)\n'));
		const render = createTextRender(deps);

		render.render();
		const widget = () => el.querySelector('.md-image-widget');
		expect(widget()).not.toBeNull();
		expect(widget()!.classList.contains('md-image-placeholder')).toBe(false);

		setPolicy('placeholder');
		render.render();
		expect(widget()!.classList.contains('md-image-placeholder')).toBe(true);

		setPolicy('auto');
		render.render();
		expect(widget()!.classList.contains('md-image-placeholder')).toBe(false);
	});

	it('does not rebuild an image-free block when imageLoadPolicy flips', () => {
		const { el, deps, setPolicy } = makeRenderHarness(blockNode('hello\n'));
		const render = createTextRender(deps);

		render.render();
		const firstChild = el.firstChild;
		expect(firstChild).not.toBeNull();

		setPolicy('placeholder');
		render.render();

		// Image-free blocks must not subscribe to the policy: the early-return holds,
		// so the DOM is untouched and the child node keeps its identity.
		expect(el.firstChild).toBe(firstChild);
	});
});
