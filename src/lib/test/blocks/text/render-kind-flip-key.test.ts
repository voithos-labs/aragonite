// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createTextRender } from '$lib/components/blocks/text/text-render';
import type { CstNode } from '$lib/core/nodes';
import { blockNode, makeRenderHarness } from '$lib/test/harness/text-render';

describe('text-render key across a prose→non-prose flip', () => {
	it('rebuilds the DOM when undo returns a matched-DOM non-prose block to prose', () => {
		// Typing 'v' after '<di' turns a paragraph into an HTML block, whose render finds the
		// text already correct; leaving the render key unchanged then makes undo show old DOM.
		const paragraph = blockNode('<di\n');
		const htmlBlock = blockNode('<div\n');
		expect(paragraph.kind).toBe('paragraph');
		expect(htmlBlock.kind).toBe('htmlBlock');

		const { el, deps, setNode } = makeRenderHarness(paragraph);
		const render = createTextRender(deps);

		render.render();
		expect(el.textContent).toBe('<di');

		setNode(htmlBlock);
		el.textContent = '<div';
		render.render();

		setNode(paragraph);
		render.render();
		expect(el.textContent).toBe('<di');
	});
});

describe('text-render key across a prose→prose flip', () => {
	// Both kinds render through the same prose branch, so the key's early return is the only thing
	// between them, and a registry gaining an opener for bytes already in the document makes this.
	it('rebuilds when the kind changes under an unchanged raw', () => {
		const heading = blockNode('# a\n');
		expect(heading.kind).toBe('heading');
		const paragraph = { kind: 'paragraph', raw: '# a\n' } as CstNode;

		const { el, deps, setNode } = makeRenderHarness(paragraph);
		const render = createTextRender(deps);

		render.render();
		expect(el.querySelector('.md-marker')).toBeNull();

		setNode(heading);
		render.render();
		expect(el.querySelector('.md-marker')?.textContent).toBe('# ');
	});
});
