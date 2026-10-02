// @vitest-environment jsdom
// Miss-analysis: no render test drew a pending break in a block with bytes past its text.
import { describe, it, expect } from 'vitest';
import { createTextRender } from '$lib/components/blocks/text/text-render';
import { hiddenSuffixLength } from '$lib/cursor/widget-offset';
import { blockNode, makeRenderHarness } from '$lib/test/harness/text-render';

/** The block's top-level children in order: text, the suffix span, or a break anchor. */
function shape(el: HTMLElement): string[] {
	return [...el.childNodes].map((node) => {
		if (node instanceof HTMLBRElement) return `<br ${node.dataset.caretAnchor ?? ''}>`;
		if (node instanceof HTMLElement && node.hasAttribute('data-block-suffix')) {
			return `suffix:${node.textContent}`;
		}
		return node.textContent ?? '';
	});
}

describe('a pending hard break at the end of a block with structure past its text', () => {
	it('draws a heading’s closing run before the new line', () => {
		const { el, deps } = makeRenderHarness(blockNode('# Hi\\ #\n'), { mode: 'live' });
		createTextRender(deps).render();
		expect(shape(el)).toEqual(['# ', 'Hi', '\\', 'suffix: #', '<br break>', '<br break>']);
	});

	it('still reads the hidden closing run’s length with the anchors after it', () => {
		const { el, deps } = makeRenderHarness(blockNode('# Hi\\ #\n'), { mode: 'live' });
		const editor = document.createElement('div');
		editor.setAttribute('data-presentation', 'live');
		editor.appendChild(el);
		createTextRender(deps).render();
		expect(hiddenSuffixLength(el)).toBe(2);
	});

	it('draws a setext underline after the new line, on a line of its own', () => {
		const { el, deps } = makeRenderHarness(blockNode('Hi\\\n===\n'), { mode: 'live' });
		createTextRender(deps).render();
		expect(shape(el)).toEqual(['Hi', '\\', '<br break>', '<br break>', 'suffix:\n===']);
	});
});
