// @vitest-environment jsdom
//
// A structural paste lands at the END of the pasted run, so its target index scales with
// the CLIPBOARD, not the caret, and the landing goes through the reveal seam that mounts
// an off-window target first (VR-12). The other paste suites never run `afterTick`, so
// nothing else observes the landing at all.
import { describe, it, expect, vi } from 'vitest';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { parse } from '$lib/core/parser';
import {
	makeRunningPasteController,
	makeStubBlockEdit,
	registerStubBlockListState
} from '../../harness/editor-actions';
import type { UndoEntryMode } from '$lib/action-contracts';
import { CURSOR_END } from '$lib/block-component';
import type { PasteCommitCoordinator } from '$lib/tree-operations/paste/paste-deps';

/** The harness owned-scope protocol plus the post-tick callback the real ceremony runs —
 *  the part the sibling paste suites stub away. */
function landingController(): {
	controller: PasteCommitCoordinator;
	landCaret: ReturnType<typeof vi.fn>;
} {
	const landCaret = vi.fn(async () => {});
	const base = makeRunningPasteController();
	const controller = {
		...base,
		landCaret,
		commitMultiScope: vi.fn(async (args: { afterTick?: () => void | Promise<void> }) => {
			await (base.commitMultiScope as (a: unknown) => Promise<void>)(args);
			await args.afterTick?.();
		})
	} as unknown as PasteCommitCoordinator;
	return { controller, landCaret };
}

/** `undoEntry` is the route selector: 'join' (cross-block) reaches container-match,
 *  'own' (single-block) falls through to the absorb route. */
async function pasteInto(
	doc: ReturnType<typeof parse>,
	pastedText: string,
	targetPath: number[],
	offset: number,
	undoEntry: UndoEntryMode
) {
	const { controller, landCaret } = landingController();
	registerStubBlockListState(doc.children[0]);
	await pasteDispatch(
		{ pastedText, targetPath, offset },
		{ doc, blockEdit: makeStubBlockEdit(), controller, undoEntry }
	);
	return landCaret;
}

describe('structural paste lands its caret through the reveal seam', () => {
	it('same-type absorb lands on the last pasted item, past the residue', async () => {
		const doc = parse('- alpha\n- keep\n');

		// Caret mid-word, so the split leaves a residue item the landing must skip.
		const landCaret = await pasteInto(doc, '- x\n- y\n', [0, 0, 0], 'al'.length, 'own');

		expect(landCaret).toHaveBeenCalledTimes(1);
		expect(landCaret).toHaveBeenCalledWith([0, 2], CURSOR_END);
	});

	it('container-match merge lands on the merged leaf when the clipboard is one item', async () => {
		const doc = parse('- alpha\n- keep\n');

		const landCaret = await pasteInto(doc, '- x\n', [0, 0, 0], 'alpha'.length, 'join');

		// Doc-absolute path of the merged paragraph, before the reattached residue.
		expect(landCaret).toHaveBeenCalledTimes(1);
		expect(landCaret).toHaveBeenCalledWith([0, 0, 0], 'alphax'.length);
	});

	it('container-match merge lands on the last spliced item for a multi-item clipboard', async () => {
		const doc = parse('- alpha\n- keep\n');

		const landCaret = await pasteInto(doc, '- x\n- y\n', [0, 0, 0], 'alpha'.length, 'join');

		expect(landCaret).toHaveBeenCalledTimes(1);
		expect(landCaret).toHaveBeenCalledWith([0, 1, 0], 'y'.length);
	});
});
