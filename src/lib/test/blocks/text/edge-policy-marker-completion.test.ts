// @vitest-environment jsdom
//
// The caret-edge dispatch's container marker-completion arm: a bare space at the content start of
// an empty child is the marker the opener already minted, so it is consumed and no byte moves.
// Miss-analysis: the opener minted `>` on one keystroke and the suite only ever LOADED quotes, so
// the second keystroke of the two-press marker had no test at any level.
import { afterEach, describe, expect, it } from 'vitest';
import {
	createEdgePolicyDispatch,
	type EdgePolicyDispatchDeps
} from '$lib/components/blocks/text/edge-policy-dispatch';
import { parse } from '$lib/core/parser';
import { asRawOffset, type RawOffset } from '$lib/cursor/coordinate-spaces';
import type { BlockEditActions } from '$lib/action-contracts';
import type { CstNode } from '$lib/core/nodes';
import { makePendingMarks } from '$lib/test/harness/editor-actions';

interface Harness {
	handleKeydown: ReturnType<typeof createEdgePolicyDispatch>['handleKeydown'];
	/** `updateBlockContent` argument tuples — empty is the consume contract. */
	edits: unknown[];
	/** Repoint the same dispatch at another child of the mounted container, as a windowed
	 *  surface re-used for a different block does. */
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

	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	el.textContent = node.raw.replace(/\n$/, '');
	document.body.appendChild(el);

	const edits: unknown[] = [];
	const deps: EdgePolicyDispatchDeps = {
		get node() {
			return node;
		},
		get index() {
			return path[path.length - 1];
		},
		get containerParent() {
			return parent;
		},
		get linkRef() {
			return undefined;
		},
		getEl: () => el,
		getAmbientLength: () => 0,
		hasIslands: () => false,
		getRawSelection: () => null,
		blockEdit: {
			updateBlockContent: (...args: unknown[]) => void edits.push(args)
		} as unknown as BlockEditActions,
		setPendingCursor: () => {},
		setSnapTarget: () => {},
		isRevealing: () => false,
		enterWidget: () => {},
		isReading: () => isReading,
		getEdgeAffinity: () => null,
		pendingMarks: makePendingMarks(),
		installedAs: 'block'
	};
	return {
		handleKeydown: createEdgePolicyDispatch(deps).handleKeydown,
		edits,
		useChild: (index) => {
			node = parent!.children![index];
		}
	};
}

const key = (name: string, modifiers: Partial<KeyboardEvent> = {}) =>
	new KeyboardEvent('keydown', { key: name, cancelable: true, ...modifiers });

const at = (offset: number) => asRawOffset(offset) as RawOffset;

afterEach(() => {
	document.body.innerHTML = '';
});

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

	// The consumed press writes nothing, so the child is byte-identical when press 2 arrives and
	// only this arm's own memory can tell them apart. Press 2 is also the only way to type a
	// leading space at all — the indented-code opener needs four (GH #143).
	it('declines the second space at the same seat, leaving it to land as content', () => {
		const h = mount('>\n', [0, 0]);
		expect(h.handleKeydown(key(' '), at(0))).toBe(true);
		const second = key(' ');
		expect(h.handleKeydown(second, at(0))).toBe(false);
		expect(second.defaultPrevented).toBe(false);
		expect(h.edits).toHaveLength(0);
	});

	// The claim is per child, not per surface: a windowed surface re-used for another empty
	// child owes that child its own completion.
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
