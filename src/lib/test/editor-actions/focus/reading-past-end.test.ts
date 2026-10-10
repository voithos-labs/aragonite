// @vitest-environment jsdom
// Miss-analysis: the past-the-end append was tested only in source mode, never in reading mode.
import { describe, it, expect, vi } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { createFocusActions } from '#lib/editor-actions/focus/focus.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { READING_WRITE_TAG } from '#lib/editor-actions/commit/reading-write-gate.js';
import { makeEditorActionsDeps, stubBlockComponent } from '#lib/test/harness/editor-actions.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';

const SOURCE = 'one\n\ntwo\n';

function harnessFor(mode: PresentationMode) {
	const { deps, doc } = makeEditorActionsDeps(parse(SOURCE).children, {
		reading: fixtureReading({}, mode)
	});
	const focused: number[] = [];
	deps.setBlockRefs(
		doc.children.map((_, i) => stubBlockComponent({ focus: vi.fn(() => focused.push(i)) }))
	);
	const focus = createFocusActions(deps, createUndoController(deps));
	return { deps, focused, moveDown: () => focus.moveFocus(doc.children.length, 'start') };
}

const readingWrites = () => takeDevWarns().filter((w) => w.tag === READING_WRITE_TAG);

describe('moveFocus past the last block', () => {
	it('stops at the last block in reading mode, writing nothing', async () => {
		const h = harnessFor('reading');

		await h.moveDown();

		expect(serialize(h.deps.doc)).toBe(SOURCE);
		expect(h.deps.undoManager.canUndo).toBe(false);
		expect(readingWrites()).toEqual([]);
	});

	it('appends a paragraph in source mode', async () => {
		const h = harnessFor('source');

		await h.moveDown();

		expect(serialize(h.deps.doc)).toBe(`${SOURCE}\n\n`);
		expect(h.deps.undoManager.canUndo).toBe(true);
	});
});
