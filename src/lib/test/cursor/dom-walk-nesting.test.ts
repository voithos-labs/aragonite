// @vitest-environment jsdom
// Miss-analysis: the depth tests covered the renderer that builds this DOM
// (`core/inline-render-nesting.test.ts`) and nothing that reads it back, so every traversal in
// caret space recursed once per level over a fragment the renderer had just survived.
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

// Inline nesting comes from the input, so the rendered DOM is as deep as the source asks. The
// cap is jsdom's O(depth²) `matches` and `closest` cost, not the real ceiling, and it assumes
// the default V8 stack: raising `--stack-size` makes these pass even against a recursive walk.
const DOM_DEPTH = 8_000;
const LEAF = 'mn';

/** `head`, then a chain of spans around `LEAF`, then `tail`, built detached so jsdom pays for
 *  the depth once. The deepest span holds `LEAF` as two text nodes, so a search for the first
 *  or last match there has an order to get right. */
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

	it('puts the caret at a range on the deepest text node', () => {
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

	// Descending into the container's marker prefix asks a different question from the search for
	// measurable text beside it: it filters hidden marker text at the top level, never on the way down.
	it('puts the caret at the ambient caret on the deepest text node', () => {
		const block = nestedSpans(DOM_DEPTH);
		block.replaceChild(buildAmbientSpan('> '), block.firstChild!);
		// jsdom's own attach traversal overflows at this depth and it drops a detached range, so
		// the position is read where it is set. The real selection is tested shallow in
		// `ambient-dom.test.ts`.
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

// `fromEnd` is a mirrored pre-order, not the traversal reversed: each level's children come
// last first while a parent still comes before them, so only the leaf order ends up reversed,
// which is what a search for the last match reads off it.
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
