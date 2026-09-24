// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import {
	makeEditorActionsDeps,
	makeStubBlockEdit,
	pasteContext
} from '$lib/test/harness/editor-actions';

// The structural counterpart of `inline-join-upper-absorb`: the fix-up merges the paste's
// window, so the precomputed block index and its `CURSOR_END` both stop naming the end of the
// pasted bytes; the residue the merge reattached sits behind them.
// Miss-analysis: the structural-paste caret suites pin the block index and the resulting bytes,
// never the offset inside the landed block, so `CURSOR_END`'s meaning changing under the fix-up
// was unobservable; no fixture put the target's residue where the last pasted block absorbs it.

async function pasteAt(source: string, pastedText: string, targetPath: number[], offset: number) {
	const { deps } = makeEditorActionsDeps(parse(source));
	const coordinator = createPasteCoordinator(createUndoController(deps), deps.revealPath);
	const landCaret = vi.spyOn(coordinator, 'landCaret');

	await pasteDispatch(
		{ pastedText, targetPath, offset },
		pasteContext({
			doc: deps.doc,
			blockEdit: makeStubBlockEdit(),
			controller: coordinator,
			undoEntry: 'own'
		})
	);
	return { doc: deps.doc, landCaret };
}

describe('structural paste landing after the splice settle folds', () => {
	it('lands where the pasted bytes end inside the leaf that absorbed the residue', async () => {
		const { doc, landCaret } = await pasteAt('helloworld\n', 'one\n\ntwo', [0], 5);

		expect(serialize(doc)).toBe('hello\n\none\n\ntwo\nworld\n');
		expect(landCaret).toHaveBeenCalledWith([2], 'two'.length);
	});

	it('follows the slot down when the block above absorbs the pasted window', async () => {
		const { doc, landCaret } = await pasteAt('- a\n\nzz\n', '  b\n\nmore', [1], 0);

		expect(serialize(doc)).toBe('- a\n\n  b\n\nmore\nzz\n');
		expect(doc.children).toHaveLength(2);
		expect(landCaret).toHaveBeenCalledWith([1], 'more'.length);
	});

	it('lands the same caret position when nothing folds', async () => {
		const { doc, landCaret } = await pasteAt('helloworld\n', 'one\n\ntwo\n\n', [0], 5);

		expect(serialize(doc)).toBe('hello\n\none\n\ntwo\n\nworld\n');
		expect(landCaret).toHaveBeenCalledWith([2], 'two'.length);
	});

	// The fold head is a container here, so the pasted bytes end inside one of its leaves (GH #193).
	it('lands inside the container leaf that absorbed the residue', async () => {
		const { doc, landCaret } = await pasteAt('helloworld\n', '- item', [0], 5);

		expect(serialize(doc)).toBe('hello\n\n- item\nworld\n');
		expect(landCaret).toHaveBeenCalledWith([1, 0, 0], 'item'.length);
	});

	// The quote takes the line after the caret in lazily (GH #447).
	it('lands after the pasted quote text, not after the line it absorbed', async () => {
		const { doc, landCaret } = await pasteAt('abc\nAfter\n', '> q', [0], 3);

		expect(serialize(doc)).toBe('abc\n\n> q\nAfter\n');
		expect(landCaret).toHaveBeenCalledWith([1, 0], 'q'.length);
	});

	it('descends through nested containers', async () => {
		const { doc, landCaret } = await pasteAt('helloworld\n', '> - item', [0], 5);

		expect(serialize(doc)).toBe('hello\n\n> - item\nworld\n');
		expect(landCaret).toHaveBeenCalledWith([1, 0, 0, 0], 'item'.length);
	});
});
