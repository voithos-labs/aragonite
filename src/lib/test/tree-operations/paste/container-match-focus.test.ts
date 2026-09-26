// @vitest-environment jsdom
//
// A structural paste lands at the end of the pasted run, so its target index scales with
// the clipboard, not the caret, and the caret placement goes through the path that mounts
// an unmounted target first (VR-12). The other paste suites never run `afterTick`, so
// nothing else observes where the caret ends up at all.
import { describe, it, expect, vi } from 'vitest';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import {
	makePasteCommit,
	makeStubBlockEdit,
	registerStubBlockListState,
	pasteContext
} from '../../harness/editor-actions';
import { CURSOR_END } from '$lib/block-component';

/** `crossBlock` is the route selector: the cross-block route reaches container-match, the
 *  single-block route falls through to the absorb route. */
async function pasteInto(
	source: string,
	pastedText: string,
	targetPath: number[],
	offset: number,
	crossBlock: boolean
) {
	const { doc, controller } = makePasteCommit(source);
	const landCaret = vi.spyOn(controller, 'landCaret');
	registerStubBlockListState(doc.children[0]);
	await pasteDispatch(
		{ pastedText, targetPath, offset },
		pasteContext({ doc, blockEdit: makeStubBlockEdit(), controller, crossBlock })
	);
	return landCaret;
}

describe('structural paste lands its caret through the reveal join', () => {
	it('same-type absorb lands on the last pasted item, past the residue', async () => {
		// Caret mid-word, so the split leaves a residue item the caret placement must skip.
		const landCaret = await pasteInto(
			'- alpha\n- keep\n',
			'- x\n- y\n',
			[0, 0, 0],
			'al'.length,
			false
		);

		expect(landCaret).toHaveBeenCalledTimes(1);
		expect(landCaret).toHaveBeenCalledWith([0, 2], CURSOR_END);
	});

	it('container-match merge lands on the merged leaf when the clipboard is one item', async () => {
		const landCaret = await pasteInto(
			'- alpha\n- keep\n',
			'- x\n',
			[0, 0, 0],
			'alpha'.length,
			true
		);

		// Doc-absolute path of the merged paragraph, before the reattached residue.
		expect(landCaret).toHaveBeenCalledTimes(1);
		expect(landCaret).toHaveBeenCalledWith([0, 0, 0], 'alphax'.length);
	});

	it('container-match merge lands on the last spliced item for a multi-item clipboard', async () => {
		const landCaret = await pasteInto(
			'- alpha\n- keep\n',
			'- x\n- y\n',
			[0, 0, 0],
			'alpha'.length,
			true
		);

		expect(landCaret).toHaveBeenCalledTimes(1);
		expect(landCaret).toHaveBeenCalledWith([0, 1, 0], 'y'.length);
	});
});
