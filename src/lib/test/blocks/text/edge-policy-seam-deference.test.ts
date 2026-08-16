// @vitest-environment jsdom
//
// Three byte-writing arms that outrank the seam owning their rule: the island step-over delete and
// the widget printable insert sit ABOVE construct-edge-delete and the typing seat, and the ambient
// delete consumes its keydown before any `beforeinput` reaches the join seam.
// Miss-analysis: these arms' suites feed them plain prose, so no fixture put an unpainted run
// beside the byte they splice; and a keydown-consuming arm is invisible to inputType-shaped suites.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	createEdgePolicyDispatch,
	type EdgePolicyDispatchDeps
} from '$lib/components/blocks/text/edge-policy-dispatch';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '$lib/schema/inline-construct-policy';
import { parse } from '$lib/core/parser';
import { asRawOffset, type RawOffset } from '$lib/cursor/coordinate-spaces';
import type { BlockEditActions } from '$lib/action-contracts';
import type { CstNode } from '$lib/core/nodes';
import type { EdgeAffinity } from '$lib/cursor/edge-affinity';
import { makePendingMarks } from '$lib/test/harness/editor-actions';
import '$lib/schema/built-in-descriptors';

type Edit = [number, string, number, number];

interface Surface {
	node: CstNode;
	el: HTMLElement;
	edits: Edit[];
	handleKeydown: ReturnType<typeof createEdgePolicyDispatch>['handleKeydown'];
}

interface Options {
	mode: string;
	affinity?: EdgeAffinity;
	ambientLength?: number;
	rawSelection?: { start: number; end: number };
	hasIslands?: boolean;
}

/** One prose block under a presentation root; the caller fills `el` with the shape it needs. */
function surface(source: string, options: Options): Surface {
	const node: CstNode = parse(source).children[0];
	const root = document.createElement('div');
	root.setAttribute('data-presentation', options.mode);
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	root.appendChild(el);
	document.body.appendChild(root);

	const edits: Edit[] = [];
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
		getAmbientLength: () => options.ambientLength ?? 0,
		hasIslands: () => options.hasIslands ?? false,
		getRawSelection: () =>
			options.rawSelection
				? {
						start: asRawOffset(options.rawSelection.start),
						end: asRawOffset(options.rawSelection.end)
					}
				: null,
		blockEdit: {
			updateBlockContent: (...args: unknown[]) => void edits.push(args as Edit)
		} as unknown as BlockEditActions,
		setPendingCursor: () => {},
		setSnapTarget: () => {},
		isRevealing: () => false,
		enterWidget: () => {},
		isReading: () => false,
		getEdgeAffinity: () => options.affinity ?? null,
		pendingMarks: makePendingMarks(),
		installedAs: 'block'
	};
	return { node, el, edits, handleKeydown: createEdgePolicyDispatch(deps).handleKeydown };
}

const key = (name: string) => new KeyboardEvent('keydown', { key: name, cancelable: true });
const at = (offset: number) => asRawOffset(offset) as RawOffset;
const display = (node: CstNode) => node.raw.replace(/\n$/, '');

afterEach(() => {
	document.body.innerHTML = '';
	window.getSelection()?.removeAllRanges();
});

// ── The island step-over delete ──────────────────────────────────────────────

/** `[text][zero-width island][text]` — the shape a plugin widget decoration paints. */
function withWidgetIsland(source: string, mode: string, islandAt: number): Surface {
	const s = surface(source, { mode, hasIslands: true });
	const text = display(s.node);
	const island = document.createElement('span');
	island.dataset.decorationIsland = '';
	island.dataset.sourceStart = String(islandAt);
	island.dataset.sourceEnd = String(islandAt);
	island.setAttribute('contenteditable', 'false');
	s.el.append(document.createTextNode(text.slice(0, islandAt)), island);
	s.el.append(document.createTextNode(text.slice(islandAt)));
	return s;
}

