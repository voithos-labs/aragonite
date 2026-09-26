// @vitest-environment jsdom
//
// A plain edit key over a selected range. The dispatch reads the range's start as its caret, so
// the branches that answer for the construct beside a caret would answer for the widget a
// widget-led block starts with. Miss-analysis: every range test selected from prose and every
// widget-edge test pressed at a collapsed caret, so nothing crossed the two.
import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { trimTrailingLineEnding } from '$lib/core/lines';
import { asRawOffset } from '$lib/cursor/coordinate-spaces';
import {
	at,
	installEdgeDispatchCleanup,
	key,
	makeEdgeDispatch,
	mountIslandBlock,
	mountSurface,
	type EdgeDispatchHarness
} from './edge-policy-fixture';

/** The whole block selected, the shape Ctrl+A and a triple-click both make: the range starts at
 *  the element, so no text node comes before it. */
function selectWholeSurface(el: HTMLElement): void {
	const range = document.createRange();
	range.selectNodeContents(el);
	const sel = window.getSelection()!;
	sel.removeAllRanges();
	sel.addRange(range);
}

/**
 * A block whose first inline node is a widget: `&copy;` deletes atomically and steps over,
 * `![a](u)` selects then deletes, the two edge policies a leading widget can carry. `ranged`
 * selects from `from` to the end of the displayed text.
 */
function mountWidgetLed(
	source: string,
	ranged: boolean,
	from = 0
): EdgeDispatchHarness & { entered: number[] } {
	const node = parse(source).children[0];
	const display = trimTrailingLineEnding(node.raw);
	const el = mountSurface(display);
	selectWholeSurface(el);
	const entered: number[] = [];
	const harness = makeEdgeDispatch(node, el, {
		enterWidget: (widget) => entered.push(widget.start),
		getRawSelection: () =>
			ranged ? { start: asRawOffset(from), end: asRawOffset(display.length) } : null
	});
	return { ...harness, entered };
}

const ENTITY_LED = '&copy; opens\n';
const IMAGE_LED = '![a](u) opens\n';
/** `&copy;`'s trailing edge: a range opening there is the widget's other caret-adjacent side. */
const ENTITY_END = 6;

installEdgeDispatchCleanup();

describe('a key over a range that opens with a CST widget', () => {
	it('replaces the range with the typed character, through one CST edit', () => {
		const h = mountWidgetLed(ENTITY_LED, true);
		const e = key('z');
		expect(h.handleKeydown(e, at(0))).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(h.edits).toEqual([[0, 'z\n', 0, 1]]);
	});

	it.each([
		['an entity-led block, Delete', ENTITY_LED, 'Delete', 0],
		['an image-led block, Delete', IMAGE_LED, 'Delete', 0],
		['an image-led block, ArrowRight', IMAGE_LED, 'ArrowRight', 0],
		['a range opening at an entity’s trailing edge, Backspace', ENTITY_LED, 'Backspace', ENTITY_END]
	])('%s: the key falls to the range, never entering the widget', (_case, source, name, from) => {
		const h = mountWidgetLed(source, true, from);
		const e = key(name);
		expect(h.handleKeydown(e, at(from))).toBe(false);
		expect(e.defaultPrevented).toBe(false);
		expect(h.entered).toEqual([]);
		expect(h.edits).toEqual([]);
	});

	// The collapsed counterparts, so the rule above reads as "the range wins" rather than "the
	// widget branch stopped answering".
	it('still takes the entity whole on Delete at a collapsed caret', () => {
		const h = mountWidgetLed(ENTITY_LED, false);
		expect(h.handleKeydown(key('Delete'), at(0))).toBe(true);
		expect(h.edits).toEqual([[0, ' opens\n', 0, 0]]);
	});

	it('still takes the entity whole on Backspace at its trailing edge', () => {
		const h = mountWidgetLed(ENTITY_LED, false);
		expect(h.handleKeydown(key('Backspace'), at(ENTITY_END))).toBe(true);
		expect(h.edits).toEqual([[0, ' opens\n', ENTITY_END, 0]]);
	});

	it('still selects the image on ArrowRight at a collapsed caret', () => {
		const h = mountWidgetLed(IMAGE_LED, false);
		expect(h.handleKeydown(key('ArrowRight'), at(0))).toBe(true);
		expect(h.entered).toEqual([0]);
	});
});

describe('a key over a range that opens with a decoration widget', () => {
	it('replaces the range with the typed character', () => {
		const { node, el } = mountIslandBlock('hello\n', 0, 0);
		selectWholeSurface(el);
		const h = makeEdgeDispatch(node, el, {
			hasIslands: () => true,
			getRawSelection: () => ({ start: asRawOffset(0), end: asRawOffset(5) })
		});
		const e = key('z');
		expect(h.handleKeydown(e, at(0))).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(h.edits).toEqual([[0, 'z\n', 0, 1]]);
	});
});

/** `[marker][text]`, the shape a list item's prose child renders, with a selection across the
 *  marker only: non-collapsed to the DOM, empty once clamped into this block's content. */
function mountMarkerLed(clamped: boolean): EdgeDispatchHarness & { entered: number[] } {
	const node = parse(ENTITY_LED).children[0];
	const marker = document.createElement('span');
	marker.className = 'md-marker';
	marker.setAttribute('contenteditable', 'false');
	marker.textContent = '- ';
	const text = document.createTextNode(trimTrailingLineEnding(node.raw));
	const el = mountSurface([marker, text]);

	const range = document.createRange();
	if (clamped) {
		range.setStart(marker.firstChild!, 0);
		range.setEnd(marker.firstChild!, 2);
	} else {
		range.setStart(text, 0);
		range.collapse(true);
	}
	const sel = window.getSelection()!;
	sel.removeAllRanges();
	sel.addRange(range);

	const entered: number[] = [];
	const harness = makeEdgeDispatch(node, el, {
		enterWidget: (widget) => entered.push(widget.start),
		getRawSelection: () => (clamped ? { start: asRawOffset(0), end: asRawOffset(0) } : null)
	});
	return { ...harness, entered };
}

// Miss-analysis: the two readings of "a range is held" were never put under one selection, so a
// shape that is a range to one and a caret to the other had no test to disagree in.
describe('a range whose ends both clamp into the container marker prefix', () => {
	it('every branch reads it as a range: the leading entity survives the key', () => {
		const h = mountMarkerLed(true);
		expect(h.handleKeydown(key('Delete'), at(0))).toBe(true);
		expect(h.entered).toEqual([]);
		expect(h.edits).toEqual([]);
	});

	// The collapsed counterpart, so the rule above reads as "the range wins" rather than "the
	// widget branch stopped answering".
	it('still takes the entity whole at a collapsed caret in the same block', () => {
		const h = mountMarkerLed(false);
		expect(h.handleKeydown(key('Delete'), at(0))).toBe(true);
		expect(h.edits).toEqual([[0, ' opens\n', 0, 0]]);
	});
});
