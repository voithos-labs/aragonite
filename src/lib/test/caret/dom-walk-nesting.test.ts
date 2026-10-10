// @vitest-environment jsdom
// Miss-analysis: depth tests covered only the renderer, never the traversals reading its DOM back.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildAmbientSpan } from '../../ambient/ambient-dom';
import { domDescendants } from '../../caret/dom-walk';
import { asDomTextOffset } from '../../caret/coordinate-spaces';
import { findFirstTextNode, findLastTextNode } from '../../caret/visual-lines';
import {
	containerDomTextLength,
	createRangeAtDomTextOffsets,
	domTextOffsetAtNode,
	rawTextOfNode
} from '../../caret/widget-offset';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';

// The rendered DOM is as deep as the source asks. The cap is jsdom's O(depth²) selector cost and
// assumes the default V8 stack: a raised `--stack-size` lets even a recursive walk pass.
const DOM_DEPTH = 8_000;
const LEAF = 'mn';

/** Built detached so jsdom pays for the depth once. The deepest span holds `LEAF` as two text
 *  nodes, so a first- or last-match search there has an order to get right. */
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
		const range = createRangeAtDomTextOffsets(
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
		// jsdom's attach traversal overflows at this depth and drops a detached range, so the
		// position is read where it is set; `ambient-dom.test.ts` tests the real selection.
		const seated: [Node, number][] = [];
		const write = vi
			.spyOn(window.Selection.prototype, 'setBaseAndExtent')
			.mockImplementation((node, offset) => void seated.push([node, offset]));

		try {
			expect(testCaretWriter.placeCaretAtRaw(block, 0, { clamp: 'exact' })).toBe(true);
		} finally {
			write.mockRestore();
		}
		expect(seated).toHaveLength(1);
		expect(seated[0][0].textContent).toBe(LEAF[0]);
		expect(seated[0][1]).toBe(0);
	}, 120_000);
});

// `fromEnd` is a mirrored pre-order, not the reversed traversal: a parent still precedes its
// children, so only the leaf order ends up reversed, which a last-match search relies on.
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
