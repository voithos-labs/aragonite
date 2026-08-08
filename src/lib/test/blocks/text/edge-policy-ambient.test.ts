// @vitest-environment jsdom
//
// The caret-edge dispatch's ambient-marker branch (edge-policy-dispatch). A selection whose DOM
// range reaches into the contenteditable="false" ambient marker blocks native Backspace/Delete
// silently — no beforeinput fires — so the dispatch commits the delete through the CST instead.
// This branch lived inside the Svelte component and never had a unit test; the extraction lets
// one pin it at its own level (culture.md: dispatch layers get tests at their own level).
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
	text: Text;
	marker: HTMLElement;
	edits: { index: number; content: string; start: number; end: number }[];
}

/** Mount `[md-marker][content]` — the shape a list item's ambient-prefixed prose child renders.
 *  `rawSelection` is the content range the (mocked) DOM→raw walk yields. */
function mount(source: string, rawSelection: { start: number; end: number } | null): Harness {
	const node: CstNode = parse(source).children[0];
	const display = node.raw.replace(/\n$/, '');

	const marker = document.createElement('span');
	marker.className = 'md-marker';
	marker.setAttribute('contenteditable', 'false');
	marker.textContent = '- ';
	const text = document.createTextNode(display);

	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	el.append(marker, text);
	document.body.appendChild(el);

	const edits: Harness['edits'] = [];
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
		getAmbientLength: () => marker.textContent!.length,
		hasIslands: () => false,
		getRawSelection: () =>
			rawSelection && {
				start: asRawOffset(rawSelection.start),
				end: asRawOffset(rawSelection.end)
			},
		blockEdit: {
			updateBlockContent: (index: number, content: string, start: number, end: number) => {
				edits.push({ index, content, start, end });
			}
		} as unknown as BlockEditActions,
		setPendingCursor: () => {},
		setSnapTarget: () => {},
		isRevealing: () => false,
		enterWidget: () => {},
		isReading: () => false,
		getEdgeAffinity: () => null,
		pendingMarks: makePendingMarks()
	};
	return { handleKeydown: createEdgePolicyDispatch(deps).handleKeydown, text, marker, edits };
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

function key(name: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent {
	return new KeyboardEvent('keydown', { key: name, cancelable: true, ...modifiers });
}

afterEach(() => {
	document.body.innerHTML = '';
	window.getSelection()?.removeAllRanges();
});

describe('ambient-marker selection delete', () => {
	it('Backspace over a selection reaching into the marker deletes the range via the CST', () => {
		const h = mount('abcd\n', { start: 0, end: 2 });
		// Anchor inside the marker, focus after two content chars — the shape a
		// leftward shift-select from the content into the prefix produces.
		select([h.marker.firstChild!, 1], [h.text, 2]);

		const e = key('Backspace');
		expect(h.handleKeydown(e, asRawOffset(2) as RawOffset)).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(h.edits).toEqual([{ index: 0, content: 'cd\n', start: 0, end: 0 }]);
	});

	it('Delete over the same marker-touching selection deletes the range too', () => {
		const h = mount('abcd\n', { start: 0, end: 2 });
		select([h.marker.firstChild!, 1], [h.text, 2]);

		expect(h.handleKeydown(key('Delete'), asRawOffset(2) as RawOffset)).toBe(true);
		expect(h.edits).toEqual([{ index: 0, content: 'cd\n', start: 0, end: 0 }]);
	});

	// The sibling arms decline modifier chords so the platform word-delete runs natively; this arm
	// must not — the browser fires no beforeinput over the marker, so declining would do nothing.
	it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }])(
		'%o+Backspace over a marker-touching selection still deletes the range',
		(mods) => {
			const h = mount('abcd\n', { start: 0, end: 2 });
			select([h.marker.firstChild!, 1], [h.text, 2]);

			expect(h.handleKeydown(key('Backspace', mods), asRawOffset(2) as RawOffset)).toBe(true);
			expect(h.edits).toEqual([{ index: 0, content: 'cd\n', start: 0, end: 0 }]);
		}
	);

	it('a selection entirely inside the content does not touch the marker — not consumed', () => {
		const h = mount('abcd\n', { start: 1, end: 3 });
		select([h.text, 1], [h.text, 3]);

		const e = key('Backspace');
		expect(h.handleKeydown(e, asRawOffset(3) as RawOffset)).toBe(false);
		expect(e.defaultPrevented).toBe(false);
		expect(h.edits).toHaveLength(0);
	});

	it('a collapsed caret at the content edge is left to the merge/native paths', () => {
		const h = mount('abcd\n', null);
		select([h.text, 0], [h.text, 0]);

		const e = key('Backspace');
		expect(h.handleKeydown(e, asRawOffset(0) as RawOffset)).toBe(false);
		expect(e.defaultPrevented).toBe(false);
		expect(h.edits).toHaveLength(0);
	});
});
