// @vitest-environment jsdom
// A structural paste puts the caret at the end of the pasted run, so its index scales with the
// clipboard, not the caret, and the paste's commit hands that position to the caret landing once.
// No other paste suite checks where the caret ends up.
import { describe, it, expect } from 'vitest';
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
	const { doc, controller, landings } = makePasteCommit(source);
	registerStubBlockListState(doc.children[0]);
	await pasteDispatch(
		{ pastedText, targetPath, offset },
		pasteContext({ doc, blockEdit: makeStubBlockEdit(), controller, crossBlock })
	);
	return landings.map(({ leafPath, offset }) => ({ leafPath, offset }));
}

describe('structural paste lands its caret through the commit', () => {
	it('same-type absorb lands on the last pasted item, past the residue', async () => {
		// Caret mid-word, so the split leaves a residue item the caret placement must skip.
		const landings = await pasteInto(
			'- alpha\n- keep\n',
			'- x\n- y\n',
			[0, 0, 0],
			'al'.length,
			false
		);

		expect(landings).toEqual([{ leafPath: [0, 2, 0], offset: CURSOR_END }]);
	});

	it('container-match merge lands on the merged leaf when the clipboard is one item', async () => {
		const landings = await pasteInto('- alpha\n- keep\n', '- x\n', [0, 0, 0], 'alpha'.length, true);

		// Doc-absolute path of the merged paragraph, before the reattached residue.
		expect(landings).toEqual([{ leafPath: [0, 0, 0], offset: 'alphax'.length }]);
	});

	it('container-match merge lands on the last spliced item for a multi-item clipboard', async () => {
		const landings = await pasteInto(
			'- alpha\n- keep\n',
			'- x\n- y\n',
			[0, 0, 0],
			'alpha'.length,
			true
		);

		expect(landings).toEqual([{ leafPath: [0, 1, 0], offset: 'y'.length }]);
	});
});
