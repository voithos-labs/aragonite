// What a keystroke does before it writes, at the root and in a container: it forgets how the
// caret arrived, and in reading mode it stops before the typing batch and the trial reparse.
// Miss-analysis: the reading-mode rows never read the caret memory after a key.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { createCaretMemory, type CaretMemory } from '#lib/caret/caret-memory.js';
import { asEditorX } from '#lib/caret/coordinate-spaces.js';
import type { UndoController } from '#lib/editor-actions/deps.js';
import { createBlockEditActions } from '#lib/editor-actions/block-edit.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { READING_WRITE_TAG } from '#lib/editor-actions/commit/reading-write-gate.js';
import { previewContentReparse } from '#lib/editor-actions/replacement-focus.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { makeEditorActionsDeps, makeNestedHarness } from '#lib/test/harness/editor-actions.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';

vi.mock('#lib/editor-actions/replacement-focus.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/editor-actions/replacement-focus.js')>();
	return { ...actual, previewContentReparse: vi.fn(actual.previewContentReparse) };
});

interface Keyed {
	controller: UndoController;
	/** One same-kind keystroke, `one` to `onex`, which writes in place when it is let through. */
	key(): Promise<unknown>;
}

const LEVELS: {
	level: string;
	mount(mode: PresentationMode, memory: CaretMemory): Keyed;
}[] = [
	{
		level: 'at the root',
		mount(mode, memory) {
			const h = makeEditorActionsDeps(parse('one\n'), { reading: fixtureReading({}, mode) });
			// Before the actions exist: the root's scope reads the caret memory once, when built.
			h.deps.caretMemory = memory;
			const controller = createUndoController(h.deps);
			const actions = createBlockEditActions(h.deps, controller);
			return {
				controller,
				key: () => actions.updateBlockContent(0, 'onex\n', 'authored', 3, 4)
			};
		}
	},
	{
		level: 'in a quote',
		mount(mode, memory) {
			const h = makeNestedHarness('> one\n', {
				index: 0,
				presentationMode: mode,
				caretMemory: memory
			});
			return {
				controller: h.controller,
				key: () => h.bundle.blockEdit.updateBlockContent(0, 'onex\n', 'authored', 3, 4)
			};
		}
	}
];

/** A caret that arrived by an Up/Down run and carries a pending bold. */
function rememberedCaret(): CaretMemory {
	const memory = createCaretMemory();
	memory.captureColumn(asEditorX(40));
	memory.pendingMarks.toggle('strong');
	return memory;
}

function refusedKeys(): number {
	return takeDevWarns().filter((w) => w.tag === READING_WRITE_TAG).length;
}

beforeEach(() => {
	vi.mocked(previewContentReparse).mockClear();
});

describe('a keystroke forgets how the caret arrived', () => {
	for (const { level, mount } of LEVELS) {
		for (const mode of ['source', 'reading'] as const) {
			it(`${level}, ${mode === 'source' ? 'writing in place' : 'refused in reading mode'}`, async () => {
				const memory = rememberedCaret();

				await mount(mode, memory).key();

				expect(memory.column()).toBeNull();
				expect(memory.pendingMarks.get()).toBeNull();
				expect(refusedKeys()).toBe(mode === 'reading' ? 1 : 0);
			});
		}
	}
});

describe('a keystroke joins its typing batch and runs its trial reparse only past reading mode', () => {
	for (const { level, mount } of LEVELS) {
		for (const mode of ['source', 'reading'] as const) {
			const runs = mode === 'source' ? 1 : 0;
			it(`${level}, in ${mode} mode`, async () => {
				const keyed = mount(mode, createCaretMemory());
				const push = vi.spyOn(keyed.controller, 'pushUndoSnapshotDebounced');
				const join = vi.spyOn(keyed.controller, 'joinTypingBatch');

				await keyed.key();

				expect(push).toHaveBeenCalledTimes(runs);
				expect(join).toHaveBeenCalledTimes(runs);
				expect(previewContentReparse).toHaveBeenCalledTimes(runs);
				expect(refusedKeys()).toBe(1 - runs);
			});
		}
	}
});
