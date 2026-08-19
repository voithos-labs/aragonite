// @vitest-environment jsdom
//
// Modifier parity on the caret-edge dispatch's CST-widget arm. The contract is "one PLAIN key at
// a caret edge routes here"; the island arm enforces it (edge-policy-islands.test.ts) and this arm
// read only shiftKey, so Ctrl+ArrowLeft entered the widget instead of moving the caret — modal for
// an image, so the next printable key replaced the construct's bytes. Pinned at the dispatch's own
// decision (declined, entry seam untouched) rather than through the modal state it would open.
import { describe, expect, it } from 'vitest';
import { asRawOffset } from '$lib/cursor/coordinate-spaces';
import { mountWidgetBlock } from './math-widget-fixture';
import { installEdgeDispatchCleanup, key, makeEdgeDispatch } from './edge-policy-fixture';

/** Mount [prose][atomic island][prose] around `source`'s first widget of `kind` and
 *  wire the dispatch with a recording entry seam. */
function mount(source: string, kind: string) {
	const { node, el, inlineWidgets } = mountWidgetBlock(source, kind);
	const entered: { start: number; fromTrailingEdge: boolean }[] = [];
	const { dispatch, edits } = makeEdgeDispatch(node, el, {
		enterWidget: (w, fromTrailingEdge) => entered.push({ start: w.start, fromTrailingEdge })
	});
	return { dispatch, widget: inlineWidgets[0], entered, edits };
}

installEdgeDispatchCleanup();

describe('a modifier chord at a widget edge is not a widget entry', () => {
	const chords: Partial<KeyboardEvent>[] = [{ ctrlKey: true }, { metaKey: true }, { altKey: true }];

	// Both entry directions and both key families the arm claims: navigation (word-step) and
	// destructive (word-delete). Each is a platform chord meaning "act on a word".
	for (const [label, keyName, side] of [
		['ArrowLeft at the trailing edge', 'ArrowLeft', 'end'],
		['Backspace at the trailing edge', 'Backspace', 'end'],
		['ArrowRight at the leading edge', 'ArrowRight', 'start'],
		['Delete at the leading edge', 'Delete', 'start']
	] as const) {
		it.each(chords)(`${label} with %o stays native`, (mods) => {
			const b = mount('hello ![a](u) world', 'image');
			const offset = asRawOffset(side === 'end' ? b.widget.end : b.widget.start);
			const e = key(keyName, mods);

			expect(b.dispatch.handleKeydown(e, offset)).toBe(false);
			expect(b.entered).toEqual([]);
			expect(e.defaultPrevented).toBe(false);
			expect(b.edits).toEqual([]);
		});
	}

	// Non-vacuity: the same key without the chord is still the widget entry, so the
	// guard narrows the arm rather than disabling it.
	it('the same key with no chord still enters the widget', () => {
		const b = mount('hello ![a](u) world', 'image');
		const e = key('ArrowLeft');

		expect(b.dispatch.handleKeydown(e, asRawOffset(b.widget.end))).toBe(true);
		expect(b.entered).toEqual([{ start: b.widget.start, fromTrailingEdge: true }]);
		expect(e.defaultPrevented).toBe(true);
	});

	// Shift is the separate, older rule: a shift-arrow extends a selection into the
	// widget through widget-interaction, so the edge arm has always declined it.
	it('Shift+ArrowLeft still declines, leaving the extend seam to own it', () => {
		const b = mount('hello ![a](u) world', 'image');

		expect(
			b.dispatch.handleKeydown(key('ArrowLeft', { shiftKey: true }), asRawOffset(b.widget.end))
		).toBe(false);
		expect(b.entered).toEqual([]);
	});
});
