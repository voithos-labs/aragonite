// @vitest-environment jsdom
// Miss-analysis: the depth pins covered the renderer that BUILDS this DOM
// (`core/inline-render-nesting.test.ts`) and nothing that reads it back, so every caret-space
// walk recursed per level over a fragment the renderer had just survived.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildAmbientSpan, placeCaretAfterAmbientSpan } from '../../ambient/ambient-dom';
import { createRangeFromOffsets } from '../../cursor/content-offsets';
import { domDescendants } from '../../cursor/dom-walk';
import { asDomTextOffset } from '../../cursor/coordinate-spaces';
import { findFirstTextNode, findLastTextNode } from '../../cursor/visual-lines';
import {
	containerDomTextLength,
	domTextOffsetAtNode,
	rawTextOfNode
} from '../../cursor/widget-offset';

// Inline nesting is input-controlled, so the rendered DOM is as deep as the source asks. The cap
// is jsdom's O(depth²) `matches`/`closest` cost, not the ceiling, and it assumes the default V8
// stack: raising `--stack-size` turns every pin here green against a recursive walk.
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

	// The ambient span's own descent asks a different question from the measurable-text search
	// beside it: it filters hidden marker text at the top level, never during the walk.
	it('seats the ambient caret on the deepest text node', () => {
		const block = nestedSpans(DOM_DEPTH);
		block.replaceChild(buildAmbientSpan('> '), block.firstChild!);
		// jsdom's own attach walk overflows at this depth and it drops a detached range, so the
		// seat is read at the door. The real selection is pinned shallow in `ambient-dom.test.ts`.
		const seated: Range[] = [];
		const addRange = vi
			.spyOn(window.Selection.prototype, 'addRange')
			.mockImplementation((range) => void seated.push(range));

		try {
			expect(placeCaretAfterAmbientSpan(block)).toBe(true);
		} finally {
			addRange.mockRestore();
		}
		expect(seated).toHaveLength(1);
		expect(seated[0].startContainer.textContent).toBe(LEAF[0]);
		expect(seated[0].startOffset).toBe(0);
	}, 120_000);
});

// `fromEnd` is a MIRROR pre-order, not the walk reversed: each level's children come last-first
// while a parent still precedes them, so only the leaf order comes back reversed — which is what
// a last-match search reads off it.
describe('domDescendants under fromEnd', () => {
	it('walks each level last child first, with parents still ahead of children', () => {
		const root = document.createElement('div');
		root.id = 'R';
		const branch = document.createElement('span');
		branch.id = 'A';
		for (const id of ['B', 'C']) {
			const leaf = document.createElement('span');
			leaf.id = id;
			branch.appendChild(leaf);
		}
		const tail = document.createElement('span');
		tail.id = 'D';
		root.append(branch, tail);
		const ids = (options?: { fromEnd?: boolean }): string[] =>
			[...domDescendants(root, undefined, options)].map((node) => (node as Element).id);

		expect(ids()).toEqual(['R', 'A', 'B', 'C', 'D']);
		expect(ids({ fromEnd: true })).toEqual(['R', 'D', 'A', 'C', 'B']);
	});
});
