// @vitest-environment jsdom
//
// A plain edit key over a held RANGE. The dispatch reads the range's START as its caret, so the
// arms that answer for the construct beside a caret would answer for the island a widget-led block
// opens with. Miss-analysis: every ranged-edit test selected a range starting on prose and every
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

/** The whole surface selected, the shape Ctrl+A and a triple-click both paint: the range starts
 *  at the ELEMENT, so no text node fronts it. */
function selectWholeSurface(el: HTMLElement): void {
	const range = document.createRange();
	range.selectNodeContents(el);
	const sel = window.getSelection()!;
	sel.removeAllRanges();
	sel.addRange(range);
}

/** A block whose first inline node is a widget: `&copy;` deletes atomically and steps over,
 *  `![a](u)` selects then deletes — the two edge policies a leading island can carry. */
function mountWidgetLed(
	source: string,
	ranged: boolean
): EdgeDispatchHarness & { entered: number[] } {
	const node = parse(source).children[0];
	const display = trimTrailingLineEnding(node.raw);
	const el = mountSurface(display);
	selectWholeSurface(el);
	const entered: number[] = [];
	const harness = makeEdgeDispatch(node, el, {
		enterWidget: (widget) => entered.push(widget.start),
		getRawSelection: () =>
			ranged ? { start: asRawOffset(0), end: asRawOffset(display.length) } : null
	});
	return { ...harness, entered };
}

const ENTITY_LED = '&copy; opens\n';
const IMAGE_LED = '![a](u) opens\n';

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
		['an entity-led block, Delete', ENTITY_LED, 'Delete'],
		['an image-led block, Delete', IMAGE_LED, 'Delete'],
		['an image-led block, ArrowRight', IMAGE_LED, 'ArrowRight']
	])('%s: the key falls to the range, never entering the widget', (_case, source, name) => {
		const h = mountWidgetLed(source, true);
		const e = key(name);
		expect(h.handleKeydown(e, at(0))).toBe(false);
		expect(e.defaultPrevented).toBe(false);
		expect(h.entered).toEqual([]);
		expect(h.edits).toEqual([]);
	});

	// The collapsed counterparts, so the rule above reads as "the range wins" rather than "the
	// widget arm stopped answering".
	it('still takes the entity whole on Delete at a collapsed caret', () => {
		const h = mountWidgetLed(ENTITY_LED, false);
		expect(h.handleKeydown(key('Delete'), at(0))).toBe(true);
		expect(h.edits).toEqual([[0, ' opens\n', 0, 0]]);
	});

	it('still selects the image on ArrowRight at a collapsed caret', () => {
		const h = mountWidgetLed(IMAGE_LED, false);
		expect(h.handleKeydown(key('ArrowRight'), at(0))).toBe(true);
		expect(h.entered).toEqual([0]);
	});
});

describe('a key over a range that opens with a decoration island', () => {
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
