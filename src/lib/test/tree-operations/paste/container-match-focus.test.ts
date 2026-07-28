// @vitest-environment jsdom
//
// The container-match merge routes land their own caret. That focus dispatch used
// to be imported straight from `editor-actions/focus/` — the single back-edge that
// made `tree-operations -> editor-actions` a cycle, in the directory documented as
// "pure CST mutations". It now arrives through the paste coordinator the module
// already threads. These pin the wire: the existing merge tests never run
// `afterTick`, so nothing else observes the dispatch at all.
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
import type { BlockComponent } from '$lib/block-component';
import type { PasteCommitCoordinator } from '$lib/tree-operations/paste/paste-deps';

function registerStubState(node: CstNode): void {
	registerBlockListState(node, {
		innerBlockIds: (node.children ?? []).map((_, i) => `iid-${i}`),
		innerBlockRefs: (node.children ?? []).map(() => undefined as BlockComponent | undefined)
	} as unknown as Parameters<typeof registerBlockListState>[1]);
}

/** Owned-scope protocol plus the post-tick callback the real ceremony runs — the
 *  part the sibling merge suites stub away. */
function focusingController(): {
	controller: PasteCommitCoordinator;
	focusByPath: ReturnType<typeof vi.fn>;
} {
	const focusByPath = vi.fn();
	const controller = {
		sharing: createSharingState(),
		getDocScope: vi.fn(),
		resolveState: getStateForNode,
		expectState: expectStateForNode,
		focusByPath,
		commitMultiScope: vi.fn(
			async ({
				scopes,
				mutate,
				afterTick
			}: {
				scopes: { node: CstNode }[];
				mutate: (v: { children: CstNode[]; node: CstNode; sharing: SharingState }[]) => unknown;
				afterTick?: () => void;
			}) => {
				const sharing = createSharingState();
				const views = scopes.map((s) => {
					const children = [...(s.node.children ?? [])];
					s.node.children = children;
					return { children, node: s.node, sharing };
				});
				mutate(views);
				for (const s of scopes) rebuildOwnedContainer(s.node, sharing);
				afterTick?.();
			}
		)
	} as unknown as PasteCommitCoordinator;
	return { controller, focusByPath };
}

async function pasteInto(doc: ReturnType<typeof parse>, pastedText: string, offset: number) {
	const { controller, focusByPath } = focusingController();
	registerStubState(doc.children[0]);
	await pasteDispatch(
		{ pastedText, targetPath: [0, 0, 0], offset },
		{ doc, blockEdit: makeStubBlockEdit(), controller, undoEntry: 'join' }
	);
	return focusByPath;
}

/**
 * Argument 0 is what says the caret landed against the MATCHED container's mounted
 * refs. Deep equality can't carry that: every stub container's refs are an array of
 * `undefined`, so a wrong-container ref array of the same length compares equal.
 * Pin the array identity instead — that is as discriminating as this harness gets.
 */
function expectFocusedAt(
	focusByPath: ReturnType<typeof vi.fn>,
	refs: (BlockComponent | undefined)[],
	path: number[],
	offset: number
): void {
	expect(focusByPath).toHaveBeenCalledTimes(1);
	expect(focusByPath).toHaveBeenCalledWith(refs, path, offset);
	expect(focusByPath.mock.calls[0][0]).toBe(refs);
}

describe('container-matching merge lands its caret through the coordinator', () => {
	it('single-item clipboard focuses the merged leaf at the join', async () => {
		const doc = parse('- alpha\n- keep\n');

		const focusByPath = await pasteInto(doc, '- x\n', 'alpha'.length);

		// Sub-path relative to the list scope: item 0's paragraph, at the end of the
		// pasted text and before the reattached residue.
		expectFocusedAt(
			focusByPath,
			expectStateForNode(doc.children[0]).innerBlockRefs,
			[0, 0],
			'alphax'.length
		);
	});

	it('multi-item clipboard focuses the last spliced item', async () => {
		const doc = parse('- alpha\n- keep\n');

		const focusByPath = await pasteInto(doc, '- x\n- y\n', 'alpha'.length);

		expectFocusedAt(
			focusByPath,
			expectStateForNode(doc.children[0]).innerBlockRefs,
			[1, 0],
			'y'.length
		);
	});
});
