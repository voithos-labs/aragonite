// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { parse } from '../../../core/parser';
import { serialize } from '../../../core/serializer';
import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
import { createSharingState, type SharingState } from '../../../tree-operations/sharing';
import { rebuildOwnedContainer } from '../../../tree-operations/unshare';
import { registerBlockListState } from '../../../reactivity/state-registry';
import { makeStubBlockEdit, makeStubController } from '../../harness/editor-actions';
import { expectParseConverged } from '../../harness/parse-converged';
import type { CstNode } from '../../../core/nodes';
import type { BlockComponent } from '../../../block-component';
import type { UndoController } from '../../../editor-actions/deps';
import type { PasteCommitCoordinator } from '../../../tree-operations/paste/paste-deps';

// GH #56: the container-matching merge reattached the target's post-caret residue to the
// last clipboard item's leaf as a bare raw write, so bytes that cross a kind boundary (a
// fence closer landing in a paragraph) left the landed node's kind and children stale.
// Miss-analysis: the residue arm was driven with paragraph targets only, so the reattached
// slice never held another kind's bytes and no pin read the landed item's children.

function registerStubState(node: CstNode): void {
	registerBlockListState(node, {
		innerBlockIds: (node.children ?? []).map((_, i) => `iid-${i}`),
		innerBlockRefs: (node.children ?? []).map(() => undefined as BlockComponent | undefined)
	} as unknown as Parameters<typeof registerBlockListState>[1]);
}

// Mirrors the real primitive's owned-scope protocol: attach working children, run mutate,
// rebuild scope raws.
function runningController(): UndoController & PasteCommitCoordinator {
	return {
		...makeStubController(),
		commitMultiScope: vi.fn(
			async ({
				scopes,
				mutate
			}: {
				scopes: { node: CstNode }[];
				mutate: (v: { children: CstNode[]; node: CstNode; sharing: SharingState }[]) => unknown;
			}) => {
				const sharing = createSharingState();
				const views = scopes.map((s) => {
					const children = [...(s.node.children ?? [])];
					s.node.children = children;
					return { children, node: s.node, sharing };
				});
				mutate(views);
				for (const s of scopes) rebuildOwnedContainer(s.node, sharing);
			}
		)
	} as unknown as UndoController & PasteCommitCoordinator;
}

describe('container-matching merge reattaches residue through the reparse funnel (GH #56)', () => {
	it('a fence closer landing in the last pasted item re-reads as its own block', async () => {
		const doc = parse('- ```js\n  code\n  ```\n');
		expect(doc.children[0].children?.[0].children?.[0].kind).toBe('fencedCode');
		registerStubState(doc.children[0]);

		// Caret after `code`, so the residue is the fence's own closing line.
		await pasteDispatch(
			{ pastedText: '- one\n- two\n', targetPath: [0, 0, 0], offset: 10 },
			{ doc, blockEdit: makeStubBlockEdit(), controller: runningController(), undoEntry: 'join' }
		);

		const lastItem = doc.children[0].children?.[1];
		expect(lastItem?.children?.map((c) => c.kind)).toEqual(['paragraph', 'fencedCode']);
		expect(serialize(doc)).toBe('- ```js\n  codeone\n  ```\n- two\n  ```\n');
		expectParseConverged(doc);
	});
});