describe('a step-over island beside an unpainted run defers to the construct-edge rule', () => {
	// The island sits just inside `**`, so the raw byte behind the caret is a delimiter the reader
	// never saw. The rule takes the adjacent CONTENT character instead (live-mode.md § 4.4).
	it('Backspace takes the content character, not the delimiter byte', () => {
		const s = withWidgetIsland('x**bold** y\n', 'live', 3);
		const e = key('Backspace');
		expect(s.handleKeydown(e, at(3))).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(s.edits).toEqual([[0, '**bold** y\n', 3, 0]]);
	});

	it('Delete takes the content character on the other side', () => {
		const s = withWidgetIsland('x **bold**y\n', 'live', 8);
		expect(s.handleKeydown(key('Delete'), at(8))).toBe(true);
		expect(s.edits).toEqual([[0, 'x **bold**\n', 8, 8]]);
	});

	// Source paints the delimiters, so the byte behind the caret is one the reader is looking at
	// and the island's own splice is already honest.
	it('keeps the raw neighbour splice where the markers paint', () => {
		const s = withWidgetIsland('x**bold** y\n', 'source', 3);
		expect(s.handleKeydown(key('Backspace'), at(3))).toBe(true);
		expect(s.edits).toEqual([[0, 'x*bold** y\n', 2, 2]]);
	});
});

// ── The ambient-marker range delete ──────────────────────────────────────────

/** `[md-marker][content]`, the ambient-prefixed prose child of a list item, with the selection
 *  reaching into the marker — the shape that fires no `beforeinput` at all. */
function withAmbientSelection(source: string, mode: string, range: { start: number; end: number }) {
	const s = surface(source, { mode, ambientLength: 2, rawSelection: range });
	const marker = document.createElement('span');
	marker.className = 'md-marker';
	marker.setAttribute('contenteditable', 'false');
	marker.textContent = '- ';
	const text = document.createTextNode(display(s.node));
	s.el.append(marker, text);
	const dom = document.createRange();
	dom.setStart(marker.firstChild!, 1);
	dom.setEnd(text, range.end);
	const sel = window.getSelection()!;
	sel.removeAllRanges();
	sel.addRange(dom);
	return s;
}

describe('the ambient-marker delete crosses the join seam', () => {
	beforeAll(() => registerLiveJoinSeamCleaner(cleanLiveJoinSeam));
	afterAll(() => __resetLiveJoinSeamCleanerForTests());

	// The selection ends inside `**a b**`, so a literal splice strands the closer and paints it.
	it('drops the run the cut stranded instead of splicing raw bytes', () => {
		const s = withAmbientSelection('**a b** c\n', 'live', { start: 0, end: 5 });
		const e = key('Backspace');
		expect(s.handleKeydown(e, at(5))).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(s.edits).toEqual([[0, ' c\n', 0, 0]]);
	});

	it('keeps the literal splice where the markers paint', () => {
		const s = withAmbientSelection('**a b** c\n', 'source', { start: 0, end: 5 });
		expect(s.handleKeydown(key('Backspace'), at(5))).toBe(true);
		expect(s.edits).toEqual([[0, '** c\n', 0, 0]]);
	});
});

// ── The widget printable insert ──────────────────────────────────────────────

describe('the widget printable insert asks the typing seat', () => {
	/** `**a&copy;** t` with an element-level caret between the entity widget and the closing run —
	 *  where Chromium drops the key and this arm writes it through the CST instead. */
	function withElementCaret(mode: string): Surface {
		const s = surface('**a&copy;** t\n', { mode, affinity: 'far' });
		const widget = document.createElement('span');
		widget.dataset.inlineWidget = '';
		widget.textContent = '©';
		s.el.append(document.createTextNode('**a'), widget, document.createTextNode('** t'));
		const dom = document.createRange();
		dom.setStart(s.el, 2);
		dom.collapse(true);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(dom);
		return s;
	}

	it('writes at the seat the arrival names, not at the caret', () => {
		const s = withElementCaret('live');
		const e = key('.');
		expect(s.handleKeydown(e, at(9))).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(s.edits).toEqual([[0, '**a&copy;**. t\n', 9, 12]]);
	});

	it('writes at the caret where no unpainted run is touched', () => {
		const s = withElementCaret('source');
		expect(s.handleKeydown(key('.'), at(9))).toBe(true);
		expect(s.edits).toEqual([[0, '**a&copy;.** t\n', 9, 10]]);
	});
});
