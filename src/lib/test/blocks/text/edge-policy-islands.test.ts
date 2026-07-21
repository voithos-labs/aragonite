// @vitest-environment jsdom
//
// The caret-edge dispatch's decoration-island branch (edge-policy-dispatch). Pins
// two contracts e2e cannot: modifier chords (word-delete) must stay native — the
// island rules own only plain edge presses — and a printable key at an element-level
// caret is consumed into a CST edit (in a real browser native typing can mask a
// neutered branch byte-for-byte, so the seam is pinned here). A third describe pins
// the observable precedence: a CST widget wins the shared caret edge over an island.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	createEdgePolicyDispatch,
	type EdgePolicyDispatchDeps
} from '$lib/components/blocks/text/edge-policy-dispatch';
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
import type { BlockEditActions } from '$lib/action-contracts';
import type { CstNode, InlineNode } from '$lib/core/nodes';

interface Harness {
	handleKeydown: ReturnType<typeof createEdgePolicyDispatch>['handleKeydown'];
	el: HTMLElement;
	island: HTMLElement;
	edits: { index: number; content: string; start: number; end: number }[];
}

/** Common dispatch deps for the island tests: no CST widget, no reveal, editing mode.
 *  `hasIslands` defaults true (every `mount` stamps one); the scan-gate tests pass
 *  false to exercise the island-free early return. */
function islandDeps(
	node: CstNode,
	el: HTMLElement,
	edits: Harness['edits'],
	hasIslands = true
): EdgePolicyDispatchDeps {
	return {
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
		getAmbientLength: () => 0,
		hasIslands: () => hasIslands,
		getRawSelection: () => null,
		blockEdit: {
			updateBlockContent: (index: number, content: string, start: number, end: number) => {
				edits.push({ index, content, start, end });
			}
		} as unknown as BlockEditActions,
		setPendingCursor: () => {},
		setSnapTarget: () => {},
		isRevealing: () => false,
		enterWidget: () => {},
		isReading: () => false
	};
}

/** Mount [text before][island][text after] for `source`'s first block and wire
 *  the dispatch around it. Zero-width `start === end` mounts a widget island. */
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
	return {
		handleKeydown: createEdgePolicyDispatch(islandDeps(node, el, edits)).handleKeydown,
		el,
		island,
		edits
	};
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
		expect(h.handleKeydown(e, asRawOffset(8))).toBe(false);
		expect(e.defaultPrevented).toBe(false);
		expect(h.edits).toHaveLength(0);
	});

	it('Ctrl+Delete at a replace island leading edge is not consumed', () => {
		const h = mount('abHIDDENcd\n', 2, 8);
		const e = key('Delete', { ctrlKey: true });
		expect(h.handleKeydown(e, asRawOffset(2))).toBe(false);
		expect(e.defaultPrevented).toBe(false);
	});

	it('Ctrl+Backspace at a widget island is not consumed (native word-delete)', () => {
		const h = mount('hello\n', 3, 3);
		const e = key('Backspace', { ctrlKey: true });
		expect(h.handleKeydown(e, asRawOffset(3))).toBe(false);
		expect(e.defaultPrevented).toBe(false);
		expect(h.edits).toHaveLength(0);
	});

	it('plain Backspace at the trailing edge still selects the island whole', () => {
		const h = mount('abHIDDENcd\n', 2, 8);
		const e = key('Backspace');
		expect(h.handleKeydown(e, asRawOffset(8))).toBe(true);
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
		expect(h.handleKeydown(e, asRawOffset(5))).toBe(true);
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
		expect(h.handleKeydown(e, asRawOffset(5))).toBe(false);
		expect(e.defaultPrevented).toBe(false);
	});
});

// ── Precedence: CST widget wins the shared caret edge over an island ───────────

describe('a CST widget outranks a decoration island at the same caret edge', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
	});

	it('Backspace at an offset both claim enters the widget, never selects the island', () => {
		// `a![c](x)` — the image widget occupies raw 1..8; stamp a replace island whose
		// trailing edge is also 8. The dispatch tries the widget class first, so the
		// widget's select-then-delete wins and the island is untouched.
		const node = parse('a![c](x)\n').children[0];
		const image = computeInlineContent(node).find((n: InlineNode) => n.kind === 'image')!;

		const el = document.createElement('div');
		el.setAttribute('contenteditable', 'true');
		const island = document.createElement('span');
		island.dataset.decorationIsland = '';
		island.dataset.sourceStart = '6';
		island.dataset.sourceEnd = String(image.end);
		island.setAttribute('contenteditable', 'false');
		el.append(document.createTextNode('a![c]('), island);
		document.body.appendChild(el);
		window.getSelection()?.removeAllRanges();

		const widgetSelection = createWidgetSelectionState({ onSelect: () => {} });
		const edits: Harness['edits'] = [];
		const deps: EdgePolicyDispatchDeps = {
			...islandDeps(node, el, edits),
			enterWidget: (widget, fromTrailingEdge) =>
				widgetSelection.select({
					paragraphPath: [0],
					sourceStart: widget.start,
					preSelectOffset: fromTrailingEdge ? widget.end : widget.start
				})
		};

		const consumed = createEdgePolicyDispatch(deps).handleKeydown(
			key('Backspace'),
			asRawOffset(image.end)
		);
		expect(consumed).toBe(true);
		expect(widgetSelection.getSelected()).toMatchObject({ sourceStart: image.start });
		// The island's select-whole never ran: no native range wraps it, no edit fired.
		expect(edits).toHaveLength(0);
		expect(window.getSelection()!.rangeCount).toBe(0);
	});
});

// ── The per-keystroke island DOM scan is gated on island presence ──────────────

describe('island-free typing skips the DOM scan', () => {
	beforeEach(() => {
		resetPerfInstruments();
		enablePerfInstruments();
	});
	afterEach(() => disablePerfInstruments());

	// A plain paragraph with a text-node caret and no island span — the common block.
	function plainBlock(): HTMLElement {
		const el = document.createElement('div');
		el.setAttribute('contenteditable', 'true');
		el.append(document.createTextNode('hello'));
		document.body.appendChild(el);
		const range = document.createRange();
		range.setStart(el.firstChild!, 3);
		range.collapse(true);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);
		return el;
	}

	it('a printable keydown runs zero DOM scans when the block has no islands', () => {
		const node = parse('hello\n').children[0];
		const el = plainBlock();
		const dispatch = createEdgePolicyDispatch(islandDeps(node, el, [], false));
		expect(dispatch.handleKeydown(key('z'), asRawOffset(3))).toBe(false);
		expect(perfSnapshot().islandKeyScans).toBe(0);
	});

	it('a block that carries islands still scans (the gate does not over-suppress)', () => {
		const h = mount('abHIDDENcd\n', 2, 8);
		h.handleKeydown(key('Backspace'), asRawOffset(8));
		expect(perfSnapshot().islandKeyScans).toBeGreaterThanOrEqual(1);
	});
});
