// @vitest-environment jsdom
//
// Backspace at the block's landable start is a block gesture (merge or inert), so the
// destructive edge arm must stand down there: an atomic run straddling the start — an escape's
// hidden backslash — would otherwise turn the press into a forward delete of the first visible
// glyph (GH #108).
// Miss-analysis: the arm's suite drove presses beside and inside constructs but never AT the
// landable start, the one offset where the press belongs to the block, not the construct.
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
	/** `updateBlockContent` argument tuples, newest last. */
	edits: [number, string, number, number][];
}

/** One live block whose DOM carries the marker spans the landable walk reads. */
function mount(source: string, parts: Node[]): Harness {
	const node: CstNode = parse(source).children[0];
	const root = document.createElement('div');
	root.setAttribute('data-presentation', 'live');
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	el.append(...parts);
	root.appendChild(el);
	document.body.appendChild(root);

	const edits: Harness['edits'] = [];
	const deps: EdgePolicyDispatchDeps = {
		get node() {
			return node;
		},
		get index() {
			return 0;
		},
		get containerParent() {
			return null;
		},
		get linkRef() {
			return undefined;
		},
		getEl: () => el,
		getAmbientLength: () => 0,
		hasIslands: () => false,
		getRawSelection: () => null,
		blockEdit: {
			updateBlockContent: (...args: unknown[]) => void edits.push(args as Harness['edits'][number])
		} as unknown as BlockEditActions,
		setPendingCursor: () => {},
		setSnapTarget: () => {},
		isRevealing: () => false,
		enterWidget: () => {},
		isReading: () => false,
		getEdgeAffinity: () => null,
		pendingMarks: makePendingMarks()
	};
	return { handleKeydown: createEdgePolicyDispatch(deps).handleKeydown, edits };
}

function marker(text: string): HTMLElement {
	const el = document.createElement('span');
	el.className = 'md-marker';
	el.textContent = text;
	return el;
}

const text = (s: string) => document.createTextNode(s);

/** `\*a\*` rendered live: the backslashes are hidden runs, so the landable start is 1. */
const mountEscapes = () =>
	mount('\\*a\\*\n', [marker('\\'), text('*'), text('a'), marker('\\'), text('*')]);

const key = (name: string) => new KeyboardEvent('keydown', { key: name, cancelable: true });
const at = (offset: number) => asRawOffset(offset) as RawOffset;

afterEach(() => {
	document.body.innerHTML = '';
	window.getSelection()?.removeAllRanges();
});

describe('the destructive arm at the block’s landable start', () => {
	it('declines Backspace at the landable start inside a leading escape', () => {
		const h = mountEscapes();
		expect(h.handleKeydown(key('Backspace'), at(1))).toBe(false);
		expect(h.edits).toHaveLength(0);
	});

	it('still takes the escape whole one step past the landable start', () => {
		const h = mountEscapes();
		expect(h.handleKeydown(key('Backspace'), at(2))).toBe(true);
		expect(h.edits).toEqual([[0, 'a\\*\n', 2, 0]]);
	});

	it('still claims Delete at the landable start — forward is a construct edit', () => {
		const h = mountEscapes();
		expect(h.handleKeydown(key('Delete'), at(1))).toBe(true);
		expect(h.edits).toEqual([[0, 'a\\*\n', 1, 0]]);
	});
});
