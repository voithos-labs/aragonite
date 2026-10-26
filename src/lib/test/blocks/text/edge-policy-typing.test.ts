// @vitest-environment jsdom
// The caret-edge dispatch's typing branches: marker completion, the marks a delete hands back,
// branch order, and what a keystroke reads of the tree.
import { describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { trimTrailingLineEnding } from '#lib/core/lines.js';
import { asRawOffset, asDomTextOffset } from '#lib/core/coordinate-spaces.js';
import {
	BACKSPACE,
	installEdgeDispatchCleanup,
	makeEdgeDispatch,
	mountSurface,
	at,
	key,
	type EdgeDispatchHarness
} from './edge-policy-fixture';
import { type CstNode, type Document } from '#lib/core/nodes.js';
import { recordingPendingMarks } from '#lib/test/harness/editor-actions.js';
import { fixtureReading } from '../../harness/fixture-grammar';
import TextEditableBlock from '#lib/components/blocks/text/TextEditableBlock.svelte';
import { nodeAt } from '#lib/tree-operations/node-primitives.js';
import { storedAsAt } from '#lib/tree-operations/stored-as.js';
import { applyLiveRangeEdit } from '#lib/components/blocks/text/live-selection-edit.js';
import { createRangeAtDomTextOffsets } from '#lib/caret/widget-offset.js';
import { mountBlock } from '../../harness/mount-block';
import { settleEditor } from '../../harness/settle';
import { noIslands } from '../table/mount-cell';

installEdgeDispatchCleanup();

describe('branch order', () => {
	// The branch order decides every contested key, so a branch added at the wrong rank changes behavior.
	// Miss-analysis: no test named the order of the branches, so a reordering read as a refactor.

	function mount(reading: boolean, source = 'hello world\n') {
		const node = parse(source).children[0];
		const el = mountSurface(trimTrailingLineEnding(node.raw));
		const entered: { start: number; end: number }[] = [];
		const harness = makeEdgeDispatch(node, el, {
			hasIslands: () => true,
			isReading: () => reading,
			enterWidget: (widget) => entered.push({ start: widget.start, end: widget.end })
		});
		return { ...harness, node, entered };
	}

	describe('the declared branch order', () => {
		const { dispatch } = mount(false);

		it('ranks the families as the design states, cut line included', () => {
			expect(dispatch.arms.map((arm) => arm.id)).toEqual([
				'delete-beside',
				'cst-widget',
				'reading-mode',
				'decoration-island',
				'ambient-marker',
				'marker-completion'
			]);
		});

		it('gives every branch a reason, which is what a new entry has to supply', () => {
			expect(dispatch.arms.filter((arm) => arm.reason.trim() === '')).toEqual([]);
		});

		// The reading-mode entry sits in the list, not ahead of it: the widget branch above it still
		// runs in reading mode, and everything below does nothing. A check at the top loses that half.
		it('reading mode stops the walk at its cut and leaves the key unclaimed', () => {
			const e = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });
			expect(mount(true).dispatch.handleKeydown(e, asRawOffset(11))).toBe(false);
			expect(e.defaultPrevented).toBe(false);
		});

		// The widget branch above the reading-mode entry still selects an entity at the caret, and
		// reads the mode itself to skip only its atomic delete.
		it('enters a widget at the caret in reading mode and commits nothing', () => {
			const b = mount(true, 'a&copy;b\n');
			const e = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });
			expect(b.dispatch.handleKeydown(e, asRawOffset(7))).toBe(true);
			expect(b.entered).toEqual([{ start: 1, end: 7 }]);
			expect(b.edits).toEqual([]);
			expect(e.defaultPrevented).toBe(true);
			expect(b.node.raw).toBe('a&copy;b\n');
		});
	});
});

