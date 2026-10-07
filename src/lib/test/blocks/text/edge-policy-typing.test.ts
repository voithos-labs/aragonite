// @vitest-environment jsdom
// The caret-edge dispatch's typing branches: marker completion, pending marks, branch
// order, and what a keystroke reads of the tree.
import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { trimTrailingLineEnding } from '$lib/core/lines';
import { asRawOffset, asDomTextOffset } from '$lib/cursor/coordinate-spaces';
import {
	installEdgeDispatchCleanup,
	makeEdgeDispatch,
	mountSurface,
	at,
	key,
	type EdgeDispatchHarness
} from './edge-policy-fixture';
import { type CstNode, type Document } from '$lib/core/nodes';
import { type EdgeAffinity } from '$lib/cursor/edge-affinity';
import { type PendingMarks } from '$lib/cursor/pending-marks';
import { type InlineMarkKind } from '$lib/schema/inline-construct-policy';
import { makePendingMarks, makeTopHarness } from '$lib/test/harness/editor-actions';
import { serialize } from '$lib/core/serializer';
import { READING_WRITE_TAG } from '$lib/editor-actions/commit/reading-write-gate';
import { fixtureReading } from '../../harness/fixture-grammar';
import { takeDevWarns } from '../../support/warn-gate';
import TextEditableBlock from '$lib/components/blocks/text/TextEditableBlock.svelte';
import { nodeAt } from '$lib/tree-operations/node-primitives';
import { storedAsAt } from '$lib/tree-operations/stored-as';
import { applyLiveRangeEdit } from '$lib/components/blocks/text/live-selection-edit';
import { createRangeAtDomTextOffsets } from '$lib/cursor/widget-offset';
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

	installEdgeDispatchCleanup();

	describe('the declared branch order', () => {
		const { dispatch } = mount(false);

		it('ranks the families as the design states, cut line included', () => {
			expect(dispatch.arms.map((arm) => arm.id)).toEqual([
				'pending-marks',
				'cst-widget',
				'reading-mode',
				'decoration-island',
				'ambient-marker',
				'construct-edge-delete',
				'marker-completion'
			]);
		});

		it('gives every branch a reason, which is what a new entry has to supply', () => {
			expect(dispatch.arms.filter((arm) => arm.reason.trim() === '')).toEqual([]);
		});

		// The reading-mode entry sits in the list, not ahead of it: the two branches above it still
		// run in reading mode, and everything below does nothing. A check at the top loses that half.
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

	installEdgeDispatchCleanup();

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
	// A chord at a collapsed caret leaves a mark pending; the first printable key spends it once, in one commit.

	interface Harness extends EdgeDispatchHarness {
		marks: PendingMarks;
	}

	function mount(
		source: string,
		pending: InlineMarkKind[],
		{ affinity = null }: { affinity?: EdgeAffinity | null } = {}
	): Harness {
		const node = parse(source).children[0];
		const el = mountSurface(trimTrailingLineEnding(node.raw), 'live');
		const marks = makePendingMarks(...pending);
		return {
			...makeEdgeDispatch(node, el, {
				side: affinity,
				pendingMarks: marks
			}),
			marks
		};
	}

	installEdgeDispatchCleanup();

	describe('the first byte after a chord carries the mark', () => {
		it('wraps the byte and anchors the undo entry at the pre-toggle caret', () => {
			const h = mount('hi\n', ['strong']);
			const e = key('X');

			expect(h.handleKeydown(e, at(2))).toBe(true);
			expect(e.defaultPrevented).toBe(true);
			expect(h.edits).toEqual([[0, 'hi**X**\n', 2, 5]]);
		});

		it('spends the set exactly once: the second byte types plain', () => {
			const h = mount('hi\n', ['strong']);
			h.handleKeydown(key('X'), at(2));

			expect(h.marks.get()).toBeNull();
			expect(h.handleKeydown(key('Y'), at(5))).toBe(false);
			expect(h.edits).toHaveLength(1);
		});

		it('carries two marks into one insertion', () => {
			const h = mount('hi\n', ['strong', 'emphasis']);
			expect(h.handleKeydown(key('X'), at(2))).toBe(true);
			expect(h.edits).toEqual([[0, 'hi***X***\n', 2, 6]]);
		});

		// The chain already has strong at this caret, so the mark removes it: the byte escapes the
		// construct rather than being wrapped in a second pair.
		it('escapes the construct when the chain already carries the mark', () => {
			const h = mount('Some **bold** text\n', ['strong']);
			expect(h.handleKeydown(key('X'), at(9))).toBe(true);
			expect(h.edits).toEqual([[0, 'Some **bo**X**ld** text\n', 9, 12]]);
		});
	});

	describe('a pending mark outranks every arrival rule', () => {
		// Offset 11 is bold's trailing content edge with the far side recorded, so the typing rules
		// would write past the closer. The mark says otherwise, and wins (live-mode.md § 4.2).
		it('beats the typing caret position at a construct edge', () => {
			const h = mount('Some **bold** text\n', ['emphasis'], { affinity: 'far' });
			expect(h.handleKeydown(key('X'), at(11))).toBe(true);
			expect(h.edits).toEqual([[0, 'Some **bold*X*** text\n', 11, 13]]);
		});

		// The next byte is the browser's again, placed by the write as any insertion is.
		it('leaves the next byte to the side on record once the set is spent', () => {
			const h = mount('Some **bold** text\n', ['emphasis'], { affinity: 'far' });
			h.handleKeydown(key('X'), at(11));
			h.edits.length = 0;

			expect(h.handleKeydown(key('Y'), at(11))).toBe(false);
			expect(h.edits).toHaveLength(0);
		});
	});

	describe('the toggle caret position claims only a plain byte at a collapsed caret', () => {
		it('declines with nothing pending, whatever the key', () => {
			const h = mount('hi\n', []);
			expect(h.handleKeydown(key('X'), at(2))).toBe(false);
			expect(h.edits).toHaveLength(0);
		});

		it('declines a chord, which is a command rather than a typed byte', () => {
			const h = mount('hi\n', ['strong']);
			for (const mods of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
				expect(h.handleKeydown(key('X', mods), at(2))).toBe(false);
			}
			// Declining a chord must not spend the marks: Mod+I after Mod+B leaves both pending.
			expect(h.marks.get()).not.toBeNull();
		});

		it('declines a non-printable key and keeps the set for the byte that follows', () => {
			const h = mount('hi\n', ['strong']);
			for (const name of ['Enter', 'Tab', 'ArrowLeft', 'Backspace']) {
				expect(h.handleKeydown(key(name), at(2))).toBe(false);
			}
			expect(h.marks.get()).not.toBeNull();
		});

		it('declines a null caret', () => {
			const h = mount('hi\n', ['strong']);
			expect(h.handleKeydown(key('X'), null)).toBe(false);
		});

		// Miss-analysis: only the arm's own reading-mode check was tested, never the write's refusal.
		it('forced in reading mode, where no mark can be pending, writes nothing and warns', async () => {
			const top = makeTopHarness('hi\n', { reading: fixtureReading({}, 'reading') });
			const node = top.deps.doc.children[0];
			const el = mountSurface('hi', 'live');
			const { handleKeydown } = makeEdgeDispatch(node, el, {
				isReading: () => true,
				pendingMarks: makePendingMarks('strong'),
				blockEdit: top.actions
			});

			expect(handleKeydown(key('X'), at(2))).toBe(true);
			await Promise.resolve();

			expect(serialize(top.deps.doc)).toBe('hi\n');
			expect(takeDevWarns().map((w) => w.tag)).toEqual([READING_WRITE_TAG]);
		});
	});

	// A construct the key empties is unwrapped, so its mark is handed back: the next byte keeps the
	// format, and the next chord still turns it off.
	describe('a press that empties a construct hands its mark back', () => {
		it('leaves the emptied construct’s mark pending for the next byte', () => {
			const h = mount('plain*x*\n', []);

			expect(h.handleKeydown(key('Backspace'), at(7))).toBe(true);
			expect(h.edits).toEqual([[0, 'plain\n', 7, 5]]);
			expect(h.marks.get()).toEqual(new Set(['emphasis']));
		});

		it('pends nothing where the press empties no construct', () => {
			const h = mount('Some **bold** text\n', []);

			expect(h.handleKeydown(key('Backspace'), at(13))).toBe(true);
			expect(h.marks.get()).toBeNull();
		});

		// A link unwraps on empty like a mark does, but no chord writes one, so there is nothing to
		// hand back and a pended `link` would be a promise the insertion cannot keep.
		it('pends nothing for an unwrapped kind no format chord writes', () => {
			const h = mount('a [x](u) b\n', []);

			expect(h.handleKeydown(key('Backspace'), at(4))).toBe(true);
			expect(h.edits).toEqual([[0, 'a  b\n', 4, 2]]);
			expect(h.marks.get()).toBeNull();
		});
	});
});

describe('stored read cost', () => {
	// Miss-analysis: nothing counted what a keystroke reads of the tree, so a store resolved up front
	// would walk the document on every key in every block and no suite would notice.

	installEdgeDispatchCleanup();

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
		it.each([
			['Backspace inside a word', 'Backspace', 16],
			['Delete inside a word', 'Delete', 15],
			['a letter typed inside a word', 'X', 16]
		])('%s', (_name, name, caret) => {
			const leaf = countedLeaf();
			expect(dispatchOver(leaf).handleKeydown(key(name), at(caret))).toBe(false);
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
			expect(dispatchOver(leaf).handleKeydown(key('Backspace'), at(13))).toBe(true);
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
				policies: { presentationMode: () => 'live' },
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
