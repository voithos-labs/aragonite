// @vitest-environment jsdom
//
// The caret-edge dispatch's decoration-widget branch (edge-policy-dispatch). It holds two rules
// e2e cannot: modifier chords such as word-delete stay with the browser, since these rules take
// only plain edge keys, and a printable key at an element-level caret becomes a CST edit, which
// ordinary typing can mask byte for byte in a real browser. A third group holds the precedence a
// user can see: a CST widget wins the shared caret edge over a decoration widget.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWidgetSelectionState } from '$lib/components/image/widget-selection-state.svelte';
import { parse } from '$lib/core/parser';
import { computeInlineContent } from '$lib/core/inline';
import { asRawOffset } from '$lib/cursor/coordinate-spaces';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '$lib/perf/instruments';
import type { InlineNode } from '$lib/core/nodes';
import {
	caretAfter,
	decorationIsland,
	installEdgeDispatchCleanup,
	key,
	makeEdgeDispatch,
	mountIslandBlock,
	mountSurface,
	type EdgeDispatchHarness
} from './edge-policy-fixture';

interface Harness extends EdgeDispatchHarness {
	island: HTMLElement;
}

/** A block with a decoration widget wired to the dispatch: no CST widget, no shown source,
 *  editing mode. `hasIslands` defaults to true; the scan tests pass false for the early return. */
function mount(source: string, start: number, end: number, hasIslands = true): Harness {
	const { node, el, island } = mountIslandBlock(source, start, end);
	return { ...makeEdgeDispatch(node, el, { hasIslands: () => hasIslands }), island };
}

installEdgeDispatchCleanup();

describe('modifier chords stay native near widgets', () => {
	const chords: Partial<KeyboardEvent>[] = [{ ctrlKey: true }, { altKey: true }, { metaKey: true }];

	it.each(chords)('%o+Backspace at a replace island trailing edge is not consumed', (mods) => {
		const h = mount('abHIDDENcd\n', 2, 8);
		const e = key('Backspace', mods);
		expect(h.handleKeydown(e, asRawOffset(8))).toBe(false);
		expect(e.defaultPrevented).toBe(false);
		expect(h.edits).toHaveLength(0);
	});

	it('Ctrl+Delete at a replace decoration leading edge is not consumed', () => {
		const h = mount('abHIDDENcd\n', 2, 8);
		const e = key('Delete', { ctrlKey: true });
		expect(h.handleKeydown(e, asRawOffset(2))).toBe(false);
		expect(e.defaultPrevented).toBe(false);
	});

	it('Ctrl+Backspace at a widget decoration is not consumed (native word-delete)', () => {
		const h = mount('hello\n', 3, 3);
		const e = key('Backspace', { ctrlKey: true });
		expect(h.handleKeydown(e, asRawOffset(3))).toBe(false);
		expect(e.defaultPrevented).toBe(false);
		expect(h.edits).toHaveLength(0);
	});

	it('plain Backspace at the trailing edge still selects the widget whole', () => {
		const h = mount('abHIDDENcd\n', 2, 8);
		const e = key('Backspace');
		expect(h.handleKeydown(e, asRawOffset(8))).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		const selected = window.getSelection()!.getRangeAt(0).cloneContents();
		expect(selected.querySelector('[data-decoration-island]')).not.toBeNull();
	});
});

describe('typing at an element-level caret against a widget decoration', () => {
	it('consumes the key and inserts at the raw offset through one CST edit', () => {
		const h = mount('hello\n', 5, 5);
		caretAfter(h.island);
		const e = key('z');
		expect(h.handleKeydown(e, asRawOffset(5))).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(h.edits).toEqual([[0, 'helloz\n', 5, 6]]);
	});

	it('leaves a text-node caret to native typing', () => {
		const h = mount('hello\n', 5, 5);
		const textNode = h.island.previousSibling as Text;
		const range = document.createRange();
		range.setStart(textNode, 5);
		range.collapse(true);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);

		const e = key('z');
		expect(h.handleKeydown(e, asRawOffset(5))).toBe(false);
		expect(e.defaultPrevented).toBe(false);
	});
});

// ── Precedence: a CST widget wins the shared caret edge ───────────────────────

describe('a CST widget outranks a decoration widget at the same caret edge', () => {
	it('Backspace at an offset both claim enters the widget, never selects the widget', () => {
		// `a![c](x)`: the image widget occupies raw 1..8 and the decoration ends at 8 too.
		// The dispatch tries the widget class first, so its select-then-delete wins.
		const node = parse('a![c](x)\n').children[0];
		const image = computeInlineContent(node).find((n: InlineNode) => n.kind === 'image')!;
		const el = mountSurface([document.createTextNode('a![c]('), decorationIsland(6, image.end)]);
		window.getSelection()?.removeAllRanges();

		const widgetSelection = createWidgetSelectionState({ onSelect: () => {} });
		const h = makeEdgeDispatch(node, el, {
			hasIslands: () => true,
			enterWidget: (widget, fromTrailingEdge) =>
				widgetSelection.select({
					paragraphPath: [0],
					sourceStart: widget.start,
					preSelectOffset: fromTrailingEdge ? widget.end : widget.start
				})
		});

		expect(h.handleKeydown(key('Backspace'), asRawOffset(image.end))).toBe(true);
		expect(widgetSelection.getSelected()).toMatchObject({ sourceStart: image.start });
		// The decoration's select-whole never ran: no browser range wraps it, and no edit fired.
		expect(h.edits).toHaveLength(0);
		expect(window.getSelection()!.rangeCount).toBe(0);
	});
});

// ── The per-keystroke DOM scan runs only where a decoration exists ────────────

describe('widget-free typing skips the DOM scan', () => {
	beforeEach(() => {
		resetPerfInstruments();
		enablePerfInstruments();
	});
	afterEach(() => disablePerfInstruments());

	// A plain paragraph with a text-node caret and no decoration span: the common block.
	function plainBlock(): HTMLElement {
		const el = mountSurface([document.createTextNode('hello')]);
		const range = document.createRange();
		range.setStart(el.firstChild!, 3);
		range.collapse(true);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);
		return el;
	}

	it('a printable keydown runs zero DOM scans when the block has no widgets', () => {
		const node = parse('hello\n').children[0];
		const dispatch = makeEdgeDispatch(node, plainBlock());
		expect(dispatch.handleKeydown(key('z'), asRawOffset(3))).toBe(false);
		expect(perfSnapshot().islandKeyScans).toBe(0);
	});

	it('a block that carries widgets still scans (the gate does not over-suppress)', () => {
		const h = mount('abHIDDENcd\n', 2, 8);
		h.handleKeydown(key('Backspace'), asRawOffset(8));
		expect(perfSnapshot().islandKeyScans).toBeGreaterThanOrEqual(1);
	});
});
