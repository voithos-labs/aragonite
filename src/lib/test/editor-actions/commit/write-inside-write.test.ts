// @vitest-environment jsdom
// A write started while another is open (from a write rule, a `rebuildRaw`, a block's own hook) is
// refused, whatever its entry and whatever the outer write: nothing written, no undo entry, no
// `edit`, the `error` event hears it, a dev build throws where it started, and production answers
// as a refused write does. The outer write lands whole. A text read in there still serializes.
// Miss-analysis: the only rows that nested a write asserted the inner one landed, and none ran an
// outer write alone beside it, so nobody saw the outer write's publish erase the inner one's bytes.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { configureEditorEnv, resetEditorEnv } from '@voithos-labs/aragonite/dev-checks';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import {
	createDocumentSwap,
	type DocumentSwap
} from '#lib/components/editor-root/document-swap.js';
import { createHistoryActions } from '#lib/editor-actions/commit/history.js';
import type { KeptStarts } from '#lib/editor-actions/commit/kept-starts.js';
import type { HistoryActions } from '#lib/action-contracts.js';
import type { Draft } from '#lib/schema/drafts.js';
import { definePlugin } from '#lib/schema/plugin-install.js';
import type { EditorError } from '#lib/editor-events.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { serialize } from '#lib/core/serializer.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { makeTopHarness, type TopHarness } from '#lib/test/harness/editor-actions.js';
import { draftRegistryOver } from '#lib/test/harness/drafts.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { takeDevWarns } from '../../support/warn-gate';

const NESTED = 'aragonite: a write started inside another write';

const BUILDS = [
	{ build: 'a dev build', isDev: true },
	{ build: 'a production build', isDev: false }
];

beforeAll(installLayoutStubs);
afterEach(async () => {
	resetEditorEnv();
	await destroyMountedEditors();
});

/** Runs `inside` once, in the next write's window: after its tree change, before it announces. */
function insideNextWrite(starts: KeptStarts, inside: () => void): void {
	const open = starts.duringWrite;
	starts.duringWrite = (write) => {
		starts.duringWrite = open;
		return open(() => {
			const written = write();
			inside();
			return written;
		});
	};
}

/** Starts a write and keeps what it answered, or what it threw, synchronously or not. */
function started(start: () => unknown) {
	const kept: { answer?: unknown; thrown?: unknown } = {};
	let settled: Promise<unknown> = Promise.resolve();
	const run = () => {
		try {
			const answer = start();
			if (answer instanceof Promise) {
				settled = answer.then(
					(value) => (kept.answer = value),
					(error) => (kept.thrown = error)
				);
			} else kept.answer = answer;
		} catch (error) {
			kept.thrown = error;
		}
	};
	return { run, kept, settled: () => settled };
}

/** The dev warnings a nested write may leave: a position read in a window, which stays as it is. */
function positionReadsOnly(): void {
	const tags = takeDevWarns().map((warn) => warn.tag);
	expect(tags.filter((tag) => tag !== 'invariant:kept-starts-current')).toEqual([]);
}

// ── Every internal entry, from inside every kind of outer write ─────────────

const SOURCE = 'zero\n\none\n\ntwo\n\nthree\n';
const at = (index: number) => ({ path: docPathFrom([index]), offset: 0 });
const draftOp = { kind: 'replaceBlock', detail: { source: 'draft' } } as const;

/** The published headless deps (`createHeadlessActions`, under `makeTopHarness`) and every write
 *  entry point over them. */
interface Doors {
	h: TopHarness;
	history: HistoryActions;
	swap: DocumentSwap;
	draft(): Draft;
	errors: EditorError[];
}

