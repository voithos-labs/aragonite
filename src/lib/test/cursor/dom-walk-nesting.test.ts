// @vitest-environment jsdom
// Miss-analysis: the depth pins covered the renderer that BUILDS this DOM
// (`core/inline-render-nesting.test.ts`) and nothing that reads it back, so every caret-space
// walk recursed per level over a fragment the renderer had just survived.
import { beforeAll, describe, expect, it } from 'vitest';
import { createRangeFromOffsets } from '../../cursor/content-offsets';
import { asDomTextOffset } from '../../cursor/coordinate-spaces';
import { findFirstTextNode, findLastTextNode } from '../../cursor/visual-lines';
import {
	containerDomTextLength,
	domTextOffsetAtNode,
	rawTextOfNode
} from '../../cursor/widget-offset';

// Inline nesting is input-controlled, so the rendered DOM is as deep as the source asks.
const DOM_DEPTH = 8_000;
const LEAF = 'mn';

/** `head` + a span chain around `LEAF` + `tail`, built detached so jsdom pays depth once. The
 *  deepest span holds `LEAF` as two text nodes, so a first/last search there has an order. */
function nestedSpans(depth: number): HTMLElement {
	let chain = document.createElement('span');
	for (const char of LEAF) chain.appendChild(document.createTextNode(char));
	for (let level = 1; level < depth; level++) {
		const parent = document.createElement('span');
		parent.appendChild(chain);
		chain = parent;
	}
	const root = document.createElement('div');
	root.appendChild(document.createTextNode('head'));
	root.appendChild(chain);
	root.appendChild(document.createTextNode('tail'));
	return root;
}

describe('caret-space DOM walks at input-controlled nesting depth', () => {
	let root: HTMLElement;
	let leafText: Text;

	beforeAll(() => {
		root = nestedSpans(DOM_DEPTH);
		let deepest: Node = root.childNodes[1];
		while (deepest.firstChild) deepest = deepest.firstChild;
		leafText = deepest as Text;
	});

	it('reads raw bytes back in source order', () => {
		expect(rawTextOfNode(root, '')).toBe('head' + LEAF + 'tail');
	}, 120_000);

	it('counts and addresses walk offsets in source order', () => {
		expect(containerDomTextLength(root)).toBe(8 + LEAF.length);
		expect(domTextOffsetAtNode(root, leafText, 0)).toBe(4);
	}, 120_000);

	it('seats a range on the deepest text node', () => {
		const range = createRangeFromOffsets(
			root,
			asDomTextOffset(4),
			asDomTextOffset(4 + LEAF.length)
		);
		expect(range?.toString()).toBe(LEAF);
	}, 120_000);

	it('finds the first and last measurable text under the chain', () => {
		const chain = root.childNodes[1];
		expect(findFirstTextNode(chain)?.textContent).toBe(LEAF[0]);
		expect(findLastTextNode(chain)?.textContent).toBe(LEAF[1]);
	}, 120_000);
});
