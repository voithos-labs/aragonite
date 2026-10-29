// @vitest-environment jsdom
// The caret-edge dispatch's delete branches: ambient markers, hidden runs, the block's edges, and
// the step-over deferral.
import { describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { asRawOffset } from '#lib/core/coordinate-spaces.js';
import { trimTrailingLineEnding } from '#lib/core/lines.js';
import {
	BACKSPACE,
	DELETE,
	at,
	installEdgeDispatchCleanup,
	key,
	makeEdgeDispatch,
	mountSurface,
	type EdgeDispatchHarness,
	mountIslandBlock
} from './edge-policy-fixture';
import type { CstNode } from '#lib/core/nodes.js';
import type { EdgeAffinity } from '#lib/caret/edge-affinity.js';
import '#lib/schema/built-in-descriptors.js';

installEdgeDispatchCleanup();

describe('ambient-marker selection delete', () => {
	// A selection reaching into the non-editable marker prefix deletes through the CST, since the browser fires no beforeinput for it.

	interface Harness extends EdgeDispatchHarness {
		text: Text;
		marker: HTMLElement;
	}

	/** Mount `[md-marker][content]`, the shape a list item's prose child renders. `rawSelection` is
	 *  the content range the mocked DOM-to-raw traversal returns. */
	function mount(source: string, rawSelection: { start: number; end: number } | null): Harness {
		const node = parse(source).children[0];

		const marker = document.createElement('span');
		marker.className = 'md-marker';
		marker.setAttribute('contenteditable', 'false');
		marker.textContent = '- ';
		const text = document.createTextNode(trimTrailingLineEnding(node.raw));
		const el = mountSurface([marker, text]);

		const harness = makeEdgeDispatch(node, el, {
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

	describe('ambient-marker selection delete', () => {
		it('Backspace over a selection reaching into the marker deletes the range via the CST', () => {
			const h = mount('abcd\n', { start: 0, end: 2 });
			// Anchor inside the marker, focus after two content characters: the shape a
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

		// The neighbouring branches decline modifier chords so word-delete runs natively, but over the
		// marker the browser fires no beforeinput, so declining would do nothing at all.
		it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }])(
			'%o+Backspace over a marker-touching selection still deletes the range',
			(mods) => {
				const h = mount('abcd\n', { start: 0, end: 2 });
				select([h.marker.firstChild!, 1], [h.text, 2]);

				expect(h.handleKeydown(key('Backspace', mods), at(2))).toBe(true);
				expect(h.edits).toEqual([[0, 'cd\n', 0, 0]]);
			}
		);

		it('a selection entirely inside the content does not touch the marker: not consumed', () => {
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
});

describe('a collapsed delete beside a hidden run', () => {
	// Where no marker is drawn, the delete takes the content character and any pair the cut empties, in one commit.
	// Miss-analysis: the pure rewrite had tests, but none pinned which modes reach it.

	/** `source` as one block under an optional presentation root. */
	function mount(source: string, mode?: string): EdgeDispatchHarness {
		const node = parse(source).children[0];
		return makeEdgeDispatch(node, mountSurface(trimTrailingLineEnding(node.raw), mode));
	}

	it('rewrites through the CST and anchors the undo entry at the pre-edit caret', () => {
		const h = mount('Some **bold** text\n', 'live');
		expect(h.dispatch.deleteAtCaret(13, BACKSPACE)).toBe('taken');
		expect(h.edits).toEqual([[0, 'Some **bol** text\n', 13, 10]]);
	});

	it('drops the delimiters the cut empties in the same commit', () => {
		const h = mount('**b** tail\n', 'live');
		h.dispatch.deleteAtCaret(3, BACKSPACE);
		expect(h.edits).toEqual([[0, ' tail\n', 3, 0]]);
	});

	it('takes the first content byte on Delete at a leading run', () => {
		const h = mount('**bold** x\n', 'live');
		h.dispatch.deleteAtCaret(0, DELETE);
		expect(h.edits).toEqual([[0, '**old** x\n', 0, 0]]);
	});

	// No rewrite of `**a **` parses back, and the browser's own delete wrecks both constructs and
	// shows the stars, so the delete is taken and writes nothing.
	it('takes the delete and writes nothing where no rewrite parses back', () => {
		const h = mount('**a *b*** z\n', 'live');
		expect(h.dispatch.deleteAtCaret(6, BACKSPACE)).toBe('taken');
		expect(h.edits).toHaveLength(0);
	});

	// Source mode paints every delimiter, and the preview modes the focused construct's.
	for (const mode of [undefined, 'preview-block', 'preview-inline']) {
		it(`takes the shown delimiter byte in ${mode ?? 'source'} mode`, () => {
			const h = mount('Some **bold** text\n', mode);
			h.dispatch.deleteAtCaret(13, BACKSPACE);
			expect(h.edits.map((e) => e[1])).toEqual(['Some **bold* text\n']);
		});
	}
});

describe('the block edge', () => {
	// Backspace at the first offset the caret can sit at is the block's gesture, so the delete takes nothing there, even past a hidden escape.
	// Miss-analysis: GH #108, the delete branch's suite never pressed at the block's first reachable offset.

	/** One live block whose DOM carries the marker spans the reachable-offset scan reads. */
	function mount(source: string, parts: Node[]): EdgeDispatchHarness {
		const node = parse(source).children[0];
		return makeEdgeDispatch(node, mountSurface(parts, 'live'));
	}

	function marker(text: string): HTMLElement {
		const el = document.createElement('span');
		el.className = 'md-marker';
		el.textContent = text;
		return el;
	}

	const text = (s: string) => document.createTextNode(s);

	/** `\*a\*` rendered live: the backslashes are hidden runs, so the first reachable offset is 1. */
	const mountEscapes = () =>
		mount('\\*a\\*\n', [marker('\\'), text('*'), text('a'), marker('\\'), text('*')]);

	it('stops at the edge on Backspace at the first reachable offset inside a leading escape', () => {
		const h = mountEscapes();
		expect(h.dispatch.deleteAtCaret(1, BACKSPACE)).toBe('at-edge');
		expect(h.edits).toHaveLength(0);
	});

	it('takes the escape whole one step past the first reachable offset', () => {
		const h = mountEscapes();
		h.dispatch.deleteAtCaret(2, BACKSPACE);
		expect(h.edits).toEqual([[0, 'a\\*\n', 2, 0]]);
	});

	it('takes the escape on Delete at the first reachable offset: forward is a construct edit', () => {
		const h = mountEscapes();
		h.dispatch.deleteAtCaret(1, DELETE);
		expect(h.edits).toEqual([[0, 'a\\*\n', 1, 0]]);
	});

	// The bytes before the content start are the block's own: the merge or demote command's.
	it('takes nothing on Backspace at a heading’s content start', () => {
		const h = mount('## **b** x\n', [marker('## '), text('**b** x')]);
		h.dispatch.deleteAtCaret(3, BACKSPACE);
		expect(h.edits).toHaveLength(0);
	});

	// A setext underline is structure past the content, which Delete joins rather than eats.
	it('takes nothing on Delete at a setext heading’s content end', () => {
		const h = mount('Title\n===\n', [text('Title'), marker('\n===')]);
		h.dispatch.deleteAtCaret(5, DELETE);
		expect(h.edits).toHaveLength(0);
	});
});

describe('deferring to the delete rules', () => {
	// Three byte-writing branches outrank rules they must respect: step-over delete, widget insert, marker-prefix delete.
	// Miss-analysis: those branches' suites used plain prose, never a hidden run beside the byte.

	interface Surface extends EdgeDispatchHarness {
		node: CstNode;
		el: HTMLElement;
	}

	interface Options {
		mode: string;
		affinity?: EdgeAffinity;
		ambientLength?: number;
		rawSelection?: { start: number; end: number };
		hasIslands?: boolean;
	}

	/** One prose block under a presentation root; the caller fills `el` with the shape it needs. */
	function surface(source: string, options: Options): Surface {
		const node: CstNode = parse(source).children[0];
		const el = mountSurface([], options.mode);
		return { node, el, ...wire(node, el, options) };
	}

	function wire(node: CstNode, el: HTMLElement, options: Options): EdgeDispatchHarness {
		return makeEdgeDispatch(node, el, {
			hasIslands: () => options.hasIslands ?? false,
			getRawSelection: () =>
				options.rawSelection
					? {
							start: asRawOffset(options.rawSelection.start),
							end: asRawOffset(options.rawSelection.end)
						}
					: null,
			side: options.affinity ?? null
		});
	}

	// ── The decoration step-over delete ──────────────────────────────────────────

	/** `[text][zero-width widget][text]`, the shape a plugin's widget decoration draws. */
	function withWidgetIsland(source: string, mode: string, islandAt: number): Surface {
		const { node, el } = mountIslandBlock(source, islandAt, islandAt, mode);
		return { node, el, ...wire(node, el, { mode, hasIslands: true }) };
	}

	describe('a step-over widget beside an unpainted run defers to the construct-edge rule', () => {
		// The widget sits just inside `**`, so the raw byte behind the caret is a delimiter the user
		// never saw. The rule takes the neighbouring content character instead (live-mode.md § 4.4).
		it('Backspace takes the content character, not the delimiter byte', () => {
			const s = withWidgetIsland('x**bold** y\n', 'live', 3);
			const e = key('Backspace');
			expect(s.handleKeydown(e, at(3))).toBe(true);
			expect(e.defaultPrevented).toBe(true);
			expect(s.edits).toEqual([[0, '**bold** y\n', 3, 0]]);
		});

		it('Delete takes the content character on the other side', () => {
			const s = withWidgetIsland('x **bold**y\n', 'live', 8);
			expect(s.handleKeydown(key('Delete'), at(8))).toBe(true);
			expect(s.edits).toEqual([[0, 'x **bold**\n', 8, 8]]);
		});

		// Source mode draws the delimiters, so the byte behind the caret is one the user is looking
		// at and the widget's own splice is already right.
		it('keeps the raw neighbour splice where the markers paint', () => {
			const s = withWidgetIsland('x**bold** y\n', 'source', 3);
			expect(s.handleKeydown(key('Backspace'), at(3))).toBe(true);
			// Undo puts the caret back where the key found it, as the construct-edge rule's does.
			expect(s.edits).toEqual([[0, 'x*bold** y\n', 3, 2]]);
		});
	});

	// ── The marker-prefix range delete ───────────────────────────────────────────

	/** `[md-marker][content]`, a list item's prose child, with the selection reaching into the
	 *  marker: the shape that fires no `beforeinput` at all. */
	function withAmbientSelection(
		source: string,
		mode: string,
		range: { start: number; end: number }
	) {
		const s = surface(source, { mode, ambientLength: 2, rawSelection: range });
		const marker = document.createElement('span');
		marker.className = 'md-marker';
		marker.setAttribute('contenteditable', 'false');
		marker.textContent = '- ';
		const text = document.createTextNode(trimTrailingLineEnding(s.node.raw));
		s.el.append(marker, text);
		const dom = document.createRange();
		dom.setStart(marker.firstChild!, 1);
		dom.setEnd(text, range.end);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(dom);
		return s;
	}

	describe('the ambient-marker delete crosses the join', () => {
		// The selection ends inside `**a b**`, so a literal splice strands the closer and shows it.
		it('drops the run the cut stranded instead of splicing raw bytes', () => {
			const s = withAmbientSelection('**a b** c\n', 'live', { start: 0, end: 5 });
			const e = key('Backspace');
			expect(s.handleKeydown(e, at(5))).toBe(true);
			expect(e.defaultPrevented).toBe(true);
			expect(s.edits).toEqual([[0, ' c\n', 0, 0]]);
		});

		it('keeps the literal splice where the markers paint', () => {
			const s = withAmbientSelection('**a b** c\n', 'source', { start: 0, end: 5 });
			expect(s.handleKeydown(key('Backspace'), at(5))).toBe(true);
			expect(s.edits).toEqual([[0, '** c\n', 0, 0]]);
		});
	});

	// ── The typed insert beside a widget ─────────────────────────────────────────

	describe('a typed insert the block writes beside a widget asks the typing caret position', () => {
		/** `**a&copy;** t`, the caret between the entity widget and the closing run. */
		const atWidgetEnd = (mode: string): Surface =>
			surface('**a&copy;** t\n', { mode, affinity: 'outside' });

		it('writes at the caret position the record names, not at the caret', () => {
			const s = atWidgetEnd('live');
			s.dispatch.typing.typeAt(9, '.');
			expect(s.edits).toEqual([[0, '**a&copy;**. t\n', 9, 12]]);
		});

		it('writes at the caret where no unpainted run is touched', () => {
			const s = atWidgetEnd('source');
			s.dispatch.typing.typeAt(9, '.');
			expect(s.edits).toEqual([[0, '**a&copy;.** t\n', 9, 10]]);
		});
	});
});
