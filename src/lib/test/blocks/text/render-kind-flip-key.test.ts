// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { createTextRender, type TextRenderDeps } from '$lib/components/blocks/text/text-render';
import { trimTrailingLineEnding } from '$lib/core/lines';
import type { CstNode } from '$lib/core/nodes';

function blockNode(source: string): CstNode {
	const node = parse(source).children[0];
	if (!node) throw new Error('expected a block node');
	return node;
}

function makeHarness(initial: CstNode) {
	const el = document.createElement('div');
	let node = initial;
	const deps: TextRenderDeps = {
		get el() {
			return el;
		},
		get node() {
			return node;
		},
		get ambientPrefix() {
			return '';
		},
		get ambientPrefixText() {
			return '';
		},
		getDisplayText: () => trimTrailingLineEnding(node.raw),
		resolveImageUrl: (u) => u,
		resolveLinkUrl: (u) => u,
		get imageLoadPolicy() {
			return 'auto' as const;
		},
		get presentationMode() {
			return 'source' as const;
		},
		get linkResolver() {
			return undefined;
		},
		get linkSignature() {
			return '';
		},
		get islands() {
			return [];
		},
		brokenUrlCache: new Set<string>()
	};
	return { el, deps, setNode: (next: CstNode) => (node = next) };
}

describe('text-render key across a prose→non-prose flip', () => {
	it('rebuilds the DOM when undo returns a matched-DOM non-prose block to prose', () => {
		// The undo corruption: '<di' (paragraph) --type 'v'--> '<div' (htmlBlock).
		// The browser inserts the char, so the non-prose render finds
		// el.textContent already === display; if it skips the render-key update
		// there, the key freezes at the prose render. Undo restores the '<di'
		// paragraph, whose key equals the frozen one, so the prose render
		// early-returns and the DOM keeps showing '<div' — CST-wins violated, and
		// the next keystroke commits the stale bytes.
		const paragraph = blockNode('<di\n');
		const htmlBlock = blockNode('<div\n');
		expect(paragraph.kind).toBe('paragraph');
		expect(htmlBlock.kind).toBe('htmlBlock');

		const { el, deps, setNode } = makeHarness(paragraph);
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
