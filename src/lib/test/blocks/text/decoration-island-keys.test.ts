// @vitest-environment jsdom
//
// Caret-edge dispatch for decoration islands (decoration-island-keys). Pins two
// contracts e2e cannot: modifier chords (word-delete) must stay native — the
// island rules own only plain edge presses — and a printable key at an
// element-level caret is consumed into a CST edit (in a real browser native
// typing can mask a neutered branch byte-for-byte, so the seam is pinned here).
import { afterEach, describe, expect, it } from 'vitest';
import {
	createDecorationIslandKeys,
	type DecorationIslandKeysDeps
} from '$lib/components/blocks/text/decoration-island-keys';
import { parse } from '$lib/core/parser';
import type { BlockEditActions } from '$lib/action-contracts';

interface Harness {
	handleKeydown: ReturnType<typeof createDecorationIslandKeys>['handleKeydown'];
	el: HTMLElement;
	island: HTMLElement;
	edits: { index: number; content: string; start: number; end: number }[];
}

/** Mount [text before][island][text after] for `source`'s first block and wire
 *  the factory around it. Zero-width `start === end` mounts a widget island. */
function mount(source: string, start: number, end: number): Harness {
	const node = parse(source).children[0];
	const display = node.raw.replace(/\n$/, '');

	const island = document.createElement('span');
	island.dataset.decorationIsland = '';
	island.dataset.sourceStart = String(start);
	island.dataset.sourceEnd = String(end);
	island.setAttribute('contenteditable', 'false');

	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	if (start > 0) el.append(document.createTextNode(display.slice(0, start)));
	el.append(island);
	if (end < display.length) el.append(document.createTextNode(display.slice(end)));
	document.body.appendChild(el);

	const edits: Harness['edits'] = [];
	const deps: DecorationIslandKeysDeps = {
		get node() {
			return node;
		},
		get index() {
			return 0;
		},
		getEl: () => el,
		getRawSelection: () => null,
		blockEdit: {
			updateBlockContent: (index: number, content: string, start: number, end: number) => {
				edits.push({ index, content, start, end });
			}
		} as unknown as BlockEditActions,
		setPendingCursor: () => {}
	};
	return { handleKeydown: createDecorationIslandKeys(deps).handleKeydown, el, island, edits };
}

function key(name: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent {
	return new KeyboardEvent('keydown', { key: name, cancelable: true, ...modifiers });
}

function caretAfter(island: HTMLElement): void {
	const range = document.createRange();
	range.setStartAfter(island);
	range.collapse(true);
	const sel = window.getSelection()!;
	sel.removeAllRanges();
	sel.addRange(range);
}

afterEach(() => {
	document.body.innerHTML = '';
	window.getSelection()?.removeAllRanges();
});

describe('modifier chords stay native near islands', () => {
	const chords: Partial<KeyboardEvent>[] = [{ ctrlKey: true }, { altKey: true }, { metaKey: true }];

	it.each(chords)('%o+Backspace at a replace island trailing edge is not consumed', (mods) => {
		const h = mount('abHIDDENcd\n', 2, 8);
		const e = key('Backspace', mods);
		expect(h.handleKeydown(e, 8)).toBe(false);
		expect(e.defaultPrevented).toBe(false);
		expect(h.edits).toHaveLength(0);
	});

	it('Ctrl+Delete at a replace island leading edge is not consumed', () => {
		const h = mount('abHIDDENcd\n', 2, 8);
		const e = key('Delete', { ctrlKey: true });
		expect(h.handleKeydown(e, 2)).toBe(false);
		expect(e.defaultPrevented).toBe(false);
	});

	it('Ctrl+Backspace at a widget island is not consumed (native word-delete)', () => {
		const h = mount('hello\n', 3, 3);
		const e = key('Backspace', { ctrlKey: true });
		expect(h.handleKeydown(e, 3)).toBe(false);
		expect(e.defaultPrevented).toBe(false);
		expect(h.edits).toHaveLength(0);
	});

	it('plain Backspace at the trailing edge still selects the island whole', () => {
		const h = mount('abHIDDENcd\n', 2, 8);
		const e = key('Backspace');
		expect(h.handleKeydown(e, 8)).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		const selected = window.getSelection()!.getRangeAt(0).cloneContents();
		expect(selected.querySelector('[data-decoration-island]')).not.toBeNull();
	});
});

describe('typing at an element-level caret against a widget island', () => {
	it('consumes the key and inserts at the raw offset through one CST edit', () => {
		const h = mount('hello\n', 5, 5);
		caretAfter(h.island);
		const e = key('z');
		expect(h.handleKeydown(e, 5)).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(h.edits).toEqual([{ index: 0, content: 'helloz\n', start: 5, end: 6 }]);
	});

	it('leaves a text-node caret to native typing', () => {
		const h = mount('hello\n', 5, 5);
		const textNode = h.el.firstChild as Text;
		const range = document.createRange();
		range.setStart(textNode, 5);
		range.collapse(true);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);

		const e = key('z');
		expect(h.handleKeydown(e, 5)).toBe(false);
		expect(e.defaultPrevented).toBe(false);
	});
});
