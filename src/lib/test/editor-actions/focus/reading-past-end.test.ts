// @vitest-environment jsdom
//
// Miss-analysis: the past-the-end append was only tested in source mode, and no test pressed a
// move past the last block in reading mode, where the commit refuses the paragraph it offers.
import { describe, it, expect, vi } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createFocusActions } from '$lib/editor-actions/focus/focus';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { READING_WRITE_TAG } from '$lib/editor-actions/commit/reading-write-gate';
import { makeEditorActionsDeps, stubBlockComponent } from '$lib/test/harness/editor-actions';
import type { PresentationMode } from '$lib/presentation-mode';
import { fixtureReading } from '$lib/test/harness/fixture-grammar';
import { takeDevWarns } from '$lib/test/support/warn-gate';

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