describe('marker completion', () => {
	// A bare space at the content start of an empty child, or after a bare marker, completes the marker's line.
	// Miss-analysis: the suite loaded only finished quotes, so the second key of `> ` had no test.

	interface Harness extends EdgeDispatchHarness {
		/** Point the same dispatch at another child of the mounted container, as a recycled
		 *  block component does. */
		useChild: (index: number) => void;
	}

	/** The leaf at `path` inside `source`, wired to the dispatch with its real ancestor container. */
	function mount(source: string, path: number[], isReading = false): Harness {
		const doc = parse(source);
		let parent: CstNode | null = null;
		let node = doc.children[path[0]];
		for (const index of path.slice(1)) {
			parent = node;
			node = node.children![index];
		}

		const el = mountSurface(trimTrailingLineEnding(node.raw));
		return {
			...makeEdgeDispatch(() => node, el, {
				index: path[path.length - 1],
				containerParent: parent,
				isReading: () => isReading
			}),
			useChild: (index) => {
				node = parent!.children![index];
			}
		};
	}

	describe('a container declaring contentStartSpace completes its marker', () => {
		it('consumes the space at the content start of an empty child, writing nothing', () => {
			const h = mount('>\n', [0, 0]);
			const e = key(' ');
			expect(h.handleKeydown(e, at(0))).toBe(true);
			expect(e.defaultPrevented).toBe(true);
			expect(h.edits).toHaveLength(0);
			expect(h.markerWrites).toHaveLength(0);
		});

		it('completes a nested quote at its own depth: the nearest ancestor answers', () => {
			const h = mount('> >\n', [0, 0, 0]);
			expect(h.handleKeydown(key(' '), at(0))).toBe(true);
		});

		it('completes at a middle empty child, not only the one an Enter just made', () => {
			const h = mount('> a\n>\n>\n> b\n', [0, 1]);
			expect(h.handleKeydown(key(' '), at(0))).toBe(true);
			expect(h.edits).toHaveLength(0);
		});

		// The consumed key writes nothing, so only this branch's memory tells the second space from the
		// first; the second is the only way to type a leading space, and indented code needs four.
		it('declines the second space at the same caret position, leaving it to land as content', () => {
			const h = mount('>\n', [0, 0]);
			expect(h.handleKeydown(key(' '), at(0))).toBe(true);
			const second = key(' ');
			expect(h.handleKeydown(second, at(0))).toBe(false);
			expect(second.defaultPrevented).toBe(false);
			expect(h.edits).toHaveLength(0);
		});

		// The completion is taken once per child, not per component: a component recycled for another
		// empty child gives that child its own completion.
		it('re-branches when the surface is re-used for a different empty child', () => {
			const h = mount('>\n>\n', [0, 0]);
			expect(h.handleKeydown(key(' '), at(0))).toBe(true);
			expect(h.handleKeydown(key(' '), at(0))).toBe(false);
			h.useChild(1);
			expect(h.handleKeydown(key(' '), at(0))).toBe(true);
		});

		it('declines in an equally empty child of a container that declares nothing', () => {
			const h = mount('- \n', [0, 0, 0]);
			expect(h.handleKeydown(key(' '), at(0))).toBe(false);
		});

		// Typing `>` before text leaves the caret before the text, so the next space is the marker's.
		// Miss-analysis: GH #456, no caret could reach that offset, so only the empty child was asked.
		it('writes the space into the marker’s line for a child right after a bare marker', () => {
			const h = mount('>abc\n', [0, 0]);
			expect(h.handleKeydown(key(' '), at(0))).toBe(true);
			expect(h.edits).toHaveLength(0);
			expect(h.markerWrites.map((node) => node.raw)).toEqual(['abc\n']);
			expect(h.handleKeydown(key(' '), at(0))).toBe(false);
		});

		it('completes a bare marker nested in a list item at its own depth', () => {
			const h = mount('- a\n\n  >abc\n', [0, 0, 1, 0]);
			expect(h.handleKeydown(key(' '), at(0))).toBe(true);
		});

		it('declines at the document root, where there is no container to complete', () => {
			const h = mount('\n', [0]);
			expect(h.handleKeydown(key(' '), at(0))).toBe(false);
		});
	});

	describe('the marker-completion gate is byte shapes only', () => {
		it('declines in a non-empty child, where the space is content', () => {
			const h = mount('> abc\n', [0, 0]);
			expect(h.handleKeydown(key(' '), at(0))).toBe(false);
		});

		it('declines past the content start', () => {
			const h = mount('>\n', [0, 0]);
			expect(h.handleKeydown(key(' '), at(1))).toBe(false);
		});

		it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }])(
			'declines a modified space (%o)',
			(modifiers) => {
				const h = mount('>\n', [0, 0]);
				expect(h.handleKeydown(key(' ', modifiers), at(0))).toBe(false);
			}
		);

		it('declines every other printable at the same caret position', () => {
			const h = mount('>\n', [0, 0]);
			expect(h.handleKeydown(key('a'), at(0))).toBe(false);
		});

		it('declines in reading mode, which stands every editing branch down', () => {
			const h = mount('>\n', [0, 0], true);
			expect(h.handleKeydown(key(' '), at(0))).toBe(false);
		});
	});
});