/** An editor over `SOURCE` whose first block a write already changed, so an undo has an entry. */
async function doors(onSelectionChange?: () => void): Promise<Doors> {
	const h = makeTopHarness(SOURCE, { onSelectionChange: () => onSelectionChange?.() });
	const history = createHistoryActions(h.deps, h.controller);
	const swap = createDocumentSwap({
		grammar: defaultGrammarView,
		currentSource: () => serialize(h.deps.doc),
		doc: () => h.deps.doc,
		stamps: h.deps.stamps,
		drafts: { closeAll() {}, watching: () => false, record() {} },
		markHover: { end() {} },
		flushDebouncedCheckpoint: () => h.controller.flushDebouncedCheckpoint(),
		noteTreeSwap() {},
		adoptDocument: (next) => h.deps.setDoc(next),
		starts: h.deps.starts,
		clearBlockRefs() {},
		layout: { forgetMeasuredHeights() {} },
		undoManager: h.deps.undoManager,
		caretMemory: h.deps.caretMemory,
		menus: { closeAll() {} },
		selection: h.deps.selectionState,
		adoptLinkReferences() {},
		events: h.events
	});
	const drafts = draftRegistryOver(h);
	await h.controller.commitSource({
		changes: [{ from: 0, to: 4, insert: 'ZERO' }],
		caret: 'keep',
		op: draftOp,
		snapshot: at(0)
	});
	const errors: EditorError[] = [];
	h.events.on('error', (error) => errors.push(error));
	return { h, history, swap, draft: () => drafts.edit(), errors };
}

/** What a write leaves that a user or a host can see. */
function outcome({ h }: Doors) {
	const { undo, redo } = h.deps.undoManager.getStacks();
	return {
		source: serialize(h.deps.doc),
		undo: undo.length,
		redo: redo.length,
		edits: h.edits.map((edit) => edit.op),
		version: h.contentVersion()
	};
}

const OUTERS: { name: string; run(d: Doors): Promise<unknown> }[] = [
	{
		name: 'a keystroke written in place',
		run: (d) => d.h.actions.updateBlockContent(2, 'two!\n', 'authored', 'join-typing', 3, 4)
	},
	{
		name: 'a structural commit',
		run: (d) =>
			d.h.controller.commitStructural({
				snapshot: at(3),
				mutate: (children) => {
					children.splice(3, 1);
					return { op: 'delete', at: 3, count: 1 };
				}
			})
	},
	{
		name: 'a byte splice',
		run: (d) =>
			d.h.controller.commitSource({
				changes: [{ from: 11, to: 14, insert: 'TWO' }],
				caret: 'keep',
				op: draftOp,
				snapshot: at(2)
			})
	},
	{ name: 'an undo', run: async (d) => d.history.requestUndo() },
	{ name: 'a `source` swap', run: async (d) => d.swap.swapTo('swapped\n\nin\n') },
	{ name: 'a re-read under a changed plugin list', run: async (d) => d.swap.reparse() }
];

/** Each write entry, aimed at the second block, and what production answers when it is refused.
 *  `undoGateFirst`: inside an undo, the undo's own gate declines it before it can ask, quietly. */
const INNERS: { name: string; start(d: Doors): unknown; refused: unknown; undoGateFirst?: true }[] =
	[
		{
			name: 'a keystroke',
			start: (d) => d.h.actions.updateBlockContent(1, 'one?\n', 'authored', 'join-typing', 3, 4),
			refused: false,
			undoGateFirst: true
		},
		{
			name: 'a keystroke written in place (`typeLeaf`)',
			start: (d) =>
				d.h.controller.typeLeaf(
					docPathFrom([1]),
					legalizeWrite(d.h.deps.doc, 1, 'one?\n', 'authored', defaultGrammarView),
					4
				),
			refused: { wrote: false }
		},
		{
			name: 'a structural commit',
			start: (d) =>
				d.h.controller.commitStructural({
					snapshot: at(1),
					mutate: (children) => {
						children.splice(1, 1);
						return { op: 'delete', at: 1, count: 1 };
					}
				}),
			refused: false
		},
		{
			name: 'a byte splice',
			start: (d) =>
				d.h.controller.commitSource({
					changes: [{ from: 6, to: 9, insert: 'ONE' }],
					caret: 'keep',
					op: draftOp,
					snapshot: at(1)
				}),
			refused: false
		},
		{
			name: "a draft's commit",
			start: (d) => d.draft().replace({ from: 6, to: 9 }, 'ONE').commit(),
			refused: { ok: false, reason: 'busy', message: 'it was committed inside another write' }
		},
		{ name: 'a range gesture', start: (d) => d.h.controller.admitsGesture(null), refused: false },
		{ name: 'an undo', start: (d) => d.history.requestUndo(), refused: undefined },
		{ name: 'a redo', start: (d) => d.history.requestRedo(), refused: undefined },
		{ name: 'a `source` swap', start: (d) => d.swap.swapTo('other\n'), refused: undefined },
		{
			name: 'a re-read under a changed plugin list',
			start: (d) => d.swap.reparse(),
			refused: undefined
		}
	];

