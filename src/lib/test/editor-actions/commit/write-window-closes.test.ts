// Every writer that opens a write window closes it however the write ends. After a throw inside
// one, a position read fails no dev build, a selection change is heard at once, and the next
// write's announcement makes reads kept again.
// Miss-analysis: every row that threw inside a write threw in a commit's `apply`, which the frame
// caught. None threw at the undo's install, at the `source` swap or past the `apply`.
import { describe, expect, it } from 'vitest';
import { createHistoryActions } from '#lib/editor-actions/commit/history.js';
import { createKeptStarts, type KeptStarts } from '#lib/editor-actions/commit/kept-starts.js';
import { createDocumentSwap, initDocument } from '#lib/components/editor-root/document-swap.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import type { SelectionState } from '#lib/selection/selection-state.svelte.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import type { Document } from '#lib/core/nodes.js';
import { serialize } from '#lib/core/serializer.js';
import type { EditorError } from '#lib/editor-events.js';
import { makeTopHarness } from '#lib/test/harness/editor-actions.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';

const SOURCE = 'one\n\ntwo\n\nthree\n';
const snapshot = { path: docPathFrom([0]), offset: 0 };

/** One writer with a write that throws inside its window, and a later write that lands. */
interface Door {
	starts: KeptStarts;
	selection: SelectionState;
	/** How many selection changes a listener has heard. */
	heard(): number;
	throwInside(): Promise<unknown>;
	/** What only this writer promises once its write has thrown. */
	afterThrow?(): void;
	writeAgain(): Promise<unknown>;
}

function editor() {
	let heard = 0;
	const h = makeTopHarness(SOURCE, { onSelectionChange: () => heard++ });
	const removeLast = () =>
		h.controller.commitStructural({
			snapshot,
			mutate: (children) => {
				children.splice(children.length - 1, 1);
				return { op: 'delete', at: children.length, count: 1 };
			}
		});
	const errors: EditorError[] = [];
	h.events.on('error', (error) => errors.push(error));
	const door = {
		starts: h.deps.starts,
		selection: h.deps.selectionState,
		heard: () => heard,
		// A commit that throws anywhere before it announces is rolled back and reported.
		afterThrow() {
			expect(serialize(h.deps.doc)).toBe(SOURCE);
			expect(errors.map((error) => error.origin)).toEqual(['commit']);
		}
	};
	return { h, removeLast, door, writeAgain: removeLast };
}

const DOORS: { name: string; open(): Door | Promise<Door> }[] = [
	{
		name: 'a commit, thrown in its mutation',
		open() {
			const { h, door, writeAgain } = editor();
			const throwInside = () =>
				h.controller.commitStructural({
					snapshot,
					mutate: (children) => {
						children.splice(0, 1);
						throw new Error('blew up');
					}
				});
			return { ...door, throwInside, writeAgain };
		}
	},
	{
		name: 'a commit, thrown once its mutation is in',
		open() {
			const { h, door, removeLast } = editor();
			const quiet = h.deps.drafts;
			const throwInside = () => {
				h.deps.drafts = {
					...quiet,
					watching: () => true,
					record: () => {
						h.deps.drafts = quiet;
						throw new Error('blew up');
					}
				};
				return removeLast();
			};
			return { ...door, throwInside, writeAgain: removeLast };
		}
	},
	{
		name: 'an undo, thrown as it puts its entry back',
		async open() {
			const { h, door, removeLast } = editor();
			const history = createHistoryActions(h.deps, h.controller);
			await removeLast();
			const setDoc = h.deps.setDoc;
			const throwInside = async () => {
				h.deps.setDoc = () => {
					h.deps.setDoc = setDoc;
					throw new Error('blew up');
				};
				await history.requestUndo();
			};
			return { ...door, afterThrow: undefined, throwInside, writeAgain: removeLast };
		}
	},
	{
		name: 'a `source` swap, thrown as it adopts the document',
		open() {
			let heard = 0;
			let doc: Document = initDocument(SOURCE, defaultGrammarView).doc;
			let throws = false;
			const starts = createKeptStarts(
				() => doc,
				() => {}
			);
			const selection = createSelectionState({ onChange: () => heard++, getDoc: () => doc });
			const swap = createDocumentSwap({
				grammar: defaultGrammarView,
				currentSource: () => '',
				stamps: { retire() {} },
				drafts: { closeAll() {} },
				markHover: { end() {} },
				flushDebouncedCheckpoint() {},
				noteTreeSwap() {},
				adoptDocument(next) {
					if (throws) throw new Error('blew up');
					doc = next;
				},
				starts,
				clearBlockRefs() {},
				layout: { forgetMeasuredHeights() {} },
				undoManager: { clear() {} },
				caretMemory: { forget() {} },
				menus: { closeAll() {} },
				selection,
				adoptLinkReferences() {},
				events: { emit() {} }
			});
			const swapTo = (source: string, failing: boolean) => async () => {
				throws = failing;
				swap.swapTo(source);
			};
			return {
				starts,
				selection,
				heard: () => heard,
				throwInside: swapTo('never adopted\n', true),
				writeAgain: swapTo('adopted\n\nblock\n', false)
			};
		}
	}
];

describe.each(DOORS)('a write window closes after $name', ({ open }) => {
	it('reads fail no dev build, a selection change is heard, the next write is kept', async () => {
		const door = await open();
		door.starts.read().starts.end(0);
		expect(door.starts.isMeasured()).toBe(true);

		await expect(door.throwInside()).rejects.toThrow('blew up');

		door.afterThrow?.();
		door.starts.read().starts.end(0);
		expect(takeDevWarns()).toEqual([]);
		const before = door.heard();
		door.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 1 });
		expect(door.heard()).toBe(before + 1);

		await door.writeAgain();

		expect(door.starts.unannounced()).toBe(false);
		const read = door.starts.read();
		read.starts.end(0);
		expect(door.starts.isMeasured()).toBe(true);
		expect(door.starts.read()).toBe(read);
		expect(takeDevWarns()).toEqual([]);
	});
});
