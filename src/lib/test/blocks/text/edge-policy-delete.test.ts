// @vitest-environment jsdom
// The caret-edge dispatch's delete branches: ambient markers, construct edges, setext
// structure, the first reachable offset, and the step-over deferral.
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { parse } from '$lib/core/parser';
import { asRawOffset } from '$lib/cursor/coordinate-spaces';
import { trimTrailingLineEnding } from '$lib/core/lines';
import {
	at,
	installEdgeDispatchCleanup,
	key,
	makeEdgeDispatch,
	mountSurface,
	type EdgeDispatchHarness,
	mountIslandBlock
} from './edge-policy-fixture';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '$lib/schema/inline-construct-policy';
import { type CstNode } from '$lib/core/nodes';
import { type EdgeAffinity } from '$lib/cursor/edge-affinity';
import '$lib/schema/built-in-descriptors';

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

describe('construct-edge delete', () => {
	// Where no marker is drawn, the key takes the content character and any pair the cut empties, in one commit.
	// Miss-analysis: the pure rewrite had tests, but none pinned which keys and modes reach it.

	/** `source` as one block under an optional presentation root. */
	function mount(source: string, mode?: string): EdgeDispatchHarness {
		const node = parse(source).children[0];
		return makeEdgeDispatch(node, mountSurface(trimTrailingLineEnding(node.raw), mode));
	}

	describe('a destructive key past a construct edge takes the content byte', () => {
		it('rewrites through the CST and anchors the undo entry at the pre-edit caret', () => {
			const h = mount('Some **bold** text\n', 'live');
			const e = key('Backspace');
			expect(h.handleKeydown(e, at(13))).toBe(true);
			expect(e.defaultPrevented).toBe(true);
			expect(h.edits).toEqual([[0, 'Some **bol** text\n', 13, 10]]);
		});

		it('drops the delimiters the cut empties in the same commit', () => {
			const h = mount('**b** tail\n', 'live');
			expect(h.handleKeydown(key('Backspace'), at(3))).toBe(true);
			expect(h.edits).toEqual([[0, ' tail\n', 3, 0]]);
		});

		it('takes the first content byte on Delete at a leading run', () => {
			const h = mount('**bold** x\n', 'live');
			expect(h.handleKeydown(key('Delete'), at(0))).toBe(true);
			expect(h.edits).toEqual([[0, '**old** x\n', 0, 0]]);
		});

		// Away from every hidden run the browser is right and keeps the key, grapheme and IME
		// behavior included.
		it('leaves an ordinary content byte to native', () => {
			const h = mount('Some **bold** text\n', 'live');
			expect(h.handleKeydown(key('Backspace'), at(9))).toBe(false);
			expect(h.edits).toHaveLength(0);
		});

		// No rewrite of `**a **` parses back, and the browser's own delete wrecks both constructs and
		// shows the stars, so the destructive branch takes the key and writes nothing.
		it('takes the press and writes nothing where no rewrite parses back', () => {
			const h = mount('**a *b*** z\n', 'live');
			const e = key('Backspace');
			expect(h.handleKeydown(e, at(6))).toBe(true);
			expect(e.defaultPrevented).toBe(true);
			expect(h.edits).toHaveLength(0);
		});

		// The bytes past the content range are the block's own, so this branch writes nothing there,
		// however the block-edge path answers the key.
		it('writes nothing at a heading’s content start', () => {
			const h = mount('## **b** x\n', 'live');
			h.handleKeydown(key('Backspace'), at(3));
			expect(h.edits).toHaveLength(0);
		});
	});

	describe('the branch claims a press only where the markers are unpainted', () => {
		it('declines in source mode, which paints every delimiter', () => {
			const h = mount('Some **bold** text\n', undefined);
			expect(h.handleKeydown(key('Backspace'), at(13))).toBe(false);
			expect(h.edits).toHaveLength(0);
		});

		// The preview modes show the focused construct, so its delimiters are editable bytes.
		for (const mode of ['preview-block', 'preview-inline']) {
			it(`declines in ${mode}`, () => {
				const h = mount('Some **bold** text\n', mode);
				expect(h.handleKeydown(key('Backspace'), at(13))).toBe(false);
			});
		}

		// A chord is a word-scoped platform command; this branch takes only the plain key.
		it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }])(
			'declines %o+Backspace',
			(mods) => {
				const h = mount('Some **bold** text\n', 'live');
				expect(h.handleKeydown(key('Backspace', mods), at(13))).toBe(false);
			}
		);
	});
});