describe.each(BUILDS)('a write started inside another, in $build', ({ isDev }) => {
	describe.each(OUTERS)('inside $name', (outer) => {
		it.each(INNERS)('$name is refused and the outer write lands whole', async (inner) => {
			const alone = await doors();
			await outer.run(alone);

			const d = await doors();
			const write = started(() => inner.start(d));
			insideNextWrite(d.h.deps.starts, write.run);
			configureEditorEnv({ isDev });
			await outer.run(d);
			await write.settled();

			expect(outcome(d)).toEqual(outcome(alone));
			const quiet = inner.undoGateFirst && outer.name === 'an undo';
			expect(d.errors.map((e) => [e.origin, (e.error as Error).message])).toEqual(
				quiet ? [] : [['commit', NESTED]]
			);
			if (isDev && !quiet) expect((write.kept.thrown as Error).message).toBe(NESTED);
			else expect([write.kept.thrown, write.kept.answer]).toEqual([undefined, inner.refused]);
			positionReadsOnly();
		});
	});
});

describe.each(BUILDS)('a refused write leaves the outer one going on, in $build', ({ isDev }) => {
	it("the next keystroke joins the outer keystroke's undo entry", async () => {
		const nextKey = (d: Doors) =>
			d.h.actions.updateBlockContent(2, 'two!!\n', 'authored', 'join-typing', 4, 5);
		const alone = await doors();
		await OUTERS[0].run(alone);
		await nextKey(alone);

		const d = await doors();
		const write = started(() => INNERS[2].start(d));
		insideNextWrite(d.h.deps.starts, write.run);
		configureEditorEnv({ isDev });
		await OUTERS[0].run(d);
		await write.settled();
		await nextKey(d);

		expect(outcome(d)).toEqual(outcome(alone));
		expect(d.errors).toHaveLength(1);
	});
});

// ── After the announcement ──────────────────────────────────────────────────

describe('a write started once the outer one has announced', () => {
	it.each(['edit', 'selectionChange'] as const)('from a `%s` handler lands', async (event) => {
		let handler: (() => void) | null = null;
		const d = await doors(() => event === 'selectionChange' && handler?.());
		if (event === 'edit') d.h.events.on('edit', () => handler?.());
		// The byte splice clears a range the editor holds, which a listener hears once it announces.
		d.h.deps.selectionState.enterCrossBlock({ path: [2], offset: 0 }, { path: [3], offset: 1 });
		let landed: Promise<boolean> | null = null;
		handler = () => {
			handler = null;
			landed = d.h.controller.commitSource({
				changes: [{ from: 6, to: 9, insert: 'ONE' }],
				caret: 'keep',
				op: draftOp,
				snapshot: at(1)
			});
		};
		await OUTERS[2].run(d);

		expect(await landed).toBe(true);
		expect(serialize(d.h.deps.doc)).toBe('ZERO\n\nONE\n\nTWO\n\nthree\n');
		expect(d.errors).toEqual([]);
	});
});

// ── The public entries, in a mounted editor ─────────────────────────────────

type Mounted = MountedEditor<EditorTestSurface>;

const LINES = Array.from({ length: 12 }, (_, i) => `line ${i}\n`).join('\n');

/** An editor holding a range from block 3 into block 5, its text and positions already asked for. */
async function mountedHoldingRange(): Promise<Mounted> {
	const m = mountEditor<EditorTestSurface>({ source: LINES });
	await m.settle();
	m.instance.__test.byteOf([3], 0);
	m.source();
	await m.instance.setSelection({
		anchor: { path: [3], offset: 2 },
		focus: { path: [5], offset: 2 }
	});
	await m.settle();
	return m;
}

/** Runs `inside` once from within the next write: the removal clears the caret after it changes
 *  the tree and before it announces. */
function insideRemoval(m: Mounted, inside: () => void): void {
	const writer = m.instance.__test.getCaretWriter();
	const clear = writer.clear;
	writer.clear = () => {
		writer.clear = clear;
		clear();
		inside();
	};
}

