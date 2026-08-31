// @vitest-environment jsdom
//
// The caret-edge dispatch's ambient-marker branch (edge-policy-dispatch). A selection whose DOM
// range reaches into the contenteditable="false" ambient marker blocks native Backspace/Delete
// silently — no beforeinput fires — so the dispatch commits the delete through the CST instead.
// This branch lived inside the Svelte component and never had a unit test; the extraction lets
// one pin it at its own level (rules.md: dispatch layers get tests at their own level).
import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { asRawOffset } from '$lib/cursor/coordinate-spaces';
import { trimTrailingLineEnding } from '$lib/core/lines';
import {
	at,
	installEdgeDispatchCleanup,
	key,
	makeEdgeDispatch,
	mountSurface,
	type EdgeDispatchHarness
} from './edge-policy-fixture';

interface Harness extends EdgeDispatchHarness {
	text: Text;
	marker: HTMLElement;
}

/** Mount `[md-marker][content]` — the shape a list item's ambient-prefixed prose child renders.
 *  `rawSelection` is the content range the (mocked) DOM→raw walk yields. */
function mount(source: string, rawSelection: { start: number; end: number } | null): Harness {
	const node = parse(source).children[0];

	const marker = document.createElement('span');
	marker.className = 'md-marker';
	marker.setAttribute('contenteditable', 'false');
	marker.textContent = '- ';
	const text = document.createTextNode(trimTrailingLineEnding(node.raw));
	const el = mountSurface([marker, text]);

	const harness = makeEdgeDispatch(node, el, {
		getAmbientLength: () => marker.textContent!.length,
		getRawSelection: () =>
			rawSelection && {
				start: asRawOffset(rawSelection.start),
				end: asRawOffset(rawSelection.end)
			}
	});
	return { ...harness, text, marker };
}

/** Select from `anchor` to `focus`; endpoints are (node, offset). */
function select(anchor: [Node, number], focus: [Node, number]): void {
	const range = document.createRange();
	range.setStart(anchor[0], anchor[1]);
	range.setEnd(focus[0], focus[1]);
	const sel = window.getSelection()!;
	sel.removeAllRanges();
	sel.addRange(range);
}

installEdgeDispatchCleanup();

describe('ambient-marker selection delete', () => {
	it('Backspace over a selection reaching into the marker deletes the range via the CST', () => {
		const h = mount('abcd\n', { start: 0, end: 2 });
		// Anchor inside the marker, focus after two content chars — the shape a
		// leftward shift-select from the content into the prefix produces.
		select([h.marker.firstChild!, 1], [h.text, 2]);

		const e = key('Backspace');
		expect(h.handleKeydown(e, at(2))).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(h.edits).toEqual([[0, 'cd\n', 0, 0]]);
	});

	it('Delete over the same marker-touching selection deletes the range too', () => {
		const h = mount('abcd\n', { start: 0, end: 2 });
		select([h.marker.firstChild!, 1], [h.text, 2]);

		expect(h.handleKeydown(key('Delete'), at(2))).toBe(true);
		expect(h.edits).toEqual([[0, 'cd\n', 0, 0]]);
	});

	// The sibling arms decline modifier chords so the platform word-delete runs natively; this arm
	// must not — the browser fires no beforeinput over the marker, so declining would do nothing.
	it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }])(
		'%o+Backspace over a marker-touching selection still deletes the range',
		(mods) => {
			const h = mount('abcd\n', { start: 0, end: 2 });
			select([h.marker.firstChild!, 1], [h.text, 2]);

			expect(h.handleKeydown(key('Backspace', mods), at(2))).toBe(true);
			expect(h.edits).toEqual([[0, 'cd\n', 0, 0]]);
		}
	);

	it('a selection entirely inside the content does not touch the marker — not consumed', () => {
		const h = mount('abcd\n', { start: 1, end: 3 });
		select([h.text, 1], [h.text, 3]);

		const e = key('Backspace');
		expect(h.handleKeydown(e, at(3))).toBe(false);
		expect(e.defaultPrevented).toBe(false);
		expect(h.edits).toHaveLength(0);
	});

	it('a collapsed caret at the content edge is left to the merge/native paths', () => {
		const h = mount('abcd\n', null);
		select([h.text, 0], [h.text, 0]);

		const e = key('Backspace');
		expect(h.handleKeydown(e, at(0))).toBe(false);
		expect(e.defaultPrevented).toBe(false);
		expect(h.edits).toHaveLength(0);
	});
});
