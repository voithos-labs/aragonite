// @vitest-environment jsdom
//
// Every structural paste lands at the END of the pasted run, so its target index
// scales with the CLIPBOARD, not with where the caret was. That landing goes
// through the coordinator's reveal seam (`landCaret`), which mounts an off-window
// target first — VR-12. These pin the doc-absolute coordinate each route hands it:
// the existing paste suites never run `afterTick`, so nothing else observes the
// landing at all.
import { describe, it, expect, vi } from 'vitest';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { parse } from '$lib/core/parser';
import { createSharingState, type SharingState } from '$lib/tree-operations/sharing';
import { rebuildOwnedContainer } from '$lib/tree-operations/unshare';
import {
	expectStateForNode,
	getStateForNode,
	registerBlockListState
} from '$lib/reactivity/state-registry';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import type { CstNode } from '$lib/core/nodes';
import type { UndoEntryMode } from '$lib/action-contracts';
import { CURSOR_END, type BlockComponent } from '$lib/block-component';
import type { PasteCommitCoordinator } from '$lib/tree-operations/paste/paste-deps';

function registerStubState(node: CstNode): void {
	registerBlockListState(node, {
		innerBlockIds: (node.children ?? []).map((_, i) => `iid-${i}`),
		innerBlockRefs: (node.children ?? []).map(() => undefined as BlockComponent | undefined)
	} as unknown as Parameters<typeof registerBlockListState>[1]);
}

/** Owned-scope protocol plus the post-tick callback the real ceremony runs — the
 *  part the sibling paste suites stub away. `afterTick` is awaited here exactly as
 *  the ceremony awaits it, so a landing left unreturned reads as a missing call. */
function landingController(): {
	controller: PasteCommitCoordinator;
	landCaret: ReturnType<typeof vi.fn>;
} {
	const landCaret = vi.fn(async () => {});
	const controller = {
		sharing: createSharingState(),
		getDocScope: vi.fn(),
		resolveState: getStateForNode,
		expectState: expectStateForNode,
		landCaret,
		commitMultiScope: vi.fn(
			async ({
				scopes,
				mutate,
				afterTick
			}: {
				scopes: { node: CstNode }[];
				mutate: (v: { children: CstNode[]; node: CstNode; sharing: SharingState }[]) => unknown;
				afterTick?: () => void | Promise<void>;
			}) => {
				const sharing = createSharingState();
				const views = scopes.map((s) => {
					const children = [...(s.node.children ?? [])];
					s.node.children = children;
					return { children, node: s.node, sharing };
				});
				mutate(views);
				for (const s of scopes) rebuildOwnedContainer(s.node, sharing);
				await afterTick?.();
			}
		)
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
	registerStubState(doc.children[0]);
	await pasteDispatch(
		{ pastedText, targetPath, offset },
		{ doc, blockEdit: makeStubBlockEdit(), controller, undoEntry }
	);
	return landCaret;
}

describe('structural paste lands its caret through the reveal seam', () => {
	it('same-type absorb lands on the last pasted item, past the residue', async () => {
		const doc = parse('- alpha\n- keep\n');

		// Caret mid-word, so the split leaves a residue item the landing must skip:
		// item 0 becomes ['al', x, y, 'pha'] and the caret belongs on 'y'.
		const landCaret = await pasteInto(doc, '- x\n- y\n', [0, 0, 0], 'al'.length, 'own');

		expect(landCaret).toHaveBeenCalledTimes(1);
		expect(landCaret).toHaveBeenCalledWith([0, 2], CURSOR_END);
	});

	it('container-match merge lands on the merged leaf when the clipboard is one item', async () => {
		const doc = parse('- alpha\n- keep\n');

		const landCaret = await pasteInto(doc, '- x\n', [0, 0, 0], 'alpha'.length, 'join');

		// Doc-absolute path of the merged paragraph, at the end of the pasted text
		// and before the reattached residue.
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
