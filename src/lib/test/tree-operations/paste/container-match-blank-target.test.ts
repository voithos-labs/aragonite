// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createSharingState, type SharingState } from '$lib/tree-operations/sharing';
import { rebuildOwnedContainer } from '$lib/tree-operations/unshare';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { makeStubBlockEdit, makeStubController } from '$lib/test/harness/editor-actions';
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import type { CstNode } from '$lib/core/nodes';
import type { BlockComponent } from '$lib/block-component';
import type { UndoController } from '$lib/editor-actions/deps';
import type { PasteCommitCoordinator } from '$lib/tree-operations/paste/paste-deps';

// GH #73, the fifth seam: the container-match gate runs FIRST and its empty-target arm replaces
// the child wholesale with no separator settle, while a blockquote body block can be blank.
// Miss-analysis: the empty-target cases stand a post-delete stub (raw emptied by hand) in for the
// target, and a stub is not a blank LINE — it separated nothing, so no case could observe the
// separator a real blank block carries.

function registerStubState(node: CstNode): void {
	registerBlockListState(node, {
		innerBlockIds: (node.children ?? []).map((_, i) => `iid-${i}`),
		innerBlockRefs: (node.children ?? []).map(() => undefined as BlockComponent | undefined)
	} as unknown as Parameters<typeof registerBlockListState>[1]);
}

/** Mirrors the commit primitive's owned-scope protocol: attach children, mutate, rebuild raws. */
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

describe('container-matching paste over a blank body block', () => {
	it('separates both the spliced head and the block below it', async () => {
		const doc = parse('> a\n>\n>\n> b\n');
		const quote = doc.children[0];
		expect(quote.children!.map((n) => [n.leadingTrivia, n.raw])).toEqual([
			['', 'a\n'],
			['\n', '\n'],
			['', 'b\n']
		]);
		registerStubState(quote);

		await pasteDispatch(
			{ pastedText: '> X\n>\n> Y\n', targetPath: [0, 1], offset: 0 },
			{ doc, blockEdit: makeStubBlockEdit(), controller: runningController(), undoEntry: 'own' }
		);

		expect(serialize(doc)).toBe('> a\n>\n> X\n>\n> Y\n>\n> b\n');
		expectParseConverged(doc);
	});
});
