// @vitest-environment jsdom
//
// The caret-edge dispatch's toggle seat. A collapsed-caret chord in live mode writes no bytes;
// it pends a mark, and the FIRST printable key after it carries that mark into the CST as one
// commit. This is the level where the promise is spent — the pure rewrite is pinned in
// pending-mark-insert.test.ts, and this pins that the arm claims the key, spends the set
// exactly once, and outranks the arrival side the seat below would have read.
import { afterEach, describe, expect, it } from 'vitest';
import {
	createEdgePolicyDispatch,
	type EdgePolicyDispatchDeps
} from '$lib/components/blocks/text/edge-policy-dispatch';
import { parse } from '$lib/core/parser';
import { asRawOffset, type RawOffset } from '$lib/cursor/coordinate-spaces';
import type { EdgeAffinity } from '$lib/cursor/edge-affinity';
import type { InlineMarkKind, PendingMarksState } from '$lib/cursor/pending-marks';
import type { BlockEditActions } from '$lib/action-contracts';
import type { CstNode } from '$lib/core/nodes';
import { makePendingMarks } from '$lib/test/harness/editor-actions';

interface Harness {
	handleKeydown: ReturnType<typeof createEdgePolicyDispatch>['handleKeydown'];
	/** `updateBlockContent` argument tuples, newest last. */
	edits: [number, string, number, number][];
	marks: PendingMarksState;
}

function mount(
	source: string,
	pending: InlineMarkKind[],
	{
		affinity = null,
		isReading = false
	}: { affinity?: EdgeAffinity | null; isReading?: boolean } = {}
): Harness {
	const node: CstNode = parse(source).children[0];
	const root = document.createElement('div');
	root.setAttribute('data-presentation', 'live');
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	el.textContent = node.raw.replace(/\n$/, '');
	root.appendChild(el);
	document.body.appendChild(root);

	const edits: Harness['edits'] = [];
	const marks = makePendingMarks(...pending);
	const deps: EdgePolicyDispatchDeps = {
		get node() {
			return node;
		},
		get index() {
			return 0;
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
		isReading: () => isReading,
		getEdgeAffinity: () => affinity,
		pendingMarks: marks
	};
	return { handleKeydown: createEdgePolicyDispatch(deps).handleKeydown, edits, marks };
}

const key = (name: string, modifiers: Partial<KeyboardEvent> = {}) =>
	new KeyboardEvent('keydown', { key: name, cancelable: true, ...modifiers });

const at = (offset: number) => asRawOffset(offset) as RawOffset;

afterEach(() => {
	document.body.innerHTML = '';
	window.getSelection()?.removeAllRanges();
});

describe('the first byte after a chord carries the mark', () => {
	it('wraps the byte and anchors the undo entry at the pre-toggle caret', () => {
		const h = mount('hi\n', ['strong']);
		const e = key('X');

		expect(h.handleKeydown(e, at(2))).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(h.edits).toEqual([[0, 'hi**X**\n', 2, 5]]);
	});

	it('spends the set exactly once — the second byte types plain', () => {
		const h = mount('hi\n', ['strong']);
		h.handleKeydown(key('X'), at(2));

		expect(h.marks.get()).toBeNull();
		expect(h.handleKeydown(key('Y'), at(5))).toBe(false);
		expect(h.edits).toHaveLength(1);
	});

	it('carries two marks into one insertion', () => {
		const h = mount('hi\n', ['strong', 'emphasis']);
		expect(h.handleKeydown(key('X'), at(2))).toBe(true);
		expect(h.edits).toEqual([[0, 'hi***X***\n', 2, 6]]);
	});

	// The chain already carries strong at this caret, so the mark REMOVES: the byte escapes the
	// construct rather than wrapping in a second pair.
	it('escapes the construct when the chain already carries the mark', () => {
		const h = mount('Some **bold** text\n', ['strong']);
		expect(h.handleKeydown(key('X'), at(9))).toBe(true);
		expect(h.edits).toEqual([[0, 'Some **bo**X**ld** text\n', 9, 12]]);
	});
});

describe('a pending mark outranks every arrival rule', () => {
	// Offset 11 is bold's trailing content edge with the far side on record — the typing seat
	// would write past the closer. The mark says otherwise, and wins (live-mode.md § 4.2).
	it('beats the typing seat at a construct edge', () => {
		const h = mount('Some **bold** text\n', ['emphasis'], { affinity: 'far' });
		expect(h.handleKeydown(key('X'), at(11))).toBe(true);
		expect(h.edits).toEqual([[0, 'Some **bold*X*** text\n', 11, 13]]);
	});

	it('leaves the seat in charge once the set is spent', () => {
		const h = mount('Some **bold** text\n', ['emphasis'], { affinity: 'far' });
		h.handleKeydown(key('X'), at(11));
		h.edits.length = 0;

		expect(h.handleKeydown(key('Y'), at(11))).toBe(true);
		expect(h.edits).toEqual([[0, 'Some **bold**Y text\n', 11, 14]]);
	});
});

describe('the toggle seat claims only a plain byte at a collapsed caret', () => {
	it('declines with nothing pending, whatever the key', () => {
		const h = mount('hi\n', []);
		expect(h.handleKeydown(key('X'), at(2))).toBe(false);
		expect(h.edits).toHaveLength(0);
	});

	it('declines a chord, which is a command rather than a typed byte', () => {
		const h = mount('hi\n', ['strong']);
		for (const mods of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
			expect(h.handleKeydown(key('X', mods), at(2))).toBe(false);
		}
		// Declining a chord must not spend the set — Mod+I after Mod+B pends both.
		expect(h.marks.get()).not.toBeNull();
	});

	it('declines a non-printable key and keeps the set for the byte that follows', () => {
		const h = mount('hi\n', ['strong']);
		for (const name of ['Enter', 'Tab', 'ArrowLeft', 'Backspace']) {
			expect(h.handleKeydown(key(name), at(2))).toBe(false);
		}
		expect(h.marks.get()).not.toBeNull();
	});

	it('declines a null caret', () => {
		const h = mount('hi\n', ['strong']);
		expect(h.handleKeydown(key('X'), null)).toBe(false);
	});

	it('declines in reading mode, which commits nothing', () => {
		const h = mount('hi\n', ['strong'], { isReading: true });
		expect(h.handleKeydown(key('X'), at(2))).toBe(false);
		expect(h.edits).toHaveLength(0);
	});
});
