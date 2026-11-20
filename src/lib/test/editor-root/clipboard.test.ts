// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEditorRootClipboard } from '#lib/components/editor-root/clipboard.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { selectWidgetWhole } from '#lib/selection/place-caret.js';
import { registerEditor, __resetActiveEditorForTests } from '#lib/active-editor.js';
import { parse } from '#lib/core/parser.js';
import type { BlockComponent } from '#lib/block-component.js';
import type { CrossBlockHandlers } from '#lib/selection/cross-block/dispatch.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { freshBytes } from '#lib/test/harness/copied-text.js';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';
import { WHOLE_BLOCK_INPUT_ATTR } from '#lib/selection/whole-block-input.js';

// Chromium aims a clipboard event at <body> and Firefox at a block element when the selection's end
// has no caret, at a cross-block endpoint or a selected widget; driven through `target`.

interface HarnessOptions {
	/** Stands in for the block owning an inline widget, selected whole in block 0. */
	widgetBlock?: BlockComponent;
}

function harness(options: HarnessOptions = {}) {
	const root = document.createElement('div');
	root.tabIndex = -1;
	document.body.append(root);
	registerEditor(root);

	const selection = createSelectionState();
	if (options.widgetBlock) {
		selectWidgetWhole(
			selection,
			testCaretWriter,
			{
				paragraphPath: [0],
				sourceStart: 0,
				preSelectOffset: 0
			},
			() => null
		);
	}
	const doc = parse('hello\n\nworld\n');
	const deleted = vi.fn(async () => {});
	const crossBlock = {
		performCrossBlockCut: deleted,
		reading: fixtureReading(),
		bytes: freshBytes(() => doc)
	} as unknown as CrossBlockHandlers;

	const header = document.createElement('header');
	const clipboard = createEditorRootClipboard({
		selection,
		getDoc: () => doc,
		crossBlock,
		getBlockComponent: (path) => (path[0] === 0 ? (options.widgetBlock ?? null) : null),
		isHostChrome: (node) => !!node && header.contains(node)
	});

	function fire(
		type: 'copy' | 'cut',
		target: EventTarget | null,
		{ prevented = false } = {}
	): { written: Map<string, string>; preventCount: number } {
		const written = new Map<string, string>();
		let preventCount = prevented ? 1 : 0;
		const event = {
			type,
			target,
			get defaultPrevented() {
				return preventCount > 0;
			},
			preventDefault: () => {
				preventCount++;
			},
			clipboardData: {
				setData: (t: string, v: string) => written.set(t, v),
				getData: () => ''
			}
		} as unknown as ClipboardEvent;
		if (type === 'copy') clipboard.handleCopy(event, root);
		if (type === 'cut') clipboard.handleCut(event, root);
		return { written, preventCount };
	}

	return { root, header, selection, clipboard, fire, deleted };
}

