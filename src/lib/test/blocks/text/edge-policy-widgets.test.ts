// @vitest-environment jsdom
// The caret-edge dispatch around widgets: decoration widgets, modifier chords, a range
// opening on a widget, and the caret a write stores.
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { selectWidgetWhole } from '#lib/selection/place-caret.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { parse } from '#lib/core/parser.js';
import { computeInlineContent } from '#lib/core/inline/index.js';
import { asRawOffset } from '#lib/caret/coordinate-spaces.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import { type InlineNode, type CstNode } from '#lib/core/nodes.js';
import {
	caretAfter,
	decorationIsland,
	installEdgeDispatchCleanup,
	key,
	makeEdgeDispatch,
	mountIslandBlock,
	mountSurface,
	type EdgeDispatchHarness,
	at
} from './edge-policy-fixture';
import { mountWidgetBlock } from './math-widget-fixture';
import { trimTrailingLineEnding } from '#lib/core/lines.js';
import { type BlockEditActions } from '#lib/action-contracts.js';
import { withStoredCaret } from '#lib/editor-actions/stored-caret.js';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';

installEdgeDispatchCleanup();

describe('decoration widgets', () => {
	// Modifier chords stay with the browser, and a printable key at an element-level caret becomes a CST edit.

	interface Harness extends EdgeDispatchHarness {
		island: HTMLElement;
	}

	/** A block with a decoration widget wired to the dispatch: no CST widget, no shown source,
	 *  editing mode. `hasIslands` defaults to true; the scan tests pass false for the early return. */
	function mount(source: string, start: number, end: number, hasIslands = true): Harness {
		const { node, el, island } = mountIslandBlock(source, start, end);
		return { ...makeEdgeDispatch(node, el, { hasIslands: () => hasIslands }), island };
	}

	describe('modifier chords stay native near widgets', () => {
		const chords: Partial<KeyboardEvent>[] = [
			{ ctrlKey: true },
			{ altKey: true },
			{ metaKey: true }
		];

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
			const image = computeInlineContent(node, undefined, defaultGrammarView).find(
				(n: InlineNode) => n.kind === 'image'
			)!;
			const el = mountSurface([document.createTextNode('a![c]('), decorationIsland(6, image.end)]);
			window.getSelection()?.removeAllRanges();

			const selection = createSelectionState();
			const h = makeEdgeDispatch(node, el, {
				hasIslands: () => true,
				enterWidget: (widget, fromTrailingEdge) =>
					selectWidgetWhole(selection, testCaretWriter, {
						paragraphPath: [0],
						sourceStart: widget.start,
						preSelectOffset: fromTrailingEdge ? widget.end : widget.start
					})
			});

			expect(h.handleKeydown(key('Backspace'), asRawOffset(image.end))).toBe(true);
			expect(selection.widget).toMatchObject({ sourceStart: image.start });
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
});

describe('modifier chords', () => {
	// Only a plain key at a caret edge enters a CST widget; Ctrl+ArrowLeft must not, or the next key replaces its bytes.

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

	describe('a modifier chord at a widget edge is not a widget entry', () => {
		const chords: Partial<KeyboardEvent>[] = [
			{ ctrlKey: true },
			{ metaKey: true },
			{ altKey: true }
		];

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

		// Without this case, the chord check could pass by disabling the whole branch.
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
});

describe('ranged edit', () => {
	// A plain edit key over a range reads the range's start as its caret, which must not answer for a leading widget.
	// Miss-analysis: range tests selected prose, widget tests used a collapsed caret; none did both.

	/** The whole block selected, the shape Ctrl+A and a triple-click both make: the range starts at
	 *  the element, so no text node comes before it. */
	function selectWholeSurface(el: HTMLElement): void {
		const range = document.createRange();
		range.selectNodeContents(el);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);
	}

	/** A block led by a widget (`&copy;` steps over, `![a](u)` selects then deletes); `ranged`
	 *  selects from `from` to the end of the displayed text. */
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
			[
				'a range opening at an entity’s trailing edge, Backspace',
				ENTITY_LED,
				'Backspace',
				ENTITY_END
			]
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

	// Miss-analysis: no test put the DOM's and the clamped reading of a range under one selection.
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
});

describe('pending cursor', () => {
	// Every writing branch remembers the caret its write returns, in stored bytes, not the one it computed.
	// Miss-analysis: branches kept their own computed caret; no test's write moved the caret.

	/** How far the stand-in write moves every caret, as a rule inserting bytes ahead of it would. */
	const SHIFT = 100;

	function dispatchOver(node: CstNode, el: HTMLElement, hasIslands: boolean) {
		const parks: { offset: number | null; source: string }[] = [];
		const { dispatch } = makeEdgeDispatch(node, el, {
			hasIslands: () => hasIslands,
			blockEdit: {
				updateBlockContent: (_index, _text, _mode, before = 0, after = before) =>
					withStoredCaret(Promise.resolve(true), after + SHIFT)
			} as Pick<BlockEditActions, 'updateBlockContent'> as BlockEditActions,
			requestCaret: (offset, { source }) => void parks.push({ offset, source })
		});
		return { dispatch, parks };
	}

	/** [prose][CST widget][prose], the shape a prose block renders. */
	function mountWidget(source: string, kind: string) {
		const { node, el, widgets, inlineWidgets } = mountWidgetBlock(source, kind);
		return { ...dispatchOver(node, el, false), widget: inlineWidgets[0], island: widgets[0] };
	}

	/** A zero-width decoration widget at the block's end, with `onEdge: 'step-over'`. */
	function mountIsland(source: string, at: number) {
		const { node, el, island } = mountIslandBlock(source, at);
		return { ...dispatchOver(node, el, true), island };
	}

	describe('an edge-dispatch write parks the caret the write stored', () => {
		it('typing beside a CST widget', () => {
			const b = mountWidget('hello ![a](u) world', 'image');
			caretAfter(b.island);

			expect(b.dispatch.handleKeydown(key('z'), asRawOffset(b.widget.end))).toBe(true);
			expect(b.parks).toEqual([{ offset: b.widget.end + 1 + SHIFT, source: 'widget' }]);
		});

		it('typing beside a decoration widget', () => {
			const b = mountIsland('hello\n', 5);
			caretAfter(b.island);

			expect(b.dispatch.handleKeydown(key('z'), asRawOffset(5))).toBe(true);
			expect(b.parks).toEqual([{ offset: 6 + SHIFT, source: 'island' }]);
		});

		it('deleting through a decoration widget', () => {
			const b = mountIsland('hello\n', 5);
			caretAfter(b.island);

			expect(b.dispatch.handleKeydown(key('Backspace'), asRawOffset(5))).toBe(true);
			expect(b.parks).toEqual([{ offset: 4 + SHIFT, source: 'island' }]);
		});

		it('an atomic widget delete', () => {
			const b = mountWidget('a&copy;b', 'entityReference');

			expect(b.dispatch.handleKeydown(key('Backspace'), asRawOffset(b.widget.end))).toBe(true);
			expect(b.parks).toEqual([{ offset: b.widget.start + SHIFT, source: 'widget' }]);
		});
	});
});
