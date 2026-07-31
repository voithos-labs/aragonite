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
		get linkStamp() {
			return '0';
		},
		get islands() {
			return [];
		},
		getDocument: () => undefined,
		brokenUrlCache: new Set<string>()
	};
	return { el, deps, setNode: (next: CstNode) => (node = next) };
}

describe('text-render key across a prose→non-prose flip', () => {
	it('rebuilds the DOM when undo returns a matched-DOM non-prose block to prose', () => {
		// The undo corruption: '<di' + 'v' flips paragraph→htmlBlock, whose render finds textContent
		// already correct; skipping the render-key update freezes the key and undo shows stale DOM.
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

describe('text-render key across a prose→prose flip', () => {
	// Both kinds render through the prose arm, so the key's early return is the only thing between
	// them — a registry gaining an opener for a raw already in the document mints exactly this pair.
	it('rebuilds when the kind changes under an unchanged raw', () => {
		const heading = blockNode('# a\n');
		expect(heading.kind).toBe('heading');
		const paragraph = { kind: 'paragraph', raw: '# a\n' } as CstNode;

		const { el, deps, setNode } = makeHarness(paragraph);
		const render = createTextRender(deps);

		render.render();
		expect(el.querySelector('.md-marker')).toBeNull();

		setNode(heading);
		render.render();
		expect(el.querySelector('.md-marker')?.textContent).toBe('# ');
	});
});
