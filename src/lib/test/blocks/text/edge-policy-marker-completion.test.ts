// @vitest-environment jsdom
//
// The caret-edge dispatch's marker-completion branch: a bare space at the content start of an
// empty child belongs to the marker the parser already made, so it is consumed and no byte moves.
// Miss-analysis: the parser makes `>` on one keystroke and the suite only ever loaded quotes, so
// the second keystroke of the two-key marker had no test at any level.
import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { trimTrailingLineEnding } from '$lib/core/lines';
import type { CstNode } from '$lib/core/nodes';
import {
	at,
	installEdgeDispatchCleanup,
	key,
	makeEdgeDispatch,
	mountSurface,
	type EdgeDispatchHarness
} from './edge-policy-fixture';

interface Harness extends EdgeDispatchHarness {
	/** Point the same dispatch at another child of the mounted container, as a recycled
	 *  block component does. */
	useChild: (index: number) => void;
}

/** The leaf at `path` inside `source`, wired to the dispatch with its real ancestor container. */
function mount(source: string, path: number[], isReading = false): Harness {
	const doc = parse(source);
	let parent: CstNode | null = null;
	let node = doc.children[path[0]];
	for (const index of path.slice(1)) {
		parent = node;
		node = node.children![index];
	}

	const el = mountSurface(trimTrailingLineEnding(node.raw));
	return {
		...makeEdgeDispatch(() => node, el, {
			index: path[path.length - 1],
			containerParent: parent,
			isReading: () => isReading
		}),
		useChild: (index) => {
			node = parent!.children![index];
		}
	};
}

installEdgeDispatchCleanup();

describe('a container declaring contentStartSpace completes its marker', () => {
	it('consumes the space at the content start of an empty child, writing nothing', () => {
		const h = mount('>\n', [0, 0]);
		const e = key(' ');
		expect(h.handleKeydown(e, at(0))).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(h.edits).toHaveLength(0);
	});

	it('completes a nested quote at its own depth — the nearest ancestor answers', () => {
		const h = mount('> >\n', [0, 0, 0]);
		expect(h.handleKeydown(key(' '), at(0))).toBe(true);
	});

	it('completes at a MIDDLE empty child, not only the one an Enter just made', () => {
		const h = mount('> a\n>\n>\n> b\n', [0, 1]);
		expect(h.handleKeydown(key(' '), at(0))).toBe(true);
		expect(h.edits).toHaveLength(0);
	});

	// The consumed key writes nothing, so the child is byte-identical when the second space
	// arrives and only this branch's own memory tells them apart. The second space is also the
	// only way to type a leading space at all, and the indented-code opener needs four (GH #143).
	it('declines the second space at the same seat, leaving it to land as content', () => {
		const h = mount('>\n', [0, 0]);
		expect(h.handleKeydown(key(' '), at(0))).toBe(true);
		const second = key(' ');
		expect(h.handleKeydown(second, at(0))).toBe(false);
		expect(second.defaultPrevented).toBe(false);
		expect(h.edits).toHaveLength(0);
	});

	// It is taken once per child, not once per component: a component recycled for another
	// empty child gives that child its own completion.
	it('re-arms when the surface is re-used for a different empty child', () => {
		const h = mount('>\n>\n', [0, 0]);
		expect(h.handleKeydown(key(' '), at(0))).toBe(true);
		expect(h.handleKeydown(key(' '), at(0))).toBe(false);
		h.useChild(1);
		expect(h.handleKeydown(key(' '), at(0))).toBe(true);
	});

	it('declines in an equally empty child of a container that declares nothing', () => {
		const h = mount('- \n', [0, 0, 0]);
		expect(h.handleKeydown(key(' '), at(0))).toBe(false);
	});

	it('declines at the document root, where there is no container to complete', () => {
		const h = mount('\n', [0]);
		expect(h.handleKeydown(key(' '), at(0))).toBe(false);
	});
});

describe('the marker-completion gate is byte shapes only', () => {
	it('declines in a NON-empty child, where the space is content', () => {
		const h = mount('> abc\n', [0, 0]);
		expect(h.handleKeydown(key(' '), at(0))).toBe(false);
	});

	it('declines past the content start', () => {
		const h = mount('>\n', [0, 0]);
		expect(h.handleKeydown(key(' '), at(1))).toBe(false);
	});

	it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }])(
		'declines a modified space (%o)',
		(modifiers) => {
			const h = mount('>\n', [0, 0]);
			expect(h.handleKeydown(key(' ', modifiers), at(0))).toBe(false);
		}
	);

	it('declines every other printable at the same seat', () => {
		const h = mount('>\n', [0, 0]);
		expect(h.handleKeydown(key('a'), at(0))).toBe(false);
	});

	it('declines in reading mode, which stands every editing arm down', () => {
		const h = mount('>\n', [0, 0], true);
		expect(h.handleKeydown(key(' '), at(0))).toBe(false);
	});
});
