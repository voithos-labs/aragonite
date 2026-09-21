// @vitest-environment jsdom
//
// Modifiers on the caret-edge dispatch's CST-widget branch. The rule is that only a plain key at
// a caret edge comes here; the decoration branch enforces it (see its own suite), and
// reading only shiftKey would let Ctrl+ArrowLeft enter the widget instead of moving the caret,
// which for an image is modal, so the next printable key would replace the construct's bytes.
// Held at the dispatch's own decision, declined with the entry untouched, rather than through
// the state it would open.
import { describe, expect, it } from 'vitest';
import { asRawOffset } from '$lib/cursor/coordinate-spaces';
import { mountWidgetBlock } from './math-widget-fixture';
import { installEdgeDispatchCleanup, key, makeEdgeDispatch } from './edge-policy-fixture';

/** Mount [prose][atomic widget][prose] around `source`'s first widget of `kind` and
 *  wire the dispatch with a recording entry callback. */
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

	// Both entry directions and both key families this branch takes: navigation (word-step) and
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

	// Non-vacuity: the same key without the chord still enters the widget, so the
	// check narrows this branch rather than disabling it.
	it('the same key with no chord still enters the widget', () => {
		const b = mount('hello ![a](u) world', 'image');
		const e = key('ArrowLeft');

		expect(b.dispatch.handleKeydown(e, asRawOffset(b.widget.end))).toBe(true);
		expect(b.entered).toEqual([{ start: b.widget.start, fromTrailingEdge: true }]);
		expect(e.defaultPrevented).toBe(true);
	});

	// Shift is a separate rule: a shift-arrow extends a selection into the widget
	// through widget-interaction, so the edge branch declines it.
	it('Shift+ArrowLeft still declines, leaving the extend path to own it', () => {
		const b = mount('hello ![a](u) world', 'image');

		expect(
			b.dispatch.handleKeydown(key('ArrowLeft', { shiftKey: true }), asRawOffset(b.widget.end))
		).toBe(false);
		expect(b.entered).toEqual([]);
	});
});
