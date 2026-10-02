// @vitest-environment jsdom
// Three byte-writing branches that outrank rules they must respect: the decoration step-over
// delete and the insert beside a CST widget run above the construct delete and typing rules, and
// the marker-prefix delete consumes its keydown before any `beforeinput` reaches the join rules.
// Miss-analysis: those branches' suites used plain prose, never a hidden run beside the byte.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '$lib/schema/inline-construct-policy';
import { parse } from '$lib/core/parser';
import { asRawOffset } from '$lib/cursor/coordinate-spaces';
import { trimTrailingLineEnding } from '$lib/core/lines';
import type { CstNode } from '$lib/core/nodes';
import type { EdgeAffinity } from '$lib/cursor/edge-affinity';
import '$lib/schema/built-in-descriptors';
import {
	at,
	installEdgeDispatchCleanup,
	key,
	makeEdgeDispatch,
	mountIslandBlock,
	mountSurface,
	type EdgeDispatchHarness
} from './edge-policy-fixture';

interface Surface extends EdgeDispatchHarness {
	node: CstNode;
	el: HTMLElement;
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
	const el = mountSurface([], options.mode);
	return { node, el, ...wire(node, el, options) };
}

function wire(node: CstNode, el: HTMLElement, options: Options): EdgeDispatchHarness {
	return makeEdgeDispatch(node, el, {
		hasIslands: () => options.hasIslands ?? false,
		getRawSelection: () =>
			options.rawSelection
				? {
						start: asRawOffset(options.rawSelection.start),
						end: asRawOffset(options.rawSelection.end)
					}
				: null,
		getEdgeAffinity: () => options.affinity ?? null
	});
}

installEdgeDispatchCleanup();

// ── The decoration step-over delete ──────────────────────────────────────────

/** `[text][zero-width widget][text]`, the shape a plugin's widget decoration draws. */
function withWidgetIsland(source: string, mode: string, islandAt: number): Surface {
	const { node, el } = mountIslandBlock(source, islandAt, islandAt, mode);
	return { node, el, ...wire(node, el, { mode, hasIslands: true }) };
}

describe('a step-over widget beside an unpainted run defers to the construct-edge rule', () => {
	// The widget sits just inside `**`, so the raw byte behind the caret is a delimiter the user
	// never saw. The rule takes the neighbouring content character instead (live-mode.md § 4.4).
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

	// Source mode draws the delimiters, so the byte behind the caret is one the user is looking
	// at and the widget's own splice is already right.
	it('keeps the raw neighbour splice where the markers paint', () => {
		const s = withWidgetIsland('x**bold** y\n', 'source', 3);
		expect(s.handleKeydown(key('Backspace'), at(3))).toBe(true);
		// Undo puts the caret back where the key found it, as the construct-edge rule's does.
		expect(s.edits).toEqual([[0, 'x*bold** y\n', 3, 2]]);
	});
});

// ── The marker-prefix range delete ───────────────────────────────────────────

/** `[md-marker][content]`, a list item's prose child, with the selection reaching into the
 *  marker: the shape that fires no `beforeinput` at all. */
function withAmbientSelection(source: string, mode: string, range: { start: number; end: number }) {
	const s = surface(source, { mode, ambientLength: 2, rawSelection: range });
	const marker = document.createElement('span');
	marker.className = 'md-marker';
	marker.setAttribute('contenteditable', 'false');
	marker.textContent = '- ';
	const text = document.createTextNode(trimTrailingLineEnding(s.node.raw));
	s.el.append(marker, text);
	const dom = document.createRange();
	dom.setStart(marker.firstChild!, 1);
	dom.setEnd(text, range.end);
	const sel = window.getSelection()!;
	sel.removeAllRanges();
	sel.addRange(dom);
	return s;
}

describe('the ambient-marker delete crosses the join', () => {
	beforeAll(() => registerLiveJoinSeamCleaner(cleanLiveJoinSeam));
	afterAll(() => __resetLiveJoinSeamCleanerForTests());

	// The selection ends inside `**a b**`, so a literal splice strands the closer and shows it.
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

describe('the widget printable insert asks the typing caret position', () => {
	/** `**a&copy;** t` with an element-level caret between the entity widget and the closing run,
	 *  where Chromium drops the key and this branch writes it through the CST instead. */
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

	it('writes at the caret position the arrival names, not at the caret', () => {
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