describe('pending marks', () => {
	interface Harness extends EdgeDispatchHarness {
		marks: ReturnType<typeof recordingPendingMarks>;
	}

	function mount(source: string): Harness {
		const node = parse(source).children[0];
		const el = mountSurface(trimTrailingLineEnding(node.raw), 'live');
		const marks = recordingPendingMarks();
		return { ...makeEdgeDispatch(node, el, { pendingMarks: marks }), marks };
	}

	// A construct the key empties is unwrapped, so its mark is handed back: the next byte keeps the
	// format, and the next chord still turns it off.
	describe('a press that empties a construct hands its mark back', () => {
		it('leaves the emptied construct’s mark pending for the next byte', () => {
			const h = mount('plain*x*\n');

			expect(h.dispatch.deleteAtCaret(7, BACKSPACE)).toBe('taken');
			expect(h.edits).toEqual([[0, 'plain\n', 7, 5]]);
			expect(h.marks.pended).toEqual(['emphasis']);
		});

		it('pends nothing where the press empties no construct', () => {
			const h = mount('Some **bold** text\n');

			expect(h.dispatch.deleteAtCaret(13, BACKSPACE)).toBe('taken');
			expect(h.marks.pended).toEqual([]);
		});

		// A link unwraps on empty like a mark does, but no chord writes one, so there is nothing to
		// hand back and a pended `link` would be a promise the insertion cannot keep.
		it('pends nothing for an unwrapped kind no format chord writes', () => {
			const h = mount('a [x](u) b\n');

			expect(h.dispatch.deleteAtCaret(4, BACKSPACE)).toBe('taken');
			expect(h.edits).toEqual([[0, 'a  b\n', 4, 2]]);
			expect(h.marks.pended).toEqual([]);
		});
	});
});

