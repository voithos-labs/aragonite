// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createTextRender } from '$lib/components/blocks/text/text-render';
import type { CstNode } from '$lib/core/nodes';
import { makeRenderHarness } from '$lib/test/harness/text-render';

// A prose block whose text ends in a line break has an empty last line, and the caret needs
// something after the break to sit on it (GH #467).
// Miss-analysis: the plain-text and code blocks anchor that line, and no prose render test ever
// drew a block whose own text ended in a line break.

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
