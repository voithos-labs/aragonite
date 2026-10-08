// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createTextRender } from '#lib/components/blocks/text/text-render.js';
import type { CstNode } from '#lib/core/nodes.js';
import { makeRenderHarness } from '#lib/test/harness/text-render.js';

// A prose block whose text ends in a line break needs something after the break for the caret.
// Miss-analysis: GH #467, no prose render test drew a block whose own text ended in a line break.

const paragraph = (raw: string) => ({ kind: 'paragraph', leadingTrivia: '', raw }) as CstNode;
const anchors = (el: HTMLElement) => el.querySelectorAll('br[data-caret-anchor]').length;

describe('the empty last line of a prose block', () => {
	it('gets one caret anchor after the break, which adds no text', () => {
		const { el, deps } = makeRenderHarness(paragraph('Plan\n\n'));
		createTextRender(deps).render();
		expect(el.textContent).toBe('Plan\n');
		expect(el.lastChild?.nodeName).toBe('BR');
		expect(anchors(el)).toBe(1);
	});

	it('keeps one anchor across a forced rebuild', () => {
		const { el, deps } = makeRenderHarness(paragraph('Plan\n\n'));
		const render = createTextRender(deps);
		render.render();
		render.render({ forceRebuild: true });
		expect(anchors(el)).toBe(1);
	});

	it('drops the anchor once text fills the line', () => {
		const { el, deps, setNode } = makeRenderHarness(paragraph('Plan\n\n'));
		const render = createTextRender(deps);
		render.render();
		setNode(paragraph('Plan\nx\n'));
		render.render();
		expect(anchors(el)).toBe(0);
	});
});