describe('stored read cost', () => {
	// Miss-analysis: nothing counted what a keystroke reads of the tree, so a store resolved up front
	// would walk the document on every key in every block and no suite would notice.

	const SOURCE = '- Some **bold** text\n';
	const LEAF = [0, 0, 0];
	const LIVE = fixtureReading({}, 'live');

	/** `children` behind a proxy that counts every indexed read, one trap each, the way the editor's
	 *  `$state` array pays for them. */
	function countingReads(children: CstNode[]) {
		let reads = 0;
		const proxy = new Proxy(children, {
			get(target, prop, receiver) {
				if (typeof prop === 'string' && /^\d+$/.test(prop)) reads++;
				return Reflect.get(target, prop, receiver);
			}
		});
		return { proxy, reads: () => reads, reset: () => void (reads = 0) };
	}

	/** The list item's paragraph, in a document whose top-level list counts its reads. */
	function countedLeaf() {
		const doc: Document = parse(SOURCE);
		const node = nodeAt(doc, LEAF) as CstNode;
		const counter = countingReads(doc.children);
		doc.children = counter.proxy;
		const storedAs = () => storedAsAt(doc, LEAF, LIVE);
		return { node, storedAs, reads: counter.reads };
	}

	function dispatchOver(leaf: ReturnType<typeof countedLeaf>) {
		const el = mountSurface(trimTrailingLineEnding(leaf.node.raw), 'live');
		return makeEdgeDispatch(leaf.node, el, { storedAs: leaf.storedAs });
	}

	describe('a keystroke with no hidden run beside it reads nothing of where the block is stored', () => {
		it('a letter typed inside a word', () => {
			const leaf = countedLeaf();
			expect(dispatchOver(leaf).handleKeydown(key('X'), at(16))).toBe(false);
			expect(leaf.reads()).toBe(0);
		});

		it.each([
			['Backspace inside a word', 'backward', 16],
			['Delete inside a word', 'forward', 15]
		] as const)('%s', (_name, direction, caret) => {
			const leaf = countedLeaf();
			expect(
				dispatchOver(leaf).dispatch.deleteAtCaret(caret, { unit: 'character', direction })
			).toBe('taken');
			expect(leaf.reads()).toBe(0);
		});

		// The block hands its store to the range edit on every beforeinput, so making one reads nothing.
		it('a typed byte at a collapsed caret, through the beforeinput range edit', () => {
			const leaf = countedLeaf();
			const e = new InputEvent('beforeinput', { inputType: 'insertText', data: 'X' });
			const cursor = { rawRangeOf: () => null, getRawSelection: () => null };
			const handled = applyLiveRangeEdit(
				e,
				leaf.node,
				cursor,
				leaf.storedAs(),
				() => false,
				() => {}
			);
			expect(handled).toBe(false);
			expect(leaf.reads()).toBe(0);
		});

		// The positive half: a key at a hidden run does read the store, so a zero above is no accident.
		it('Backspace at a hidden run reads it', () => {
			const leaf = countedLeaf();
			expect(dispatchOver(leaf).dispatch.deleteAtCaret(13, BACKSPACE)).toBe('taken');
			expect(leaf.reads()).toBeGreaterThan(0);
		});
	});

	// ── Through the mounted block ────────────────────────────────────────────────

	/** The block mounted over a document whose list counts reads of its items: the store's walk to
	 *  the list item goes through them, and nothing else a keystroke does. */
	function mountCounted() {
		const doc: Document = parse(SOURCE);
		const list = doc.children[0];
		const counter = countingReads(list.children!);
		list.children = counter.proxy;
		const { target } = mountBlock(TextEditableBlock, {
			doc,
			path: LEAF,
			overrides: {
				mode: () => 'live',
				services: { decorations: noIslands }
			}
		});
		const el = target.querySelector('.text-editable-block') as HTMLElement;
		return { el, ...counter };
	}

	describe('the mounted block asks its store nothing for a keystroke away from a hidden run', () => {
		it.each([
			['a typed letter', 'insertText', 'X', 16],
			['Backspace', 'deleteContentBackward', undefined, 16]
		])('%s inside a word', async (_name, inputType, data, caret) => {
			const block = mountCounted();
			block.el.focus();
			const sel = window.getSelection()!;
			sel.removeAllRanges();
			sel.addRange(
				createRangeAtDomTextOffsets(block.el, asDomTextOffset(caret), asDomTextOffset(caret))!
			);
			await settleEditor();
			block.reset();
			block.el.dispatchEvent(
				new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true })
			);
			await settleEditor();
			expect(block.reads()).toBe(0);
		});
	});

	// Chromium hands a range edit its target range even for one character, so these take the range path.
	describe('the mounted block asks its store nothing for a range edit away from a hidden run', () => {
		it.each([
			['Backspace over one character', 'deleteContentBackward', undefined, 15, 16],
			['a letter typed over a word', 'insertText', 'X', 14, 18]
		])('%s', async (_name, inputType, data, start, end) => {
			const block = mountCounted();
			block.el.focus();
			const target = createRangeAtDomTextOffsets(
				block.el,
				asDomTextOffset(start),
				asDomTextOffset(end)
			)!;
			const sel = window.getSelection()!;
			sel.removeAllRanges();
			sel.addRange(target);
			await settleEditor();
			block.reset();
			const e = new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true });
			Object.defineProperty(e, 'getTargetRanges', { value: () => [target] });
			block.el.dispatchEvent(e);
			await settleEditor();
			expect(block.reads()).toBe(0);
		});
	});
});