const backspace = async (m: Mounted) => {
	await pressKey(surfaceAt(m, [3]), { key: 'Backspace' });
	await m.settle();
};

/** How many times the plugin a refused `use` lists was asked for its definitions. */
let contributed = 0;
const listed = () =>
	definePlugin({
		name: 'listed-inside-a-write',
		version: '1.0.0',
		editor: '*',
		contributes: () => (contributed++, {})
	});

const PUBLIC: { name: string; start(m: Mounted): unknown; refused: unknown }[] = [
	{
		name: '`edit().commit()`',
		start: (m) => m.instance.edit().replace({ from: 0, to: 0 }, 'Z').commit(),
		refused: { ok: false, reason: 'busy', message: 'it was committed inside another write' }
	},
	{ name: '`insertMarkdown`', start: (m) => m.instance.insertMarkdown('Z'), refused: false },
	{ name: '`runCommand`', start: (m) => m.instance.runCommand('history.undo'), refused: false },
	// Refused before it installs anything, so the editor still runs the list it ran.
	{ name: '`use`', start: (m) => m.instance.use([listed()]), refused: undefined }
];

describe.each(BUILDS)('a public write started inside another, in $build', ({ isDev }) => {
	it.each(PUBLIC)('$name is refused and the outer write lands whole', async (entry) => {
		const alone = await mountedHoldingRange();
		await backspace(alone);
		const removed = alone.source();

		const m = await mountedHoldingRange();
		contributed = 0;
		const errors: EditorError[] = [];
		m.instance.getEvents().on('error', (error) => errors.push(error));
		const write = started(() => entry.start(m));
		insideRemoval(m, write.run);
		configureEditorEnv({ isDev });
		await backspace(m);
		await write.settled();
		await m.settle();

		expect(m.source()).toBe(removed);
		expect(errors.map((e) => [e.origin, (e.error as Error).message])).toEqual([['commit', NESTED]]);
		if (isDev) expect((write.kept.thrown as Error).message).toBe(NESTED);
		else expect([write.kept.thrown, write.kept.answer]).toEqual([undefined, entry.refused]);
		expect(contributed).toBe(0);
		positionReadsOnly();
	});

	it('a text read there is the tree as it stands', async () => {
		const alone = await mountedHoldingRange();
		await backspace(alone);
		const removed = alone.source();
		expect(removed).not.toBe(LINES);

		const m = await mountedHoldingRange();
		let read = '';
		insideRemoval(m, () => (read = m.instance.getSource()));
		configureEditorEnv({ isDev });
		await backspace(m);

		expect(read).toBe(removed);
		expect(takeDevWarns()).toEqual([]);
	});
});

// Miss-analysis: the rows after the announcement wrote through the commit's own entry points, so
// no row held a host's `use` or `edit` from an `edit` handler to the answer the guide gives it.
describe('a public write started from an `edit` handler', () => {
	/** The source and what `start` answered, run once from the `edit` a removal announces. */
	async function fromEdit<T>(start: (m: Mounted) => T) {
		const alone = await mountedHoldingRange();
		await backspace(alone);
		const m = await mountedHoldingRange();
		const errors: EditorError[] = [];
		m.instance.getEvents().on('error', (error) => errors.push(error));
		let answer: T | undefined;
		const off = m.instance.getEvents().on('edit', () => {
			off();
			answer = start(m);
		});
		await backspace(m);
		expect(errors).toEqual([]);
		return { m, removed: alone.source(), answer: await answer };
	}

	it('`use` changes the plugin list and reads the same bytes again', async () => {
		contributed = 0;
		const { m, removed } = await fromEdit((m) => m.instance.use([listed()]));
		expect(contributed).toBe(1);
		expect(m.instance.plugins).toEqual(['listed-inside-a-write']);
		expect(m.source()).toBe(removed);
	});

	it('`edit().commit()` lands', async () => {
		const { m, removed, answer } = await fromEdit((m) =>
			m.instance.edit().replace({ from: 0, to: 0 }, 'Z').commit()
		);
		await m.settle();
		expect(answer).toEqual({ ok: true });
		expect(m.source()).toBe('Z' + removed);
	});
});