describe('hidden structural suffix', () => {
	// A block whose structure sits past its content (a setext underline) takes neither end: Delete joins, Backspace demotes.
	// Miss-analysis: the suites mounted no presentation root, so marker-hiding modes had no fixture.

	/** `source` as one block under an optional presentation root; markers get their own spans. */
	function mount(source: string, mode?: string): EdgeDispatchHarness {
		const node = parse(source).children[0];
		return makeEdgeDispatch(node, mountSurface(trimTrailingLineEnding(node.raw), mode));
	}

	describe('Delete at a setext heading’s content end reaches the block command', () => {
		// `Title\n===`: the underline is structural, so content ends at 5.
		for (const mode of [undefined, 'live', 'preview-block', 'preview-inline']) {
			it(`is left unclaimed in ${mode ?? 'source'} mode`, () => {
				const h = mount('Title\n===\n', mode);
				const e = key('Delete');
				expect(h.handleKeydown(e, at(5))).toBe(false);
				expect(e.defaultPrevented).toBe(false);
				expect(h.edits).toHaveLength(0);
			});
		}
	});

	describe('the prefix side belongs to the block-edge command, not to this dispatch', () => {
		// The key falls through the whole dispatch so `block.mergePrev` can demote the heading;
		// consuming it here would silently take the gesture back.
		it.each([
			['a heading’s content start', '## Title\n', 3],
			['a setext heading’s content start', 'Title\n===\n', 0]
		])('declines Backspace at %s', (_case, source, offset) => {
			const h = mount(source, 'live');
			expect(h.handleKeydown(key('Backspace'), at(offset))).toBe(false);
			expect(h.edits).toHaveLength(0);
		});
	});
});

describe('first reachable offset', () => {
	// Backspace at the first reachable offset is a block gesture, so the edge branch does nothing, even past a hidden escape.
	// Miss-analysis: GH #108, the branch's suite never pressed at the block's first reachable offset.

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

	describe('the destructive branch at the block’s reachable start', () => {
		it('declines Backspace at the first reachable offset inside a leading escape', () => {
			const h = mountEscapes();
			expect(h.handleKeydown(key('Backspace'), at(1))).toBe(false);
			expect(h.edits).toHaveLength(0);
		});

		it('still takes the escape whole one step past the first reachable offset', () => {
			const h = mountEscapes();
			expect(h.handleKeydown(key('Backspace'), at(2))).toBe(true);
			expect(h.edits).toEqual([[0, 'a\\*\n', 2, 0]]);
		});

		it('still claims Delete at the first reachable offset: forward is a construct edit', () => {
			const h = mountEscapes();
			expect(h.handleKeydown(key('Delete'), at(1))).toBe(true);
			expect(h.edits).toEqual([[0, 'a\\*\n', 1, 0]]);
		});
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
		beforeAll(() => registerLiveJoinSeamCleaner(cleanLiveJoinSeam));
		afterAll(() => __resetLiveJoinSeamCleanerForTests());

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

	// ── The widget printable insert ──────────────────────────────────────────────

	describe('the widget printable insert asks the typing caret position', () => {
		/** `**a&copy;** t` with an element-level caret between the entity widget and the closing run,
		 *  where Chromium drops the key and this branch writes it through the CST instead. */
		function withElementCaret(mode: string): Surface {
			const s = surface('**a&copy;** t\n', { mode, affinity: 'far' });
			const widget = document.createElement('span');
			widget.dataset.inlineWidget = '';
			widget.textContent = '©';
			s.el.append(document.createTextNode('**a'), widget, document.createTextNode('** t'));
			const dom = document.createRange();
			dom.setStart(s.el, 2);
			dom.collapse(true);
			const sel = window.getSelection()!;
			sel.removeAllRanges();
			sel.addRange(dom);
			return s;
		}

		it('writes at the caret position the arrival names, not at the caret', () => {
			const s = withElementCaret('live');
			const e = key('.');
			expect(s.handleKeydown(e, at(9))).toBe(true);
			expect(e.defaultPrevented).toBe(true);
			expect(s.edits).toEqual([[0, '**a&copy;**. t\n', 9, 12]]);
		});

		it('writes at the caret where no unpainted run is touched', () => {
			const s = withElementCaret('source');
			expect(s.handleKeydown(key('.'), at(9))).toBe(true);
			expect(s.edits).toEqual([[0, '**a&copy;.** t\n', 9, 10]]);
		});
	});
});