describe('editor-root clipboard routing', () => {
	beforeEach(() => {
		__resetActiveEditorForTests();
		document.body.replaceChildren();
	});

	it('writes the cross-block text for a copy that landed on the body', () => {
		const h = harness();
		h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 5 });

		expect(h.fire('copy', document.body).written.get('text/plain')).toContain('hello');
	});

	it('writes for a copy that landed on the root itself', () => {
		const h = harness();
		h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 5 });

		expect(h.fire('copy', h.root).written.get('text/plain')).toContain('hello');
	});

	it('declines when a block surface already claimed the event', () => {
		const h = harness();
		h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 5 });

		expect(h.fire('copy', document.body, { prevented: true }).written.size).toBe(0);
	});

	// Miss-analysis: every row fired at the root or the body, where Chromium aims these events; Firefox aims them at the block.
	describe('a target inside the editor', () => {
		function blockElement(root: HTMLElement): HTMLElement {
			const block = document.createElement('div');
			block.className = 'thematic-break-block';
			root.append(block);
			return block;
		}

		it('takes a copy and a cut aimed at a block element that left it alone', async () => {
			const h = harness();
			h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 5 });
			const block = blockElement(h.root);

			expect(h.fire('copy', block).written.get('text/plain')).toContain('hello');
			expect(h.fire('cut', block).written.get('text/plain')).toContain('hello');
			await vi.waitFor(() => expect(h.deleted).toHaveBeenCalledOnce());
		});

		it('forwards one aimed at a block element to the block holding a selected widget', () => {
			const seen: string[] = [];
			const widgetBlock = {
				claimRootClipboard: (e: ClipboardEvent) => void seen.push(e.type)
			} as unknown as BlockComponent;
			const h = harness({ widgetBlock });

			h.fire('copy', blockElement(h.root));

			expect(seen).toEqual(['copy']);
		});

		// A block focused whole holds focus on its hidden input, editable outside reading mode, and
		// sends Mod+C over a range across blocks to the copy event.
		for (const editable of ['true', 'false']) {
			it(`takes a copy aimed at a block's whole-block input (contenteditable=${editable})`, () => {
				const h = harness();
				h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 5 });
				const input = blockElement(h.root);
				input.setAttribute(WHOLE_BLOCK_INPUT_ATTR, '');
				input.setAttribute('contenteditable', editable);

				expect(h.fire('copy', input).written.get('text/plain')).toContain('hello');
			});
		}

		// The search bar's input, a host header field and a plugin's own editable keep their
		// clipboard; the editor's block surfaces mark theirs handled first.
		const FIELDS: Record<string, () => HTMLElement> = {
			'an input': () => document.createElement('input'),
			'a textarea': () => document.createElement('textarea'),
			'an editable outside every block': () => {
				const editable = document.createElement('div');
				editable.setAttribute('contenteditable', 'true');
				return editable;
			}
		};
		for (const [name, make] of Object.entries(FIELDS)) {
			it(`declines ${name}, which keeps its own clipboard`, () => {
				const h = harness();
				h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 5 });
				const field = make();
				h.root.append(field);

				expect(h.fire('copy', field).written.size).toBe(0);
			});
		}

		it('declines one aimed into the host header', () => {
			const h = harness();
			h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 5 });
			h.root.append(h.header);
			const button = document.createElement('button');
			h.header.append(button);

			expect(h.fire('copy', button).written.size).toBe(0);
		});
	});

	it('declines when the selection is not cross-block', () => {
		const h = harness();

		expect(h.fire('copy', document.body).written.size).toBe(0);
	});

	it('declines the body branch when a second editor holds the claim', () => {
		const h = harness();
		const other = document.createElement('div');
		document.body.append(other);
		registerEditor(other);
		h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 5 });

		// Two mounted editors and neither holding focus: neither may guess.
		expect(h.fire('copy', document.body).written.size).toBe(0);
	});

	it('cut writes the text and runs the range delete', async () => {
		const h = harness();
		h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 5 });

		expect(h.fire('cut', document.body).written.get('text/plain')).toContain('hello');
		await vi.waitFor(() => expect(h.deleted).toHaveBeenCalledOnce());
	});

	// A selected inline widget is the second state whose event lands here: selecting one
	// clears the native selection, and in a block with no text position nothing restores it.
	describe('selected-widget branch', () => {
		function widgetBlock() {
			const seen: string[] = [];
			const block = {
				claimRootClipboard: (e: ClipboardEvent) => void seen.push(e.type)
			} as unknown as BlockComponent;
			return { block, seen };
		}

		for (const type of ['copy', 'cut'] as const) {
			it(`forwards a ${type} to the owning block with no cross-block selection live`, () => {
				const { block, seen } = widgetBlock();
				const h = harness({ widgetBlock: block });

				h.fire(type, document.body);

				expect(seen).toEqual([type]);
				// The cross-block handlers must not also run: they would write the empty range.
				expect(h.deleted).not.toHaveBeenCalled();
			});
		}

		it('declines a text field that keeps its own clipboard, widget selected or not', () => {
			const { block, seen } = widgetBlock();
			const h = harness({ widgetBlock: block });
			const input = document.createElement('input');
			h.root.append(input);

			h.fire('copy', input);

			expect(seen).toEqual([]);
		});

		it('declines when a block surface already claimed the event', () => {
			const { block, seen } = widgetBlock();
			const h = harness({ widgetBlock: block });

			h.fire('copy', document.body, { prevented: true });

			expect(seen).toEqual([]);
		});
	});
});

// A menu row has no copy event to answer, so the root takes the range as Ctrl+C would.
describe("a menu's Cut or Copy of the range the editor holds", () => {
	beforeEach(() => {
		__resetActiveEditorForTests();
		document.body.replaceChildren();
	});

	it('hands back the range’s text and removes nothing until asked', async () => {
		const h = harness();
		h.selection.enterCrossBlock({ path: [0], offset: 2 }, { path: [1], offset: 3 });
		const taken = h.clipboard.takeForMenu();
		expect(taken?.write.text).toContain('llo');
		expect(h.deleted).not.toHaveBeenCalled();
		await taken?.remove();
		expect(h.deleted).toHaveBeenCalledOnce();
	});

	it('takes nothing while the browser holds the selection or a widget is selected', () => {
		expect(harness().clipboard.takeForMenu()).toBeNull();
		const widget = harness({ widgetBlock: {} as BlockComponent });
		expect(widget.clipboard.takeForMenu()).toBeNull();
	});
});
